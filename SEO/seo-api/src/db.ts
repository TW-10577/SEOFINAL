import Database from 'better-sqlite3'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Anomaly, AnomalyStatus, Countermeasure, CountermeasureStatus, Dataset, ParsedFile } from './types.ts'

const DATABASE_DIR = fileURLToPath(new URL('../../database/', import.meta.url))
export const defaultDbFile = process.env.SEO_DB_PATH ?? `${DATABASE_DIR}seo.db`
const SCHEMA = readFileSync(`${DATABASE_DIR}schema.sql`, 'utf8')

export interface StatusChange {
  entityType: 'anomaly' | 'countermeasure'
  entityId: string
  fromStatus: string | null
  toStatus: string
  changedAt: string
}

type Row = Record<string, any>

const datasetFromRow = (r: Row): Dataset => ({
  datasetId: r.dataset_id,
  fileName: r.file_name,
  source: r.source,
  uploadedAt: r.uploaded_at,
  period: r.period_start ? { start: r.period_start, end: r.period_end } : null,
  rowCount: r.row_count,
  warnings: JSON.parse(r.warnings_json),
  comparisons: JSON.parse(r.comparisons_json),
  weeklyTrend: JSON.parse(r.weekly_trend_json),
})

const anomalyFromRow = (r: Row): Anomaly => ({
  anomalyId: r.anomaly_id,
  datasetId: r.dataset_id,
  source: r.source,
  metricKey: r.metric_key,
  metricName: r.metric_name,
  scope: r.scope,
  kind: r.kind,
  previousValue: r.previous_value,
  currentValue: r.current_value,
  absoluteChange: r.absolute_change,
  changePercentage: r.change_percentage,
  threshold: { kind: r.threshold_kind, value: r.threshold_value, confirmed: r.threshold_confirmed === 1, source: r.threshold_source },
  previousPeriod: { start: r.previous_start, end: r.previous_end },
  currentPeriod: { start: r.current_start, end: r.current_end },
  detectionDate: r.detection_date,
  status: r.status,
  possibleCause: r.possible_cause,
})

const countermeasureFromRow = (r: Row): Countermeasure => ({
  countermeasureId: r.countermeasure_id,
  relatedAnomalyId: r.related_anomaly_id,
  description: r.description,
  reason: r.reason,
  ownerTeam: r.owner_team,
  priority: r.priority,
  status: r.status,
  createdDate: r.created_date,
  rule: r.rule,
  ruleConfirmed: r.rule_confirmed === 1,
})

export class SeoDatabase {
  private readonly db: Database.Database

  constructor(readonly file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
    this.db = new Database(file)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.exec(SCHEMA)
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  nextId(prefix: string): string {
    const { last_value } = this.db
      .prepare(
        `INSERT INTO id_sequences (prefix, last_value) VALUES (?, 1)
         ON CONFLICT(prefix) DO UPDATE SET last_value = last_value + 1 RETURNING last_value`,
      )
      .get(prefix) as { last_value: number }
    return `${prefix}-${String(last_value).padStart(4, '0')}`
  }

  findDatasetByHash(hash: string): Dataset | null {
    const r = this.db.prepare('SELECT * FROM datasets WHERE content_hash = ?').get(hash) as Row | undefined
    return r ? datasetFromRow(r) : null
  }

  insertDataset(d: Dataset, hash: string, parsed: ParsedFile): void {
    this.db
      .prepare(
        `INSERT INTO datasets (dataset_id, file_name, source, uploaded_at, period_start, period_end, row_count,
           content_hash, segments_json, warnings_json, comparisons_json, weekly_trend_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        d.datasetId,
        d.fileName,
        d.source,
        d.uploadedAt,
        d.period?.start ?? null,
        d.period?.end ?? null,
        d.rowCount,
        hash,
        parsed.segments ? JSON.stringify(parsed.segments) : null,
        JSON.stringify(d.warnings),
        JSON.stringify(d.comparisons),
        JSON.stringify(d.weeklyTrend),
      )

    const daily = this.db.prepare('INSERT INTO daily_metrics (dataset_id, date, metric_key, value) VALUES (?, ?, ?, ?)')
    for (const [date, metrics] of Object.entries(parsed.daily ?? {})) {
      for (const [key, value] of Object.entries(metrics)) daily.run(d.datasetId, date, key, value)
    }
    const snap = this.db.prepare(
      'INSERT INTO snapshot_rows (dataset_id, row_no, row_key, clicks, impressions, ctr, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    for (const [i, s] of (parsed.snapshot ?? []).entries()) snap.run(d.datasetId, i + 1, s.key, s.clicks, s.impressions, s.ctr, s.position)
  }

  getDataset(id: string): Dataset | null {
    const r = this.db.prepare('SELECT * FROM datasets WHERE dataset_id = ?').get(id) as Row | undefined
    return r ? datasetFromRow(r) : null
  }

  // Raw rows, anomalies and countermeasures go with it through ON DELETE CASCADE; history has no FK, so clear it here.
  deleteDataset(id: string): { anomalies: number; countermeasures: number } {
    const anomalyIds = (this.db.prepare('SELECT anomaly_id FROM anomalies WHERE dataset_id = ?').all(id) as Row[]).map((r) => r.anomaly_id)
    const cmIds = (
      this.db
        .prepare('SELECT countermeasure_id FROM countermeasures WHERE related_anomaly_id IN (SELECT anomaly_id FROM anomalies WHERE dataset_id = ?)')
        .all(id) as Row[]
    ).map((r) => r.countermeasure_id)
    const forget = this.db.prepare('DELETE FROM status_history WHERE entity_id = ?')
    for (const e of [...anomalyIds, ...cmIds]) forget.run(e)
    this.db.prepare('DELETE FROM datasets WHERE dataset_id = ?').run(id)
    return { anomalies: anomalyIds.length, countermeasures: cmIds.length }
  }

  listDatasets(): Dataset[] {
    return (this.db.prepare('SELECT * FROM datasets ORDER BY uploaded_at, dataset_id').all() as Row[]).map(datasetFromRow)
  }

  insertAnomaly(a: Anomaly, at: string): void {
    this.db
      .prepare(
        `INSERT INTO anomalies (anomaly_id, dataset_id, source, metric_key, metric_name, scope, kind, previous_value,
           current_value, absolute_change, change_percentage, threshold_kind, threshold_value, threshold_confirmed,
           threshold_source, previous_start, previous_end, current_start, current_end, detection_date, status, possible_cause)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        a.anomalyId,
        a.datasetId,
        a.source,
        a.metricKey,
        a.metricName,
        a.scope,
        a.kind,
        a.previousValue,
        a.currentValue,
        a.absoluteChange,
        a.changePercentage,
        a.threshold.kind,
        a.threshold.value,
        a.threshold.confirmed ? 1 : 0,
        a.threshold.source,
        a.previousPeriod.start,
        a.previousPeriod.end,
        a.currentPeriod.start,
        a.currentPeriod.end,
        a.detectionDate,
        a.status,
        a.possibleCause,
      )
    this.recordStatus('anomaly', a.anomalyId, null, a.status, at)
  }

  insertCountermeasure(c: Countermeasure, at: string): void {
    this.db
      .prepare(
        `INSERT INTO countermeasures (countermeasure_id, related_anomaly_id, description, reason, owner_team, priority,
           status, created_date, rule, rule_confirmed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.countermeasureId,
        c.relatedAnomalyId,
        c.description,
        c.reason,
        c.ownerTeam,
        c.priority,
        c.status,
        c.createdDate,
        c.rule,
        c.ruleConfirmed ? 1 : 0,
      )
    this.recordStatus('countermeasure', c.countermeasureId, null, c.status, at)
  }

  listAnomalies(): Anomaly[] {
    return (this.db.prepare('SELECT * FROM anomalies ORDER BY anomaly_id DESC').all() as Row[]).map(anomalyFromRow)
  }

  getAnomaly(id: string): Anomaly | null {
    const r = this.db.prepare('SELECT * FROM anomalies WHERE anomaly_id = ?').get(id) as Row | undefined
    return r ? anomalyFromRow(r) : null
  }

  listCountermeasures(): Countermeasure[] {
    return (this.db.prepare('SELECT * FROM countermeasures ORDER BY countermeasure_id DESC').all() as Row[]).map(countermeasureFromRow)
  }

  getCountermeasure(id: string): Countermeasure | null {
    const r = this.db.prepare('SELECT * FROM countermeasures WHERE countermeasure_id = ?').get(id) as Row | undefined
    return r ? countermeasureFromRow(r) : null
  }

  updateAnomalyStatus(id: string, from: AnomalyStatus, to: AnomalyStatus, at: string): void {
    this.db.prepare('UPDATE anomalies SET status = ? WHERE anomaly_id = ?').run(to, id)
    this.recordStatus('anomaly', id, from, to, at)
  }

  updateCountermeasureStatus(id: string, from: CountermeasureStatus, to: CountermeasureStatus, at: string): void {
    this.db.prepare('UPDATE countermeasures SET status = ? WHERE countermeasure_id = ?').run(to, id)
    this.recordStatus('countermeasure', id, from, to, at)
  }

  private recordStatus(entityType: StatusChange['entityType'], entityId: string, from: string | null, to: string, at: string): void {
    this.db
      .prepare('INSERT INTO status_history (entity_type, entity_id, from_status, to_status, changed_at) VALUES (?, ?, ?, ?, ?)')
      .run(entityType, entityId, from, to, at)
  }

  statusHistory(entityId?: string): StatusChange[] {
    const rows = (
      entityId
        ? this.db.prepare('SELECT * FROM status_history WHERE entity_id = ? ORDER BY history_id').all(entityId)
        : this.db.prepare('SELECT * FROM status_history ORDER BY history_id').all()
    ) as Row[]
    return rows.map((r) => ({
      entityType: r.entity_type,
      entityId: r.entity_id,
      fromStatus: r.from_status,
      toStatus: r.to_status,
      changedAt: r.changed_at,
    }))
  }

  close(): void {
    this.db.close()
  }
}
