import {
  type Amendment,
  type AnalysisResult,
  type BasisRow,
  type RuleConfig,
  type WhyNg,
  type Anomaly,
  type CauseHypothesis,
  type Countermeasure,
  type Measurement,
  type MeasurementDetail,
  type MeasurementRun,
  type Monitoring,
  type MonitoringItem,
  type SourceRef,
  type StateEvent,
} from '@seo/shared';
import { ruleMetric, type AppConfig, type SegmentRole } from '../config.ts';
import { nowIso, parseJson, type DB } from '../db.ts';
import { cat, dec, enc, tx, type LText } from '../i18n.ts';
import { explainResult, NOT_EVALUABLE_REASON } from './logic.ts';
import { EDIT_ACTIONS, guardHolds, lifecycleOf, nextTransitions, stateCode, type Guard, type GovernedEntity, type Ontology } from '../ontology.ts';

type Row = Record<string, any>;

async function toRun(db: DB, r: Row): Promise<MeasurementRun> {
  const s = parseJson<{ uploadIds?: number[]; includeTestData?: boolean } | null>(r.scope_json ?? 'null', null);
  const ids = s?.uploadIds ?? [];
  const files = ids.length ? await db.values<string>(`SELECT file_name FROM uploads WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ...ids) : [];
  return {
    id: r.id,
    current: { start: r.current_start, end: r.current_end },
    previous: { start: r.previous_start, end: r.previous_end },
    createdAt: r.created_at,
    issues: parseJson(r.issues_json, []),
    scope: { uploadIds: ids, files, includeTestData: s?.includeTestData ?? null },
  };
}

export async function listRuns(db: DB): Promise<MeasurementRun[]> {
  const out: MeasurementRun[] = [];
  for (const r of await db.all('SELECT * FROM measurement_runs ORDER BY id DESC')) out.push(await toRun(db, r));
  return out;
}

export async function getRun(db: DB, id: number): Promise<MeasurementRun | null> {
  const r = await db.get('SELECT * FROM measurement_runs WHERE id = ?', id);
  return r ? toRun(db, r) : null;
}

export async function latestRunId(db: DB): Promise<number | null> {
  return (await db.value<number | null>('SELECT MAX(id) FROM measurement_runs')) ?? null;
}

const MEASUREMENT_SQL = `
  SELECT m.*, ar.subject_type, ar.subject_key, ar.metric, ar.previous_value, ar.current_value, ar.absolute_change, ar.change_rate,
         a.id AS anomaly_id, c.cause_text, c.analysis_json,
         EXISTS (SELECT 1 FROM amendments x WHERE x.entity = 'cause' AND x.entity_id = c.id) AS cause_amended
  FROM measurements m
  LEFT JOIN analysis_results ar ON ar.id = m.analysis_result_id
  LEFT JOIN anomalies a ON a.measurement_id = m.id
  LEFT JOIN cause_hypotheses c ON c.anomaly_id = a.id`;

async function toMeasurement(db: DB, r: Row, cfg: AppConfig): Promise<Measurement> {
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
    reason: plainReason(r, r.metric ?? rule?.metric ?? ''),
    createdAt: r.created_at,
    anomalyId: r.anomaly_id ?? null,
    // Short possible cause: the SEO team's text when modified, else the generated title.
    causeSummary: r.cause_text == null ? null : r.cause_amended ? r.cause_text : (parseJson<{ title?: string } | null>(r.analysis_json, null)?.title ?? r.cause_text),
    analysisUnit: rule?.analysisUnit ?? '',
    caveats: rule ? ruleCaveats(cfg, rule.id) : [],
    ruleCode: rule?.code ?? r.rule_id,
    criteria: rule?.criteria ?? '',
    dataKind: dec(r.result).en.startsWith('[TEST DATA]') ? 'test' : 'real',
    basis: await basisFor(db, cfg, r.run_id, r.rule_id, r.status),
    why: r.status === 'NG' && r.anomaly_id ? await whyNg(db, r, rule) : null,
  };
}

/**
 * The result in plain words, built from the stored figures so runs saved with the older technical text read the same:
 * OK / NG → direction, size and threshold; NOT_EVALUABLE → the standard sentence and the stored specific reason.
 */
function plainReason(r: Row, metric: string): string {
  const plain = explainResult({ status: r.status, metric, rate: r.change_rate ?? null, threshold: r.threshold_value, unit: r.threshold_unit });
  if (plain) return enc(plain);
  const stored = dec(r.reason);
  if (r.status !== 'NOT_EVALUABLE' || stored.en.startsWith(NOT_EVALUABLE_REASON.en)) return r.reason;
  return enc(cat([NOT_EVALUABLE_REASON, stored]));
}

/**
 * The figures behind a result (from the run's analysis results): the figure the rule judges, then the
 * figures its primary judgment looks at, for reference. M1: total, organic, advertising sessions.
 * M2: CVR, sessions, CV (site total).
 */
async function basisFor(db: DB, cfg: AppConfig, runId: number, ruleId: string, status: string): Promise<BasisRow[]> {
  const results = await db.all('SELECT * FROM analysis_results WHERE run_id = ? ORDER BY id', runId);
  const find = (role: SegmentRole, metric: string) => results.find((x) => x.subject_key === cfg.segments[role].value && x.metric === metric);
  const ref = tx(' (for reference)', '（参考）');
  const row = (role: SegmentRole, metric: string, label: ReturnType<typeof tx>, judged: boolean): BasisRow | null => {
    const x = find(role, metric);
    if (!x) return null;
    const seg = cfg.segments[role].value;
    return {
      label: enc(tx(`${label.en} — ${seg}${judged ? '' : ref.en}`, `${label.ja} — ${seg}${judged ? '' : ref.ja}`)),
      metric,
      previous: x.previous_value,
      current: x.current_value,
      absoluteChange: x.absolute_change,
      changeRate: x.change_rate,
      status: judged ? (status as BasisRow['status']) : null,
    };
  };
  const kind = ruleMetric(cfg, ruleId);
  const rows =
    kind === 'sessions'
      ? [row('total', 'sessions', tx('Total sessions', '全体セッション'), true), row('organic', 'sessions', tx('Organic sessions', 'オーガニック流入のセッション'), false), row('advertising', 'sessions', tx('Advertising sessions', '広告流入のセッション'), false)]
      : kind === 'cvr'
        ? [row('total', 'cvr', tx('CVR (%) = CV ÷ Sessions × 100', 'CVR (%) = CV ÷ セッション × 100'), true), row('total', 'sessions', tx('Sessions', 'セッション'), false), row('total', 'cv', tx('CV', 'CV'), false)]
        : [];
  return rows.filter((x): x is BasisRow => !!x);
}

/** NG only: the likely cause (hypothesis) and the next step — the countermeasure if proposed, else the missing evidence. */
async function whyNg(db: DB, r: Row, rule: RuleConfig | undefined): Promise<WhyNg | null> {
  const c = await db.get('SELECT * FROM cause_hypotheses WHERE anomaly_id = ?', r.anomaly_id);
  const name = dec(r.measurement_name);
  const title = enc(tx(`Why NG — ${name.en}`, `NG の理由 — ${name.ja}`));
  if (!c) return { title, likelyCause: enc(tx('No cause hypothesis was generated.', '原因仮説は生成されていません。')), confidence: null, nextStep: rule?.whatToCheckNext ?? '', nextStepKind: 'rule', team: null, feedback: null };
  const analysis = parseJson<{ title: string; facts: string[]; missing: string[] } | null>(c.analysis_json, null);
  const amended = await db.get(`SELECT 1 FROM amendments WHERE entity = 'cause' AND entity_id = ?`, c.id);
  // The GA4 fact first (which channel fell, by how much), then the hypothesis.
  const dot = (t: LText) => tx(/[.。]$/.test(t.en) ? t.en : `${t.en}.`, /[.。]$/.test(t.ja) ? t.ja : `${t.ja}。`);
  const likelyCause = amended ? enc(dec(c.cause_text)) : analysis ? enc(cat([analysis.facts[0] ? dec(analysis.facts[0]) : tx(''), dot(dec(analysis.title))])) : c.cause_text;
  const k = await db.get('SELECT action_text, status, reason, responsible_team FROM countermeasures WHERE cause_id = ? ORDER BY id LIMIT 1', c.id);
  if (k)
    return {
      title,
      likelyCause,
      confidence: c.confidence,
      nextStep: enc(cat([dec(k.action_text), tx(`(countermeasure: ${k.status})`, `（対策：${k.status}）`)])),
      nextStepKind: 'countermeasure',
      team: k.responsible_team ?? null,
      feedback: k.reason || null,
    };
  if (analysis?.missing.length)
    return {
      title,
      likelyCause,
      confidence: c.confidence,
      nextStep: enc(cat([tx('Provide the missing evidence to determine the cause:', '原因を特定するため、不足している根拠を用意してください：'), ...analysis.missing.map(dec)], ' ')),
      nextStepKind: 'evidence',
      team: null,
      feedback: null,
    };
  return { title, likelyCause, confidence: c.confidence, nextStep: rule?.whatToCheckNext ?? '', nextStepKind: 'rule', team: null, feedback: null };
}

/** Unconfirmed client mappings a rule's result depends on (shown next to the result). */
export function ruleCaveats(cfg: AppConfig, ruleId: string): string[] {
  const kind = ruleMetric(cfg, ruleId);
  const roles: SegmentRole[] = kind === 'sessions' ? ['total', 'organic', 'advertising'] : ['total'];
  const roleText: Record<SegmentRole, ReturnType<typeof tx>> = { total: tx('total', '全体'), organic: tx('organic traffic', 'オーガニック流入'), advertising: tx('advertising traffic', '広告流入') };
  const out = roles
    .filter((x) => !cfg.segments[x].confirmed)
    .map((x) => enc(tx(`GA4 segment "${cfg.segments[x].value}" as ${roleText[x].en} — unconfirmed`, `GA4 セグメント「${cfg.segments[x].value}」を${roleText[x].ja}として使用 — 未確認`)));
  if (kind === 'cvr' && !cfg.metricNames.cv.confirmed)
    out.push(enc(tx(`CV = GA4 column "${cfg.metricNames.cv.value[0]}" — unconfirmed`, `CV = GA4 の列「${cfg.metricNames.cv.value[0]}」— 未確認`)));
  return out;
}

export async function listMeasurements(db: DB, cfg: AppConfig, runId: number): Promise<Measurement[]> {
  const out: Measurement[] = [];
  for (const r of await db.all(`${MEASUREMENT_SQL} WHERE m.run_id = ? ORDER BY m.id`, runId)) out.push(await toMeasurement(db, r, cfg));
  return out;
}

export async function getMeasurementDetail(db: DB, cfg: AppConfig, id: number, ont?: Ontology): Promise<MeasurementDetail | null> {
  const r = await db.get(`${MEASUREMENT_SQL} WHERE m.id = ?`, id);
  if (!r) return null;
  const measurement = await toMeasurement(db, r, cfg);
  const run = (await getRun(db, r.run_id))!;
  const runRules = parseJson<typeof cfg.rules>((await db.value<string>('SELECT config_json FROM measurement_runs WHERE id = ?', r.run_id)) ?? '[]', []);
  const rule = runRules.find((x) => x.id === r.rule_id) ?? cfg.rules.find((x) => x.id === r.rule_id)!;
  const ar = r.analysis_result_id ? await getAnalysisResult(db, r.analysis_result_id) : null;
  const anomaly = await getAnomalyByMeasurement(db, id);
  if (anomaly && ont) anomaly.blocked = await blockedTransitions(db, ont, 'anomaly', anomaly.id, anomaly.state);
  const cause = anomaly ? await getCause(db, anomaly.id, ont) : null;
  const countermeasures = cause ? await listCountermeasures(db, cause.id, ont) : [];
  return {
    measurement,
    run,
    rule,
    analysisResult: ar,
    evidence: parseJson(r.evidence_json, { items: [], tables: [] }),
    sources: await sourceRefs(db, id),
    anomaly,
    cause,
    countermeasures,
    events: await eventsFor(db, anomaly, cause, countermeasures),
  };
}

/** The exact imported_data rows a measurement used, with their upload and source line. */
export async function sourceRefs(db: DB, measurementId: number): Promise<SourceRef[]> {
  return (
    await db.all(
        `SELECT d.upload_id, u.file_name, d.source_record_id, rr.row_number, d.data_date, d.segment, d.query, d.page_url, d.metric_name, d.metric_value
         FROM measurement_sources ms
         JOIN imported_data d ON d.id = ms.imported_data_id
         JOIN uploads u ON u.id = d.upload_id
         JOIN raw_records rr ON rr.id = d.source_record_id
         WHERE ms.measurement_id = ?
         ORDER BY d.upload_id, d.data_date NULLS FIRST, rr.row_number, d.metric_name, d.id`,
        measurementId,
    )
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

export async function getAnalysisResult(db: DB, id: number): Promise<AnalysisResult | null> {
  const r = await db.get('SELECT * FROM analysis_results WHERE id = ?', id);
  return r ? toAnalysisResult(r) : null;
}

/** Uploaded files a run used, with how many values and which rules used them. */
export async function runDataUsed(db: DB, runId: number): Promise<{ uploadId: number; fileName: string; source: string | null; values: number; rules: string[] }[]> {
  const rows = await db.all<{ id: number; file_name: string; source: string | null; rule_id: string; n: number }>(
      `SELECT u.id, u.file_name, u.source, m.rule_id, COUNT(*) AS n
       FROM measurement_sources ms
       JOIN measurements m ON m.id = ms.measurement_id
       JOIN imported_data d ON d.id = ms.imported_data_id
       JOIN uploads u ON u.id = d.upload_id
       WHERE m.run_id = ? GROUP BY u.id, m.rule_id ORDER BY u.id, MIN(m.id)`,
      runId,
  );
  const out = new Map<number, { uploadId: number; fileName: string; source: string | null; values: number; rules: string[] }>();
  for (const r of rows) {
    const e = out.get(r.id) ?? { uploadId: r.id, fileName: r.file_name, source: r.source, values: 0, rules: [] };
    e.values += r.n;
    e.rules.push(r.rule_id);
    out.set(r.id, e);
  }
  return [...out.values()];
}

export async function listAnalysisResults(db: DB, runId: number): Promise<AnalysisResult[]> {
  return (await db.all('SELECT * FROM analysis_results WHERE run_id = ? ORDER BY id', runId)).map(toAnalysisResult);
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

export async function listAnomalies(db: DB, runId?: number): Promise<Anomaly[]> {
  const rows = runId ? await db.all(`${ANOMALY_SQL} WHERE m.run_id = ? ORDER BY a.id`, runId) : await db.all(`${ANOMALY_SQL} ORDER BY a.id DESC`);
  return rows.map(toAnomaly);
}

export async function getAnomaly(db: DB, id: number): Promise<Anomaly | null> {
  const r = await db.get(`${ANOMALY_SQL} WHERE a.id = ?`, id);
  return r ? toAnomaly(r) : null;
}

async function getAnomalyByMeasurement(db: DB, measurementId: number): Promise<Anomaly | null> {
  const r = await db.get(`${ANOMALY_SQL} WHERE a.measurement_id = ?`, measurementId);
  return r ? toAnomaly(r) : null;
}

export async function getCause(db: DB, anomalyId: number, ont?: Ontology): Promise<CauseHypothesis | null> {
  const r = await db.get('SELECT * FROM cause_hypotheses WHERE anomaly_id = ?', anomalyId);
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
        analysis: parseJson(r.analysis_json, null),
        amendments: await amendmentsOf(db, 'cause', r.id),
        editable: !!ont && editable(ont, 'cause', r.review_status),
      }
    : null;
}

export async function listCountermeasures(db: DB, causeId: number, ont?: Ontology): Promise<Countermeasure[]> {
  const out: Countermeasure[] = [];
  for (const r of await db.all('SELECT * FROM countermeasures WHERE cause_id = ? ORDER BY id', causeId))
    out.push({
    id: r.id,
    causeId: r.cause_id,
    actionText: r.action_text,
    reason: r.reason,
    target: r.target,
    targetType: r.target_type ?? null,
    targetKey: r.target_key ?? null,
    responsibleTeam: r.responsible_team,
    status: r.status,
    createdAt: r.created_at,
    amendments: await amendmentsOf(db, 'countermeasure', r.id),
    editable: !!ont && editable(ont, 'countermeasure', r.status),
    blocked: ont ? await blockedTransitions(db, ont, 'countermeasure', r.id, r.status) : undefined,
  });
  return out;
}

async function amendmentsOf(db: DB, entity: 'cause' | 'countermeasure', id: number): Promise<Amendment[]> {
  return (await db.all('SELECT * FROM amendments WHERE entity = ? AND entity_id = ? ORDER BY id', entity, id)).map((a) => ({
    id: a.id,
    field: a.field,
    oldValue: a.old_value,
    newValue: a.new_value,
    actor: a.actor,
    note: a.note,
    at: a.at,
  }));
}

async function eventsFor(db: DB, anomaly: Anomaly | null, cause: CauseHypothesis | null, cms: Countermeasure[]): Promise<StateEvent[]> {
  const pairs: [string, number][] = [];
  if (anomaly) pairs.push(['anomaly', anomaly.id]);
  if (cause) pairs.push(['cause', cause.id]);
  for (const k of cms) pairs.push(['countermeasure', k.id]);
  if (!pairs.length) return [];
  const where = pairs.map(() => '(entity = ? AND entity_id = ?)').join(' OR ');
  return (await db.all(`SELECT * FROM state_events WHERE ${where} ORDER BY id`, ...pairs.flat())).map(toEvent);
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
export async function changeState(db: DB, ont: Ontology, entity: GovernedEntity, id: number, to: string, actor: string, note = ''): Promise<void> {
  const t = TABLES[entity];
  if (!actor.trim()) throw new TransitionError('A reviewer name is required.');
  await db.transaction(async () => {
    const from = await db.value<string>(`SELECT ${t.column} FROM ${t.table} WHERE id = ?`, id);
    if (from === undefined) throw new TransitionError(`${entity} ${id} not found.`);
    const transition = nextTransitions(ont, entity, from).find((x) => x.to === to);
    if (!transition) throw new TransitionError(`${entity} cannot move from ${from} to ${to} (not a transition in the ontology lifecycle).`);
    const context = await guardContext(db, ont, entity, id);
    const failed = transition.guards.find((g) => !guardHolds(g, context));
    if (failed) throw new TransitionError(guardMessage(failed));
    await db.run(`UPDATE ${t.table} SET ${t.column} = ? WHERE id = ?`, to, id);
    await db.run('INSERT INTO state_events (entity, entity_id, from_state, to_state, actor, note, at) VALUES (?, ?, ?, ?, ?, ?, ?)', entity, id, from, to, actor.trim(), note, nowIso());
  });
}

// ---------- Ontology guards (LOGOS LIF-10) ----------
// Guards in the YAML read related-object facts from `context`; this resolver supplies them.

async function guardContext(db: DB, ont: Ontology, entity: GovernedEntity, id: number): Promise<Record<string, unknown>> {
  if (entity === 'countermeasure') {
    const review = await db.value<string>('SELECT c.review_status FROM countermeasures k JOIN cause_hypotheses c ON c.id = k.cause_id WHERE k.id = ?', id);
    return review ? { causeReviewStatus: stateCode(ont, 'cause', review) } : {};
  }
  if (entity === 'anomaly') {
    const n = (await db.value<number>(
        `SELECT COUNT(*) FROM countermeasures k JOIN cause_hypotheses c ON c.id = k.cause_id
         WHERE c.anomaly_id = ? AND k.status IN ('Approved', 'InProgress', 'Completed', 'VerifiedEffective', 'VerifiedIneffective')`,
        id,
    ))!;
    return { hasApprovedCountermeasure: n > 0 };
  }
  return {};
}

const GUARD_TEXT: Record<string, ReturnType<typeof tx>> = {
  causeReviewStatus: tx('Confirm the cause first — a countermeasure can be approved only for a confirmed cause.', '先に原因を確定してください — 対策は確定した原因に対してのみ承認できます。'),
  hasApprovedCountermeasure: tx('Approve a countermeasure first — the anomaly can be assigned only when it has an approved countermeasure.', '先に対策を承認してください — 承認済みの対策がある場合のみ異常を割り当てできます。'),
};

function guardMessage(g: Guard): string {
  return enc(GUARD_TEXT[g.fact] ?? tx(`Ontology guard not met: ${g.text}`, `オントロジーのガード条件を満たしていません：${g.text}`));
}

/** Transitions from `state` whose guard does not hold, with the reason (for the UI). */
export async function blockedTransitions(db: DB, ont: Ontology, entity: GovernedEntity, id: number, state: string): Promise<Record<string, string>> {
  const context = await guardContext(db, ont, entity, id);
  const out: Record<string, string> = {};
  for (const t of nextTransitions(ont, entity, state)) {
    const failed = t.guards.find((g) => !guardHolds(g, context));
    if (failed) out[t.to] = guardMessage(failed);
  }
  return out;
}

// ---------- SEO team edits: modify the cause / adjust the countermeasure ----------

function editable(ont: Ontology, entity: 'cause' | 'countermeasure', state: string): boolean {
  return (lifecycleOf(ont, entity).allowed[state] ?? []).includes(EDIT_ACTIONS[entity]);
}

const EDIT_FIELD = { cause: { table: 'cause_hypotheses', column: 'cause_text', state: 'review_status' }, countermeasure: { table: 'countermeasures', column: 'action_text', state: 'status' } } as const;

/** Replaces the generated text with the SEO team's text; the previous text is kept in amendments. */
export async function amendText(db: DB, ont: Ontology, entity: 'cause' | 'countermeasure', id: number, text: string, actor: string, note = ''): Promise<void> {
  const f = EDIT_FIELD[entity];
  if (!actor.trim()) throw new TransitionError('A reviewer name is required.');
  if (!text.trim()) throw new TransitionError('The new text is empty.');
  await db.transaction(async () => {
    const row = await db.get<{ text: string; state: string }>(`SELECT ${f.column} AS text, ${f.state} AS state FROM ${f.table} WHERE id = ?`, id);
    if (!row) throw new TransitionError(`${entity} ${id} not found.`);
    if (!editable(ont, entity, row.state))
      throw new TransitionError(enc(tx(`The ${entity} cannot be changed in state ${row.state} (ontology allowedActionRefs).`, `状態 ${row.state} では変更できません（オントロジーの allowedActionRefs）。`)));
    await db.run(`UPDATE ${f.table} SET ${f.column} = ? WHERE id = ?`, text.trim(), id);
    await db.run(
      'INSERT INTO amendments (entity, entity_id, field, old_value, new_value, actor, note, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      entity, id, f.column, row.text, text.trim(), actor.trim(), note, nowIso(),
    );
  });
}

// ---------- Weekly monitoring ----------

/** Each rule's result compared with the previous week's run; open and closed anomalies. */
export async function monitoring(db: DB, runId: number): Promise<Monitoring> {
  const run = await db.get('SELECT * FROM measurement_runs WHERE id = ?', runId);
  if (!run) return { previousRun: null, items: [], openFromEarlier: 0, closed: 0 };
  const prev = await db.get('SELECT * FROM measurement_runs WHERE current_end < ? ORDER BY current_end DESC, id DESC LIMIT 1', run.current_end);
  const statuses = async (id: number) =>
    new Map((await db.all('SELECT rule_id, status, measurement_name FROM measurements WHERE run_id = ? ORDER BY id', id)).map((m) => [m.rule_id as string, m]));
  const cur = await statuses(runId);
  const before = prev ? await statuses(prev.id) : new Map<string, Row>();
  const items: MonitoringItem[] = [...cur.values()].map((m) => {
    const p = (before.get(m.rule_id)?.status ?? null) as MonitoringItem['previous'];
    const change: MonitoringItem['change'] = m.status === 'NG' ? (p === 'NG' ? 'continuing' : 'new') : p === 'NG' && m.status === 'OK' ? 'cleared' : 'unchanged';
    return { ruleId: m.rule_id, name: m.measurement_name, previous: p, current: m.status, change };
  });
  const count = async (sql: string, ...args: unknown[]) => (await db.value<number>(sql, ...args))!;
  return {
    previousRun: prev ? { id: prev.id, current: { start: prev.current_start, end: prev.current_end } } : null,
    items,
    openFromEarlier: await count(
      `SELECT COUNT(*) FROM anomalies a JOIN measurements m ON m.id = a.measurement_id JOIN measurement_runs r ON r.id = m.run_id
       WHERE r.current_end < ? AND a.state NOT IN ('Resolved', 'Dismissed')`,
      run.current_end,
    ),
    closed: await count(`SELECT COUNT(*) FROM anomalies WHERE state IN ('Resolved', 'Dismissed')`),
  };
}
