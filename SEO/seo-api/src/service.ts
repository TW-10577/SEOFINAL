import { createHash } from 'node:crypto'
import { compareLatestWeeks, dataPeriod, THRESHOLD_KINDS, weeklyTrend } from './analysis.ts'
import { type Ontology, OntologyError } from './ontology.ts'
import { readUpload } from './fileformats.ts'
import { parseUpload, UploadError } from './parsers.ts'
import { suggest } from './rules.ts'
import type { SeoDatabase } from './db.ts'
import {
  ANOMALY_STATUSES,
  type Anomaly,
  type AnomalyStatus,
  CHANGE_KINDS,
  COUNTERMEASURE_STATUSES,
  type Comparison,
  type Countermeasure,
  type CountermeasureStatus,
  type Dataset,
  type ParsedFile,
  PRIORITIES,
  SOURCE_KINDS,
} from './types.ts'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export const COUNTERMEASURE_TRANSITIONS: Record<CountermeasureStatus, CountermeasureStatus[]> = {
  Proposed: ['Approved', 'Rejected'],
  Approved: ['Implemented', 'Rejected'],
  Implemented: ['Verified'],
  Verified: [],
  Rejected: ['Proposed'],
}

const today = () => new Date().toISOString().slice(0, 10)

const ANOMALY_TYPE = 'logos.seo.object.seo-anomaly'
const COUNTERMEASURE_TYPE = 'logos.seo.object.countermeasure'

export class SeoService {
  constructor(
    private readonly db: SeoDatabase,
    readonly ontology: Ontology,
  ) {
    ontology.assertEnumMatches('logos.seo.value.anomaly-status', ANOMALY_STATUSES)
    ontology.assertEnumMatches('logos.seo.value.countermeasure-status', COUNTERMEASURE_STATUSES)
    ontology.assertEnumMatches('logos.seo.value.priority-level', PRIORITIES)
    ontology.assertEnumMatches('logos.seo.value.change-kind', CHANGE_KINDS)
    ontology.assertEnumMatches('logos.seo.value.data-source', SOURCE_KINDS)
    const missing = Object.keys(COUNTERMEASURE_TRANSITIONS).filter((s) => !ontology.enumValues('logos.seo.value.countermeasure-status').includes(s))
    if (missing.length) throw new OntologyError(`Countermeasure transitions use unknown statuses: ${missing.join(', ')}`)

    const t = ontology.thresholds
    const problems = [
      ...Object.entries(THRESHOLD_KINDS).flatMap(([key, kind]) =>
        !t[key] ? [`missing "${key}"`] : t[key].kind !== kind ? [`"${key}" must have kind ${kind}, not ${t[key].kind}`] : [],
      ),
      ...Object.keys(t).filter((k) => !(k in THRESHOLD_KINDS)).map((k) => `unknown metric "${k}"`),
    ]
    if (problems.length) throw new OntologyError(`config/thresholds.yaml: ${problems.join('; ')}`)

    const invalid = [
      ...db.listAnomalies().filter((a) => !this.conforms(ANOMALY_TYPE, a)).map((a) => a.anomalyId),
      ...db.listCountermeasures().filter((c) => !this.conforms(COUNTERMEASURE_TYPE, c)).map((c) => c.countermeasureId),
    ]
    if (invalid.length) console.warn(`Stored records that no longer match the ontology: ${invalid.join(', ')}`)
  }

  private conforms(type: string, value: unknown): boolean {
    try {
      this.ontology.assertObject(type, value)
      return true
    } catch {
      return false
    }
  }

  // A text file gives one dataset; a workbook gives one per sheet. A sheet that cannot be read does not stop the others.
  uploadFile(fileName: string, data: Buffer) {
    const sheets = readUpload(fileName, data)
    if (sheets.length === 0) throw new UploadError('The file is empty.')
    if (sheets.length === 1) return [{ name: sheets[0].name, ...this.upload(sheets[0].name, sheets[0].text) }]
    const items = sheets.map((s) => {
      try {
        return { name: s.name, ...this.upload(s.name, s.text) }
      } catch (e) {
        if (e instanceof UploadError) return { name: s.name, error: e.message }
        throw e
      }
    })
    if (items.every((i) => 'error' in i)) {
      throw new UploadError(`No sheet could be read. ${items.map((i) => `${i.name}: ${'error' in i ? i.error : ''}`).join(' | ')}`)
    }
    return items
  }

  upload(fileName: string, text: string) {
    // Browsers strip the UTF-8 BOM when reading a file and editors change line endings; hash the content, not the bytes.
    const hash = createHash('sha256').update(text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')).digest('hex')
    const existing = this.db.findDatasetByHash(hash)
    if (existing) return { duplicate: true, dataset: existing, anomalies: [], countermeasures: [] }

    const parsed = parseUpload(text)
    const { comparisons, warning } = compareLatestWeeks(parsed, this.ontology.thresholds)
    return this.db.transaction(() => this.store(fileName, hash, parsed, comparisons, warning))
  }

  private store(fileName: string, hash: string, parsed: ParsedFile, comparisons: Comparison[], warning?: string) {
    const now = new Date().toISOString()
    const datasetId = this.db.nextId('DS')
    const dataset: Dataset = {
      datasetId,
      fileName,
      source: parsed.source,
      uploadedAt: now,
      period: dataPeriod(parsed),
      rowCount: parsed.rowCount,
      warnings: warning ? [...parsed.warnings, warning] : parsed.warnings,
      comparisons,
      weeklyTrend: weeklyTrend(parsed),
    }
    this.db.insertDataset(dataset, hash, parsed)

    const anomalies: Anomaly[] = []
    const countermeasures: Countermeasure[] = []
    for (const c of comparisons) {
      if (!c.significant || !c.threshold) continue
      const s = suggest(parsed.source, c, comparisons)
      const anomaly: Anomaly = {
        anomalyId: this.db.nextId('ANO'),
        datasetId,
        source: parsed.source,
        metricKey: c.metricKey,
        metricName: c.label,
        scope: c.scope,
        kind: c.kind,
        previousValue: c.previous,
        currentValue: c.current,
        absoluteChange: c.absoluteChange,
        changePercentage: c.changePercentage,
        threshold: c.threshold,
        previousPeriod: c.previousPeriod,
        currentPeriod: c.currentPeriod,
        detectionDate: today(),
        status: 'Detected',
        possibleCause: s.possibleCause,
      }
      const countermeasure: Countermeasure = {
        countermeasureId: this.db.nextId('CM'),
        relatedAnomalyId: anomaly.anomalyId,
        description: s.description,
        reason: s.possibleCause,
        ownerTeam: s.ownerTeam,
        priority: s.priority,
        status: 'Proposed',
        createdDate: today(),
        rule: s.rule,
        ruleConfirmed: s.ruleConfirmed,
      }
      this.ontology.assertObject(ANOMALY_TYPE, anomaly)
      this.ontology.assertObject(COUNTERMEASURE_TYPE, countermeasure)
      this.db.insertAnomaly(anomaly, now)
      this.db.insertCountermeasure(countermeasure, now)
      anomalies.push(anomaly)
      countermeasures.push(countermeasure)
    }
    return { duplicate: false, dataset, anomalies, countermeasures }
  }

  deleteDataset(id: string) {
    if (!this.db.getDataset(id)) throw new HttpError(404, `Dataset ${id} not found.`)
    return { datasetId: id, ...this.db.transaction(() => this.db.deleteDataset(id)) }
  }

  // What a delete would remove, so the UI can ask before doing it.
  deletionImpact(id: string) {
    const dataset = this.db.getDataset(id)
    if (!dataset) throw new HttpError(404, `Dataset ${id} not found.`)
    const anomalyIds = new Set(this.anomalies().filter((a) => a.datasetId === id).map((a) => a.anomalyId))
    const cms = this.countermeasures().filter((c) => anomalyIds.has(c.relatedAnomalyId))
    return {
      datasetId: id,
      fileName: dataset.fileName,
      anomalies: anomalyIds.size,
      countermeasures: cms.length,
      decidedCountermeasures: cms.filter((c) => c.status !== 'Proposed').length,
    }
  }

  datasets(): Dataset[] {
    return this.db.listDatasets()
  }

  anomalies(): Anomaly[] {
    return this.db.listAnomalies()
  }

  countermeasures(): Countermeasure[] {
    return this.db.listCountermeasures()
  }

  statusHistory(entityId?: string) {
    return this.db.statusHistory(entityId)
  }

  setAnomalyStatus(id: string, status: unknown): Anomaly {
    const a = this.db.getAnomaly(id)
    if (!a) throw new HttpError(404, `Anomaly ${id} not found.`)
    const allowed = this.ontology.enumValues('logos.seo.value.anomaly-status')
    if (!allowed.includes(status as string)) throw new HttpError(400, `status must be one of ${allowed.join(', ')}.`)
    if (status === a.status) return a
    this.db.updateAnomalyStatus(id, a.status, status as AnomalyStatus, new Date().toISOString())
    return { ...a, status: status as AnomalyStatus }
  }

  setCountermeasureStatus(id: string, status: unknown): Countermeasure {
    const c = this.db.getCountermeasure(id)
    if (!c) throw new HttpError(404, `Countermeasure ${id} not found.`)
    const allowed = COUNTERMEASURE_TRANSITIONS[c.status]
    if (!allowed.includes(status as CountermeasureStatus)) {
      throw new HttpError(400, `A ${c.status} countermeasure can move to: ${allowed.join(', ') || 'nothing'}.`)
    }
    this.db.updateCountermeasureStatus(id, c.status, status as CountermeasureStatus, new Date().toISOString())
    return { ...c, status: status as CountermeasureStatus }
  }

  private latest(source: 'gsc-daily' | 'ga4-daily'): Dataset | null {
    const list = this.datasets().filter((d) => d.source === source && d.period)
    list.sort((a, b) => (a.period!.end === b.period!.end ? a.uploadedAt.localeCompare(b.uploadedAt) : a.period!.end.localeCompare(b.period!.end)))
    return list.at(-1) ?? null
  }

  dashboard() {
    const anomalies = this.anomalies()
    const countermeasures = this.countermeasures()
    const datasets = this.datasets()
    const gsc = this.latest('gsc-daily')
    const ga4 = this.latest('ga4-daily')
    return {
      stats: {
        datasets: datasets.length,
        openAnomalies: anomalies.filter((a) => a.status !== 'Resolved').length,
        totalAnomalies: anomalies.length,
        proposedCountermeasures: countermeasures.filter((c) => c.status === 'Proposed').length,
        approvedCountermeasures: countermeasures.filter((c) => ['Approved', 'Implemented', 'Verified'].includes(c.status)).length,
      },
      latest: [gsc, ga4].filter((d): d is Dataset => d !== null).map((d) => ({
        datasetId: d.datasetId,
        fileName: d.fileName,
        source: d.source,
        comparisons: d.comparisons,
      })),
      weeklyTrend: gsc?.weeklyTrend ?? [],
      openAnomalies: anomalies.filter((a) => a.status !== 'Resolved').slice(0, 5),
      warnings: datasets.flatMap((d) => d.warnings.map((w) => ({ fileName: d.fileName, message: w }))),
    }
  }

  weeklyReport() {
    const anomalies = this.anomalies()
    const countermeasures = this.countermeasures()
    const count = <T extends string>(items: { status: T }[]) =>
      items.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.status]: (acc[i.status] ?? 0) + 1 }), {})
    const dashboard = this.dashboard()
    return {
      generatedAt: new Date().toISOString(),
      dataSources: this.datasets().map(({ datasetId, fileName, source, period, uploadedAt }) => ({ datasetId, fileName, source, period, uploadedAt })),
      summary: dashboard.latest,
      anomalies,
      countermeasures,
      decisions: { anomalies: count(anomalies), countermeasures: count(countermeasures) },
      openItems: anomalies.filter((a) => a.status !== 'Resolved'),
      warnings: dashboard.warnings,
    }
  }
}
