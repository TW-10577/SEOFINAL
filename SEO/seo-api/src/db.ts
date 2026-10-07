import Database from 'better-sqlite3'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Anomaly, AnomalyStatus, CauseHypothesis, Countermeasure, CountermeasureStatus, Dataset, ParsedFile, ReviewStatus } from './types.ts'

const DATABASE_DIR = fileURLToPath(new URL('../../database/', import.meta.url))
export const defaultDbFile = process.env.SEO_DB_PATH ?? `${DATABASE_DIR}seo.db`
const SCHEMA = readFileSync(`${DATABASE_DIR}schema.sql`, 'utf8')

export interface StatusChange {
  entityType: 'dataset' | 'anomaly' | 'cause' | 'countermeasure'
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
  judgmentConditionId: r.judgment_condition_id,
  threshold: { kind: r.threshold_kind, value: r.threshold_value, confirmed: r.threshold_confirmed === 1, source: r.threshold_source },
  previousPeriod: { start: r.previous_start, end: r.previous_end },
  currentPeriod: { start: r.current_start, end: r.current_end },
  detectionDate: r.detection_date,
  status: r.status,
})

const causeFromRow = (r: Row): CauseHypothesis => ({
  causeId: r.cause_id,
  anomalyId: r.anomaly_id,
  hypothesis: r.hypothesis,
  supportingEvidence: r.supporting_evidence,
  confidence: r.confidence,
  reviewStatus: r.review_status,
  rule: r.rule,
  ruleConfirmed: r.rule_confirmed === 1,
  createdDate: r.created_date,
})

const countermeasureFromRow = (r: Row): Countermeasure => ({
  countermeasureId: r.countermeasure_id,
  causeId: r.cause_id,
  description: r.description,
  reason: r.reason,
  target: r.target,
  ownerTeam: r.owner_team,
  priority: r.priority,
  status: r.status,
  createdDate: r.created_date,
  decidedBy: r.decided_by,
})

// Only records whose dataset has not been soft-deleted are visible.
const ACTIVE_ANOMALIES = 'SELECT a.* FROM anomalies a JOIN datasets d ON d.dataset_id = a.dataset_id AND d.deleted_at IS NULL'
const ACTIVE_CAUSES = `SELECT h.* FROM cause_hypotheses h JOIN anomalies a ON a.anomaly_id = h.anomaly_id
  JOIN datasets d ON d.dataset_id = a.dataset_id AND d.deleted_at IS NULL`
const ACTIVE_COUNTERMEASURES = `SELECT c.* FROM countermeasures c JOIN cause_hypotheses h ON h.cause_id = c.cause_id
  JOIN anomalies a ON a.anomaly_id = h.anomaly_id JOIN datasets d ON d.dataset_id = a.dataset_id AND d.deleted_at IS NULL`

export class SeoDatabase {
  private readonly db: Database.Database

  constructor(readonly file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
    this.db = new Database(file)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrateToSoftDelete()
    this.migrateToDesignModel()
    this.migrateToUploadedFiles()
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

  // Databases created before soft delete had UNIQUE(content_hash) inline, which SQLite cannot drop: rebuild the table.
  private migrateToSoftDelete(): void {
    const cols = this.db.prepare("SELECT name FROM pragma_table_info('datasets')").all() as Row[]
    if (cols.length === 0 || cols.some((c) => c.name === 'deleted_at')) return
    this.db.pragma('foreign_keys = OFF')
    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE datasets_migrated (
          dataset_id TEXT PRIMARY KEY, file_name TEXT NOT NULL, source TEXT NOT NULL, uploaded_at TEXT NOT NULL,
          period_start TEXT, period_end TEXT, row_count INTEGER NOT NULL, content_hash TEXT NOT NULL,
          segments_json TEXT, warnings_json TEXT NOT NULL, comparisons_json TEXT NOT NULL, weekly_trend_json TEXT NOT NULL,
          deleted_at TEXT);
        INSERT INTO datasets_migrated SELECT *, NULL FROM datasets;
        DROP TABLE datasets;
        ALTER TABLE datasets_migrated RENAME TO datasets;`)
    })()
    this.db.pragma('foreign_keys = ON')
  }

  // Before the design-doc model, cause text lived on anomalies and countermeasures pointed at anomalies.
  // Empty old tables are recreated; old rows cannot be mapped to the new statuses, so they stop the start.
  private migrateToDesignModel(): void {
    const has = (table: string, col: string) =>
      (this.db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as Row[]).some((c) => c.name === col)
    if (!has('anomalies', 'possible_cause') && !has('countermeasures', 'related_anomaly_id')) return
    const rows = (this.db.prepare('SELECT COUNT(*) n FROM anomalies').get() as Row).n + (this.db.prepare('SELECT COUNT(*) n FROM countermeasures').get() as Row).n
    if (rows > 0) {
      throw new Error(
        `${this.file} holds ${rows} anomaly/countermeasure rows in the old format. Back it up, then delete the anomalies and countermeasures tables (or the file) and upload the data again.`,
      )
    }
    this.db.exec('DROP TABLE IF EXISTS countermeasures; DROP TABLE IF EXISTS anomalies;')
  }

  // Databases created before the original files were kept have no datasets.upload_id.
  private migrateToUploadedFiles(): void {
    const cols = this.db.prepare("SELECT name FROM pragma_table_info('datasets')").all() as Row[]
    if (cols.length === 0 || cols.some((c) => c.name === 'upload_id')) return
    this.db.exec('ALTER TABLE datasets ADD COLUMN upload_id TEXT REFERENCES uploaded_files(upload_id)')
  }

  // The same bytes are stored once: a repeat upload returns the existing upload_id.
  saveUploadedFile(fileName: string, hash: string, content: Buffer, at: string): string {
    const existing = this.db.prepare('SELECT upload_id FROM uploaded_files WHERE file_hash = ?').get(hash) as Row | undefined
    if (existing) return existing.upload_id
    const id = this.nextId('UP')
    this.db
      .prepare('INSERT INTO uploaded_files (upload_id, file_name, size_bytes, file_hash, content, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, fileName, content.length, hash, content, at)
    return id
  }

  getUploadedFile(id: string): { uploadId: string; fileName: string; content: Buffer; uploadedAt: string } | null {
    const r = this.db.prepare('SELECT * FROM uploaded_files WHERE upload_id = ?').get(id) as Row | undefined
    return r ? { uploadId: r.upload_id, fileName: r.file_name, content: r.content, uploadedAt: r.uploaded_at } : null
  }

  findDatasetByHash(hash: string): Dataset | null {
    const r = this.db.prepare('SELECT * FROM datasets WHERE content_hash = ? AND deleted_at IS NULL').get(hash) as Row | undefined
    return r ? datasetFromRow(r) : null
  }

  insertDataset(d: Dataset, hash: string, parsed: ParsedFile, uploadId: string | null = null): void {
    this.db
      .prepare(
        `INSERT INTO datasets (dataset_id, file_name, source, uploaded_at, period_start, period_end, row_count,
           content_hash, segments_json, warnings_json, comparisons_json, weekly_trend_json, upload_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        uploadId,
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

  dailyMetrics(datasetId: string): Record<string, Record<string, number>> {
    const daily: Record<string, Record<string, number>> = {}
    const rows = this.db.prepare('SELECT date, metric_key, value FROM daily_metrics WHERE dataset_id = ?').all(datasetId) as Row[]
    for (const r of rows) (daily[r.date] ??= {})[r.metric_key] = r.value
    return daily
  }

  // The rows with the most clicks, and the clicks of the whole export for the share.
  topSnapshotRows(datasetId: string, limit: number): { rows: { key: string; clicks: number }[]; totalClicks: number } {
    const rows = this.db
      .prepare('SELECT row_key AS key, clicks FROM snapshot_rows WHERE dataset_id = ? ORDER BY clicks DESC, row_no LIMIT ?')
      .all(datasetId, limit) as { key: string; clicks: number }[]
    const { total } = this.db.prepare('SELECT COALESCE(SUM(clicks), 0) AS total FROM snapshot_rows WHERE dataset_id = ?').get(datasetId) as Row
    return { rows, totalClicks: total }
  }

  getDataset(id: string, includeDeleted = false): (Dataset & { deletedAt: string | null; contentHash: string }) | null {
    const r = this.db
      .prepare(`SELECT * FROM datasets WHERE dataset_id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`)
      .get(id) as Row | undefined
    return r ? { ...datasetFromRow(r), deletedAt: r.deleted_at, contentHash: r.content_hash } : null
  }

  // Soft delete: the dataset and everything derived from it is hidden, never removed.
  setDatasetDeleted(id: string, deletedAt: string | null): void {
    this.db.prepare('UPDATE datasets SET deleted_at = ? WHERE dataset_id = ?').run(deletedAt, id)
    this.recordStatus('dataset', id, deletedAt ? 'Active' : 'Deleted', deletedAt ? 'Deleted' : 'Active', deletedAt ?? new Date().toISOString())
  }

  listDatasets(): Dataset[] {
    return (this.db.prepare('SELECT * FROM datasets WHERE deleted_at IS NULL ORDER BY uploaded_at, dataset_id').all() as Row[]).map(datasetFromRow)
  }

  listDeletedDatasets(): (Dataset & { deletedAt: string })[] {
    return (this.db.prepare('SELECT * FROM datasets WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all() as Row[]).map((r) => ({
      ...datasetFromRow(r),
      deletedAt: r.deleted_at,
    }))
  }

  insertAnomaly(a: Anomaly, at: string): void {
    this.db
      .prepare(
        `INSERT INTO anomalies (anomaly_id, dataset_id, source, metric_key, metric_name, scope, kind, previous_value,
           current_value, absolute_change, change_percentage, judgment_condition_id, threshold_kind, threshold_value,
           threshold_confirmed, threshold_source, previous_start, previous_end, current_start, current_end, detection_date, status)
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
        a.judgmentConditionId,
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
      )
    this.recordStatus('anomaly', a.anomalyId, null, a.status, at)
  }

  insertCause(h: CauseHypothesis, at: string): void {
    this.db
      .prepare(
        `INSERT INTO cause_hypotheses (cause_id, anomaly_id, hypothesis, supporting_evidence, confidence, review_status, rule,
           rule_confirmed, created_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(h.causeId, h.anomalyId, h.hypothesis, h.supportingEvidence, h.confidence, h.reviewStatus, h.rule, h.ruleConfirmed ? 1 : 0, h.createdDate)
    this.recordStatus('cause', h.causeId, null, h.reviewStatus, at)
  }

  insertCountermeasure(c: Countermeasure, at: string): void {
    this.db
      .prepare(
        `INSERT INTO countermeasures (countermeasure_id, cause_id, description, reason, target, owner_team, priority, status,
           created_date, decided_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(c.countermeasureId, c.causeId, c.description, c.reason, c.target, c.ownerTeam, c.priority, c.status, c.createdDate, c.decidedBy)
    this.recordStatus('countermeasure', c.countermeasureId, null, c.status, at)
  }

  listAnomalies(): Anomaly[] {
    return (this.db.prepare(`${ACTIVE_ANOMALIES} ORDER BY a.anomaly_id DESC`).all() as Row[]).map(anomalyFromRow)
  }

  getAnomaly(id: string): Anomaly | null {
    const r = this.db.prepare(`${ACTIVE_ANOMALIES} WHERE a.anomaly_id = ?`).get(id) as Row | undefined
    return r ? anomalyFromRow(r) : null
  }

  listCauses(): CauseHypothesis[] {
    return (this.db.prepare(`${ACTIVE_CAUSES} ORDER BY h.cause_id DESC`).all() as Row[]).map(causeFromRow)
  }

  getCause(id: string): CauseHypothesis | null {
    const r = this.db.prepare(`${ACTIVE_CAUSES} WHERE h.cause_id = ?`).get(id) as Row | undefined
    return r ? causeFromRow(r) : null
  }

  listCountermeasures(): Countermeasure[] {
    return (this.db.prepare(`${ACTIVE_COUNTERMEASURES} ORDER BY c.countermeasure_id DESC`).all() as Row[]).map(countermeasureFromRow)
  }

  getCountermeasure(id: string): Countermeasure | null {
    const r = this.db.prepare(`${ACTIVE_COUNTERMEASURES} WHERE c.countermeasure_id = ?`).get(id) as Row | undefined
    return r ? countermeasureFromRow(r) : null
  }

  updateCauseReview(id: string, from: ReviewStatus, to: ReviewStatus, at: string): void {
    this.db.prepare('UPDATE cause_hypotheses SET review_status = ? WHERE cause_id = ?').run(to, id)
    this.recordStatus('cause', id, from, to, at)
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

  // Get raw daily metrics for a dataset, one row per date-metric-value combination
  rawDailyRows(datasetId: string): Array<{ date: string; metricKey: string; value: number }> {
    return (this.db.prepare('SELECT date, metric_key AS metricKey, value FROM daily_metrics WHERE dataset_id = ? ORDER BY date, metric_key').all(datasetId) as Row[]).map(
      (r) => ({ date: r.date, metricKey: r.metricKey, value: r.value })
    )
  }

  close(): void {
    this.db.close()
  }
}
