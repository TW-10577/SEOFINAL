import {
  type AnalysisResult,
  type Anomaly,
  type CauseHypothesis,
  type Countermeasure,
  type Measurement,
  type MeasurementDetail,
  type MeasurementRun,
  type SourceRef,
  type StateEvent,
} from '@seo/shared';
import type { AppConfig } from '../config.ts';
import { nowIso, parseJson, type DB } from '../db.ts';
import { nextTransitions, type GovernedEntity, type Ontology } from '../ontology.ts';

type Row = Record<string, any>;

const toRun = (r: Row): MeasurementRun => ({
  id: r.id,
  current: { start: r.current_start, end: r.current_end },
  previous: { start: r.previous_start, end: r.previous_end },
  createdAt: r.created_at,
  issues: parseJson(r.issues_json, []),
});

export function listRuns(db: DB): MeasurementRun[] {
  return (db.prepare('SELECT * FROM measurement_runs ORDER BY id DESC').all() as Row[]).map(toRun);
}

export function getRun(db: DB, id: number): MeasurementRun | null {
  const r = db.prepare('SELECT * FROM measurement_runs WHERE id = ?').get(id) as Row | undefined;
  return r ? toRun(r) : null;
}

export function latestRunId(db: DB): number | null {
  return (db.prepare('SELECT MAX(id) FROM measurement_runs').pluck().get() as number | null) ?? null;
}

const MEASUREMENT_SQL = `
  SELECT m.*, ar.subject_type, ar.subject_key, ar.metric, ar.previous_value, ar.current_value, ar.absolute_change, ar.change_rate,
         a.id AS anomaly_id, c.cause_text
  FROM measurements m
  LEFT JOIN analysis_results ar ON ar.id = m.analysis_result_id
  LEFT JOIN anomalies a ON a.measurement_id = m.id
  LEFT JOIN cause_hypotheses c ON c.anomaly_id = a.id`;

function toMeasurement(r: Row, cfg: AppConfig): Measurement {
  const rule = cfg.rules.find((x) => x.id === r.rule_id);
  return {
    id: r.id,
    runId: r.run_id,
    analysisResultId: r.analysis_result_id,
    name: r.measurement_name,
    ruleId: r.rule_id,
    ruleNumber: rule?.number ?? '',
    subjectType: r.subject_type ?? 'site',
    subjectKey: r.subject_key ?? rule?.subject ?? '',
    metric: r.metric ?? rule?.metric ?? '',
    previousValue: r.previous_value ?? null,
    currentValue: r.current_value ?? null,
    absoluteChange: r.absolute_change ?? null,
    changeRate: r.change_rate ?? null,
    thresholdValue: r.threshold_value,
    thresholdUnit: r.threshold_unit,
    result: r.result,
    status: r.status,
    reason: r.reason,
    createdAt: r.created_at,
    anomalyId: r.anomaly_id ?? null,
    causeSummary: r.cause_text ?? null,
  };
}

export function listMeasurements(db: DB, cfg: AppConfig, runId: number): Measurement[] {
  return (db.prepare(`${MEASUREMENT_SQL} WHERE m.run_id = ? ORDER BY m.id`).all(runId) as Row[]).map((r) => toMeasurement(r, cfg));
}

export function getMeasurementDetail(db: DB, cfg: AppConfig, id: number): MeasurementDetail | null {
  const r = db.prepare(`${MEASUREMENT_SQL} WHERE m.id = ?`).get(id) as Row | undefined;
  if (!r) return null;
  const measurement = toMeasurement(r, cfg);
  const run = getRun(db, r.run_id)!;
  const runRules = parseJson<typeof cfg.rules>((db.prepare('SELECT config_json FROM measurement_runs WHERE id = ?').pluck().get(r.run_id) as string) ?? '[]', []);
  const rule = runRules.find((x) => x.id === r.rule_id) ?? cfg.rules.find((x) => x.id === r.rule_id)!;
  const ar = r.analysis_result_id ? getAnalysisResult(db, r.analysis_result_id) : null;
  const anomaly = getAnomalyByMeasurement(db, id);
  const cause = anomaly ? getCause(db, anomaly.id) : null;
  const countermeasures = cause ? listCountermeasures(db, cause.id) : [];
  return {
    measurement,
    run,
    rule,
    analysisResult: ar,
    evidence: parseJson(r.evidence_json, { items: [], tables: [] }),
    sources: sourceRefs(db, id),
    anomaly,
    cause,
    countermeasures,
    events: eventsFor(db, anomaly, cause, countermeasures),
  };
}

/** The exact imported_data rows a measurement used, with their upload and source line. */
export function sourceRefs(db: DB, measurementId: number): SourceRef[] {
  return (
    db
      .prepare(
        `SELECT d.upload_id, u.file_name, d.source_record_id, rr.row_number, d.data_date, d.segment, d.query, d.page_url, d.metric_name, d.metric_value
         FROM measurement_sources ms
         JOIN imported_data d ON d.id = ms.imported_data_id
         JOIN uploads u ON u.id = d.upload_id
         JOIN raw_records rr ON rr.id = d.source_record_id
         WHERE ms.measurement_id = ?
         ORDER BY d.upload_id, d.data_date, rr.row_number, d.metric_name`,
      )
      .all(measurementId) as Row[]
  ).map((x) => ({
    uploadId: x.upload_id,
    fileName: x.file_name,
    sourceRecordId: x.source_record_id,
    rowNumber: x.row_number,
    dataDate: x.data_date,
    segment: x.segment ?? x.query ?? x.page_url,
    metricName: x.metric_name,
    metricValue: x.metric_value,
  }));
}

export function getAnalysisResult(db: DB, id: number): AnalysisResult | null {
  const r = db.prepare('SELECT * FROM analysis_results WHERE id = ?').get(id) as Row | undefined;
  return r ? toAnalysisResult(r) : null;
}

export function listAnalysisResults(db: DB, runId: number): AnalysisResult[] {
  return (db.prepare('SELECT * FROM analysis_results WHERE run_id = ? ORDER BY id').all(runId) as Row[]).map(toAnalysisResult);
}

const toAnalysisResult = (r: Row): AnalysisResult => ({
  id: r.id,
  runId: r.run_id,
  source: r.source,
  subjectType: r.subject_type,
  subjectKey: r.subject_key,
  metric: r.metric,
  current: { start: r.current_period_start, end: r.current_period_end },
  previous: { start: r.previous_period_start, end: r.previous_period_end },
  previousValue: r.previous_value,
  currentValue: r.current_value,
  absoluteChange: r.absolute_change,
  changeRate: r.change_rate,
  note: r.note,
});

const ANOMALY_SQL = `SELECT a.*, m.run_id FROM anomalies a JOIN measurements m ON m.id = a.measurement_id`;

const toAnomaly = (r: Row): Anomaly => ({
  id: r.id,
  measurementId: r.measurement_id,
  runId: r.run_id,
  subjectType: r.subject_type,
  subjectKey: r.subject_key,
  metric: r.metric,
  previousValue: r.previous_value,
  currentValue: r.current_value,
  change: r.change,
  changeRate: r.change_rate,
  detectionDate: r.detection_date,
  state: r.state,
});

export function listAnomalies(db: DB, runId?: number): Anomaly[] {
  const rows = runId ? db.prepare(`${ANOMALY_SQL} WHERE m.run_id = ? ORDER BY a.id`).all(runId) : db.prepare(`${ANOMALY_SQL} ORDER BY a.id DESC`).all();
  return (rows as Row[]).map(toAnomaly);
}

export function getAnomaly(db: DB, id: number): Anomaly | null {
  const r = db.prepare(`${ANOMALY_SQL} WHERE a.id = ?`).get(id) as Row | undefined;
  return r ? toAnomaly(r) : null;
}

function getAnomalyByMeasurement(db: DB, measurementId: number): Anomaly | null {
  const r = db.prepare(`${ANOMALY_SQL} WHERE a.measurement_id = ?`).get(measurementId) as Row | undefined;
  return r ? toAnomaly(r) : null;
}

export function getCause(db: DB, anomalyId: number): CauseHypothesis | null {
  const r = db.prepare('SELECT * FROM cause_hypotheses WHERE anomaly_id = ?').get(anomalyId) as Row | undefined;
  return r
    ? {
        id: r.id,
        anomalyId: r.anomaly_id,
        branch: r.branch,
        causeText: r.cause_text,
        supportingEvidence: parseJson(r.supporting_evidence, { items: [], tables: [] }),
        confidence: r.confidence,
        confidenceReason: r.confidence_reason,
        reviewStatus: r.review_status,
        createdAt: r.created_at,
      }
    : null;
}

export function listCountermeasures(db: DB, causeId: number): Countermeasure[] {
  return (db.prepare('SELECT * FROM countermeasures WHERE cause_id = ? ORDER BY id').all(causeId) as Row[]).map((r) => ({
    id: r.id,
    causeId: r.cause_id,
    actionText: r.action_text,
    reason: r.reason,
    target: r.target,
    responsibleTeam: r.responsible_team,
    status: r.status,
    createdAt: r.created_at,
  }));
}

function eventsFor(db: DB, anomaly: Anomaly | null, cause: CauseHypothesis | null, cms: Countermeasure[]): StateEvent[] {
  const pairs: [string, number][] = [];
  if (anomaly) pairs.push(['anomaly', anomaly.id]);
  if (cause) pairs.push(['cause', cause.id]);
  for (const k of cms) pairs.push(['countermeasure', k.id]);
  if (!pairs.length) return [];
  const where = pairs.map(() => '(entity = ? AND entity_id = ?)').join(' OR ');
  return (db.prepare(`SELECT * FROM state_events WHERE ${where} ORDER BY id`).all(...pairs.flat()) as Row[]).map(toEvent);
}

export const toEvent = (r: Row): StateEvent => ({
  id: r.id,
  entity: r.entity,
  entityId: r.entity_id,
  fromState: r.from_state,
  toState: r.to_state,
  actor: r.actor,
  note: r.note,
  at: r.at,
});

// ---------- SEO team decisions ----------

export class TransitionError extends Error {}

const TABLES: Record<GovernedEntity, { table: string; column: string }> = {
  anomaly: { table: 'anomalies', column: 'state' },
  cause: { table: 'cause_hypotheses', column: 'review_status' },
  countermeasure: { table: 'countermeasures', column: 'status' },
};

/**
 * Records an SEO team decision. Only transitions declared in the ontology lifecycle
 * (LOGOS_SEO_Ontology_Standalone_Final) are allowed; an actor is required.
 */
export function changeState(db: DB, ont: Ontology, entity: GovernedEntity, id: number, to: string, actor: string, note = ''): void {
  const t = TABLES[entity];
  if (!actor.trim()) throw new TransitionError('A reviewer name is required.');
  db.transaction(() => {
    const from = db.prepare(`SELECT ${t.column} FROM ${t.table} WHERE id = ?`).pluck().get(id) as string | undefined;
    if (from === undefined) throw new TransitionError(`${entity} ${id} not found.`);
    const transition = nextTransitions(ont, entity, from).find((x) => x.to === to);
    if (!transition) throw new TransitionError(`${entity} cannot move from ${from} to ${to} (not a transition in the ontology lifecycle).`);
    db.prepare(`UPDATE ${t.table} SET ${t.column} = ? WHERE id = ?`).run(to, id);
    db.prepare('INSERT INTO state_events (entity, entity_id, from_state, to_state, actor, note, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(entity, id, from, to, actor.trim(), note, nowIso());
  })();
}
