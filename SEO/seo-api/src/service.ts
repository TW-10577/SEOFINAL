import { createHash } from 'node:crypto'
import { CONDITION_METRICS, compareLatestWeeks, comparePeriods, dataPeriod, weeklyTrend } from './analysis.ts'
import type { SeoDatabase } from './db.ts'
import { readUpload } from './fileformats.ts'
import { type Ontology, OntologyError } from './ontology.ts'
import { parseUpload, UploadError } from './parsers.ts'
import { loadMeasurements } from './measurements.ts'
import { type GscContext, suggest } from './rules.ts'
import {
  ANOMALY_STATUSES,
  type Anomaly,
  type AnomalyStatus,
  type CauseHypothesis,
  CHANGE_KINDS,
  type Comparison,
  CONDITION_TYPES,
  COUNTERMEASURE_STATUSES,
  type Countermeasure,
  type CountermeasureStatus,
  type Dataset,
  DIRECTIONS,
  type MeasurementConfig,
  type Period,
  type ParsedFile,
  PRIORITIES,
  REVIEW_STATUSES,
  type ReviewStatus,
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

const today = () => new Date().toISOString().slice(0, 10)

const ANOMALY_TYPE = 'logos.seo.object.seo-anomaly'
const CAUSE_TYPE = 'logos.seo.object.cause-hypothesis'
const COUNTERMEASURE_TYPE = 'logos.seo.object.countermeasure'
const ANOMALY_STATUS = 'logos.seo.value.anomaly-status'
const REVIEW_STATUS = 'logos.seo.value.review-status'
const COUNTERMEASURE_STATUS = 'logos.seo.value.countermeasure-status'

// Terminal statuses: an anomaly is "open" until it reaches one of these.
const isOpen = (a: Anomaly) => a.status !== 'Resolved' && a.status !== 'Dismissed'

export class SeoService {
  readonly measurementConfig: MeasurementConfig

  constructor(
    private readonly db: SeoDatabase,
    readonly ontology: Ontology,
  ) {
    ontology.assertEnumMatches(ANOMALY_STATUS, ANOMALY_STATUSES)
    ontology.assertEnumMatches(COUNTERMEASURE_STATUS, COUNTERMEASURE_STATUSES)
    ontology.assertEnumMatches(REVIEW_STATUS, REVIEW_STATUSES)
    ontology.assertEnumMatches('logos.seo.value.priority-level', PRIORITIES)
    ontology.assertEnumMatches('logos.seo.value.change-kind', CHANGE_KINDS)
    ontology.assertEnumMatches('logos.seo.value.data-source', SOURCE_KINDS)
    ontology.assertEnumMatches('logos.seo.value.direction', DIRECTIONS)
    ontology.assertEnumMatches('logos.seo.value.condition-type', CONDITION_TYPES)
    // The code creates records in these statuses, so the YAML lifecycle must start there.
    for (const [id, expected] of [
      [ANOMALY_STATUS, 'Detected'],
      [REVIEW_STATUS, 'NotReviewed'],
      [COUNTERMEASURE_STATUS, 'Proposed'],
    ] as const) {
      const { initial } = ontology.lifecycle(id)
      if (initial !== expected) throw new OntologyError(`${id}: initialValue must be ${expected}, not ${initial}`)
    }

    const problems = ontology.conditions.flatMap((c) => {
      const units = CONDITION_METRICS[c.metricKey]
      if (!units) return [`${c.conditionId}: unknown metric "${c.metricKey}" (known: ${Object.keys(CONDITION_METRICS).join(', ')})`]
      return units.includes(c.unit) ? [] : [`${c.conditionId}: unit ${c.unit} is not valid for ${c.metricKey} (use ${units.join(' or ')})`]
    })
    const perMetric = ontology.conditions.map((c) => c.metricKey)
    problems.push(...perMetric.filter((m, i) => perMetric.indexOf(m) !== i).map((m) => `more than one condition for ${m}`))
    for (const band of ['sessions', 'purchases']) if (!ontology.flatBands[band]) problems.push(`flatBands.${band} is missing`)
    if (problems.length) throw new OntologyError(`config/judgment-conditions.yaml: ${problems.join('; ')}`)
    this.measurementConfig = loadMeasurements(ontology.dir, ontology)

    const invalid = [
      ...db.listAnomalies().filter((a) => !this.conforms(ANOMALY_TYPE, a)).map((a) => a.anomalyId),
      ...db.listCauses().filter((h) => !this.conforms(CAUSE_TYPE, h)).map((h) => h.causeId),
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
  // The original file is kept in uploaded_files once at least one dataset was read from it.
  uploadFile(fileName: string, data: Buffer) {
    const sheets = readUpload(fileName, data)
    if (sheets.length === 0) throw new UploadError('The file is empty.')
    // Called inside each dataset's transaction, so a rolled-back sheet never leaves the file behind on its own.
    const fileHash = createHash('sha256').update(data).digest('hex')
    const keepFile = () => this.db.saveUploadedFile(fileName, fileHash, data, new Date().toISOString())
    if (sheets.length === 1) return [{ name: sheets[0].name, ...this.upload(sheets[0].name, sheets[0].text, keepFile) }]
    const items = sheets.map((s) => {
      try {
        return { name: s.name, ...this.upload(s.name, s.text, keepFile) }
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

  upload(fileName: string, text: string, keepFile?: () => string) {
    // Browsers strip the UTF-8 BOM when reading a file and editors change line endings; hash the content, not the bytes.
    const hash = createHash('sha256').update(text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')).digest('hex')
    const existing = this.db.findDatasetByHash(hash)
    if (existing) return { duplicate: true, dataset: existing, anomalies: [], causes: [], countermeasures: [] }

    const parsed = parseUpload(text)
    const { comparisons, warning } = compareLatestWeeks(parsed, this.ontology.conditions)
    return this.db.transaction(() => this.store(fileName, hash, parsed, comparisons, warning, keepFile?.() ?? null))
  }

  private store(fileName: string, hash: string, parsed: ParsedFile, comparisons: Comparison[], warning: string | undefined, uploadId: string | null) {
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
    this.db.insertDataset(dataset, hash, parsed, uploadId)

    const anomalies: Anomaly[] = []
    const causes: CauseHypothesis[] = []
    const countermeasures: Countermeasure[] = []
    for (const c of comparisons) {
      if (!c.significant || !c.threshold || !c.judgmentConditionId) continue
      const gsc = parsed.source === 'ga4-daily' && c.metricKey === 'sessions' ? this.gscContext(c.previousPeriod, c.currentPeriod) : undefined
      const s = suggest(parsed.source, c, comparisons, this.ontology.flatBands, gsc)
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
        judgmentConditionId: c.judgmentConditionId,
        threshold: c.threshold,
        previousPeriod: c.previousPeriod,
        currentPeriod: c.currentPeriod,
        detectionDate: today(),
        status: 'Detected',
      }
      const cause: CauseHypothesis = {
        causeId: this.db.nextId('CH'),
        anomalyId: anomaly.anomalyId,
        hypothesis: s.hypothesis,
        supportingEvidence: s.supportingEvidence,
        confidence: null,
        reviewStatus: 'NotReviewed',
        rule: s.rule,
        ruleConfirmed: s.ruleConfirmed,
        createdDate: today(),
      }
      const countermeasure: Countermeasure = {
        countermeasureId: this.db.nextId('CM'),
        causeId: cause.causeId,
        description: s.description,
        reason: s.hypothesis,
        target: c.scope,
        ownerTeam: s.ownerTeam,
        priority: s.priority,
        status: 'Proposed',
        createdDate: today(),
        decidedBy: null,
      }
      this.ontology.assertObject(ANOMALY_TYPE, anomaly)
      this.ontology.assertObject(CAUSE_TYPE, cause)
      this.ontology.assertObject(COUNTERMEASURE_TYPE, countermeasure)
      this.db.insertAnomaly(anomaly, now)
      this.db.insertCause(cause, now)
      this.db.insertCountermeasure(countermeasure, now)
      anomalies.push(anomaly)
      causes.push(cause)
      countermeasures.push(countermeasure)
    }
    return { duplicate: false, dataset, anomalies, causes, countermeasures }
  }

  // GSC uploads as evidence for ① (measurement sheet rows 2–4): the daily chart for the same two weeks,
  // and the top queries and pages of the latest snapshot exports.
  private gscContext(previousPeriod: Period, currentPeriod: Period): GscContext {
    const active = this.db.listDatasets()
    const newest = (source: string) => active.filter((d) => d.source === source).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
    const charts = newest('gsc-daily')
    const weeks = `${previousPeriod.start}〜${currentPeriod.end}`
    let comparisons: GscContext['comparisons'] = null
    for (const d of charts) {
      const daily = this.db.dailyMetrics(d.datasetId)
      const found = comparePeriods({ source: 'gsc-daily', daily, rowCount: 0, warnings: [] }, previousPeriod, currentPeriod, this.ontology.conditions)
      if (found.length) {
        comparisons = found
        break
      }
    }
    const note = comparisons
      ? undefined
      : charts.length
        ? `the daily chart covers ${charts.map((d) => `${d.period?.start}〜${d.period?.end}`).join(', ')}, not ${weeks}; upload a GSC export for the same weeks.`
        : `no GSC daily chart (平均読み込み時間のチャート) uploaded for ${weeks}.`
    const top = (source: string) => {
      const d = newest(source)[0]
      return d ? this.db.topSnapshotRows(d.datasetId, 3) : undefined
    }
    return { comparisons, note, queries: top('gsc-queries'), pages: top('gsc-pages') }
  }

  // ---- soft delete ---------------------------------------------------------------------------

  deleteDataset(id: string) {
    if (!this.db.getDataset(id)) throw new HttpError(404, `Dataset ${id} not found.`)
    const impact = this.deletionImpact(id)
    this.db.transaction(() => this.db.setDatasetDeleted(id, new Date().toISOString()))
    return impact
  }

  restoreDataset(id: string) {
    const d = this.db.getDataset(id, true)
    if (!d || !d.deletedAt) throw new HttpError(404, `Deleted dataset ${id} not found.`)
    const active = this.db.findDatasetByHash(d.contentHash)
    if (active) {
      throw new HttpError(409, `The same content is already active as ${active.datasetId} (${active.fileName}). Delete that one first.`)
    }
    this.db.transaction(() => this.db.setDatasetDeleted(id, null))
    return this.db.getDataset(id)!
  }

  deletedDatasets() {
    return this.db.listDeletedDatasets()
  }

  // What a delete would hide, so the UI can ask before doing it.
  deletionImpact(id: string) {
    const dataset = this.db.getDataset(id)
    if (!dataset) throw new HttpError(404, `Dataset ${id} not found.`)
    const anomalyIds = new Set(this.db.listAnomalies().filter((a) => a.datasetId === id).map((a) => a.anomalyId))
    const causeIds = new Set(this.db.listCauses().filter((h) => anomalyIds.has(h.anomalyId)).map((h) => h.causeId))
    const cms = this.db.listCountermeasures().filter((c) => causeIds.has(c.causeId))
    return {
      datasetId: id,
      fileName: dataset.fileName,
      anomalies: anomalyIds.size,
      countermeasures: cms.length,
      decidedCountermeasures: cms.filter((c) => c.status !== 'Proposed').length,
    }
  }

  // ---- reads ---------------------------------------------------------------------------------

  datasets(): Dataset[] {
    return this.db.listDatasets()
  }

  // Anomalies with their cause hypothesis and countermeasures, the way the UI shows them.
  anomalies() {
    const causes = this.db.listCauses()
    const cms = this.db.listCountermeasures()
    return this.db.listAnomalies().map((a) => {
      const cause = causes.find((h) => h.anomalyId === a.anomalyId) ?? null
      return { ...a, cause, countermeasures: cause ? cms.filter((c) => c.causeId === cause.causeId) : [] }
    })
  }

  countermeasures() {
    const causes = this.db.listCauses()
    return this.db.listCountermeasures().map((c) => {
      const cause = causes.find((h) => h.causeId === c.causeId)
      return { ...c, anomalyId: cause?.anomalyId ?? '', rule: cause?.rule ?? '', ruleConfirmed: cause?.ruleConfirmed ?? false }
    })
  }

  statusHistory(entityId?: string) {
    return this.db.statusHistory(entityId)
  }

  // ---- lifecycle (design §8, transitions declared in the ontology) -----------------------------

  private checkMove(lifecycleId: string, label: string, from: string, to: unknown) {
    const { transitions } = this.ontology.lifecycle(lifecycleId)
    const allowed = transitions[from] ?? []
    if (!allowed.includes(to as string)) {
      throw new HttpError(400, `A ${label} in ${from} can move to: ${allowed.join(', ') || 'nothing (final status)'}.`)
    }
  }

  setAnomalyStatus(id: string, status: unknown): Anomaly {
    const a = this.db.getAnomaly(id)
    if (!a) throw new HttpError(404, `Anomaly ${id} not found.`)
    this.checkMove(ANOMALY_STATUS, 'anomaly', a.status, status)
    this.db.updateAnomalyStatus(id, a.status, status as AnomalyStatus, new Date().toISOString())
    return { ...a, status: status as AnomalyStatus }
  }

  setCauseReview(id: string, status: unknown): CauseHypothesis {
    const h = this.db.getCause(id)
    if (!h) throw new HttpError(404, `Cause hypothesis ${id} not found.`)
    this.checkMove(REVIEW_STATUS, 'cause hypothesis', h.reviewStatus, status)
    this.db.updateCauseReview(id, h.reviewStatus, status as ReviewStatus, new Date().toISOString())
    return { ...h, reviewStatus: status as ReviewStatus }
  }

  setCountermeasureStatus(id: string, status: unknown): Countermeasure {
    const c = this.db.getCountermeasure(id)
    if (!c) throw new HttpError(404, `Countermeasure ${id} not found.`)
    this.checkMove(COUNTERMEASURE_STATUS, 'countermeasure', c.status, status)
    this.db.updateCountermeasureStatus(id, c.status, status as CountermeasureStatus, new Date().toISOString())
    return { ...c, status: status as CountermeasureStatus }
  }

  // The measurement sheet joined with what has been uploaded: latest result per measurement, uploads per data source.
  measurements() {
    const ga4 = this.latest('ga4-daily')
    const anomalies = this.db.listAnomalies()
    const datasets = this.datasets()
    return {
      measurements: this.measurementConfig.measurements.map((m) => ({
        ...m,
        condition: this.ontology.conditions.find((c) => c.conditionId === m.conditionId) ?? null,
        latest: ga4?.comparisons.find((c) => c.judgmentConditionId === m.conditionId) ?? null,
        latestFile: ga4?.fileName ?? null,
        openAnomalies: anomalies.filter((a) => a.judgmentConditionId === m.conditionId && isOpen(a)).length,
      })),
      dataSources: this.measurementConfig.dataSources.map((s) => ({
        ...s,
        uploads: datasets
          .filter((d) => s.sourceKinds.includes(d.source))
          .map(({ datasetId, fileName, source, period, rowCount }) => ({ datasetId, fileName, source, period, rowCount })),
      })),
    }
  }

  // Get raw daily metrics as imported (audit view): one row per date-metric.
  datasetRawRows(datasetId: string) {
    const d = this.db.getDataset(datasetId)
    if (!d) throw new HttpError(404, `Dataset ${datasetId} not found.`)
    const rows = this.db.rawDailyRows(datasetId)
    return {
      datasetId,
      fileName: d.fileName,
      source: d.source,
      uploadedAt: d.uploadedAt,
      period: d.period,
      totalRows: rows.length,
      rows: rows.map((r, i) => ({
        row: i + 1,
        date: r.date,
        source: d.source,
        subject: 'Site', // GA4/GSC totals only for now
        metric: r.metricKey,
        value: r.value,
        status: 'Imported' as const,
      })),
    }
  }

  // ---- dashboard and report ------------------------------------------------------------------

  private latest(source: 'gsc-daily' | 'ga4-daily'): Dataset | null {
    const list = this.datasets().filter((d) => d.source === source && d.period)
    list.sort((a, b) => (a.period!.end === b.period!.end ? a.uploadedAt.localeCompare(b.uploadedAt) : a.period!.end.localeCompare(b.period!.end)))
    return list.at(-1) ?? null
  }

  dashboard() {
    const anomalies = this.anomalies()
    const countermeasures = this.db.listCountermeasures()
    const datasets = this.datasets()
    const gsc = this.latest('gsc-daily')
    const ga4 = this.latest('ga4-daily')
    return {
      stats: {
        datasets: datasets.length,
        openAnomalies: anomalies.filter(isOpen).length,
        totalAnomalies: anomalies.length,
        causesToReview: this.db.listCauses().filter((h) => h.reviewStatus === 'NotReviewed' || h.reviewStatus === 'NeedsMoreEvidence').length,
        proposedCountermeasures: countermeasures.filter((c) => c.status === 'Proposed').length,
        activeCountermeasures: countermeasures.filter((c) => ['Approved', 'InProgress', 'Completed'].includes(c.status)).length,
      },
      latest: [gsc, ga4].filter((d): d is Dataset => d !== null).map((d) => ({
        datasetId: d.datasetId,
        fileName: d.fileName,
        source: d.source,
        comparisons: d.comparisons,
      })),
      weeklyTrend: gsc?.weeklyTrend ?? [],
      openAnomalies: anomalies.filter(isOpen).slice(0, 5),
      warnings: datasets.flatMap((d) => d.warnings.map((w) => ({ fileName: d.fileName, message: w }))),
    }
  }

  weeklyReport() {
    const anomalies = this.anomalies()
    const countermeasures = this.countermeasures()
    const count = (values: string[]) => values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {})
    const dashboard = this.dashboard()
    return {
      generatedAt: new Date().toISOString(),
      dataSources: this.datasets().map(({ datasetId, fileName, source, period, uploadedAt }) => ({ datasetId, fileName, source, period, uploadedAt })),
      summary: dashboard.latest,
      anomalies,
      countermeasures,
      decisions: {
        anomalies: count(anomalies.map((a) => a.status)),
        causes: count(this.db.listCauses().map((h) => h.reviewStatus)),
        countermeasures: count(countermeasures.map((c) => c.status)),
      },
      openItems: anomalies.filter(isOpen),
      warnings: dashboard.warnings,
    }
  }
}
