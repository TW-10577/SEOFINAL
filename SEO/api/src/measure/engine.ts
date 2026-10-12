// Measurement run: period comparison → client rules → OK / NG / NOT_EVALUABLE
// → SEO Anomaly (NG only) → Cause Hypothesis → Countermeasure (Proposed).
import type { Confidence, Evidence, EvidenceItem, EvidenceTable, GscInvestigation, Issue, Period, RuleConfig } from '@seo/shared';
import { causeTypeText, inputNames, scopeIds, scopeSql, type AppConfig, type Branch, type FieldSpec, type Outcome, type RuleSpec, type SegmentRole } from '../config.ts';
import { evalCondition, evalNumber, variablesOf, type Vars } from './expr.ts';
import { runGscInvestigation, triggered } from './gsc-investigation.ts';
import { nowIso, parseJson, type DB } from '../db.ts';
import { cat, dec, enc, tx, type LText } from '../i18n.ts';
import { investigateAdvertising, investigateOrganic, type CauseAnalysis, type Finding, type TargetType } from './investigate.ts';
import { defaultCurrentEnd } from '../periods.ts';
import { change, explainResult, fmtNum, fmtPct, NOT_EVALUABLE_REASON, ratio, type Change, type Judgment } from './logic.ts';
import { dailySeries, daysOf, describeMissing, overlapIssues, sumPeriod, weekPeriods, type DailySeries, type PeriodSum } from './series.ts';

export interface RunOptions {
  /** Last day of the current week (yyyy-mm-dd). Default: the newest valid period detected in the GA4 data. */
  currentEnd?: string;
}

interface Periods {
  current: Period;
  previous: Period;
}

interface Pair {
  prev: PeriodSum;
  cur: PeriodSum;
}

// Generated text is bilingual (LText); string-typed fields hold enc(LText).
interface CauseDraft {
  branch: string;
  text: LText;
  confidence: Confidence;
  confidenceReason: LText;
  evidence: Evidence;
  /** Investigation behind the hypothesis (rule ①); null for rule ②. */
  analysis?: CauseAnalysis | null;
  countermeasures: { action: LText; reason: LText; target: LText; targetType: TargetType; targetKey: string; team: LText | null }[];
}

interface MeasurementDraft {
  rule: RuleConfig;
  analysisResultId: number | null;
  judgment: Judgment;
  evidence: Evidence;
  importedDataIds: number[];
  /** Analysis unit the anomaly is DETECTED_ON (ontology): the site for both client rules. */
  subjectType: TargetType;
  subject: string;
  metric: string;
  change: Change | null;
  cause: CauseDraft | null;
}

export async function latestGa4Date(db: DB, cfg: AppConfig): Promise<string | null> {
  const row = await db.get<{ d: string | null }>(
    `SELECT MAX(data_date) AS d FROM imported_data WHERE source = 'GA4' AND is_valid = 1 AND segment = ? AND data_date IS NOT NULL`,
    cfg.segments.total.value,
  );
  return row?.d ?? null;
}

export async function runMeasurements(db: DB, cfg: AppConfig, opts: RunOptions = {}): Promise<number> {
  const end = opts.currentEnd ?? (await defaultCurrentEnd(db, cfg, 'GA4'));
  const issues: Issue[] = [];
  if (!end)
    issues.push({
      severity: 'error',
      code: 'no-ga4-data',
      message: enc(tx('No valid GA4 daily data for the total segment — nothing can be measured.', '全体セグメントの有効な GA4 日次データがないため、測定できません。')),
    });
  const periods = weekPeriods(end ?? new Date().toISOString().slice(0, 10));

  // The import context the run was made for (upload ids, test data), so the flow can find this run again.
  const scope = runScopeJson(cfg);
  return db.transaction(async () => {
    await replaceUntouchedRuns(db, periods, scope);
    const runId = await db.insert(
      `INSERT INTO measurement_runs (current_start, current_end, previous_start, previous_end, created_at, config_json, issues_json, scope_json) VALUES (?, ?, ?, ?, ?, ?, '[]', ?)`,
      periods.current.start, periods.current.end, periods.previous.start, periods.previous.end, nowIso(), JSON.stringify(cfg.rules), scope,
    );

    const ga4 = await loadGa4(db, cfg, periods, issues);
    const results = await storeAnalysisResults(db, cfg, runId, periods, ga4);

    // Only GA4 rules exist in SEO.txt; each rule judges the data of its own source.
    // Every GA4 rule in rules.yaml, evaluated as written there.
    for (const rule of cfg.rules.filter((r) => r.source === 'GA4')) await persistMeasurement(db, runId, await measureRule(db, cfg, rule, periods, results));
    await db.run('UPDATE measurement_runs SET issues_json = ? WHERE id = ?', JSON.stringify(issues), runId);
    return runId;
  });
}

/** Stored run scope: the context's upload ids (empty = all data) and whether test data was included. */
export function runScopeJson(cfg: AppConfig): string {
  return JSON.stringify({ uploadIds: cfg.scope?.uploadIds ?? [], includeTestData: cfg.dataPolicy.evaluateSyntheticData });
}

/** A re-run of the same weeks and context replaces the earlier run unless the SEO team has already acted on it. */
async function replaceUntouchedRuns(db: DB, p: Periods, scope: string) {
  const runs = await db.values<number>(
    'SELECT id FROM measurement_runs WHERE current_start = ? AND current_end = ? AND previous_start = ? AND previous_end = ? AND COALESCE(scope_json, ?) = ?',
    p.current.start, p.current.end, p.previous.start, p.previous.end, runScopeJson({ dataPolicy: { evaluateSyntheticData: true } } as AppConfig), scope,
  );
  for (const id of runs) {
    const touched = await db.value<number>(
        `SELECT COUNT(*) FROM state_events e WHERE
           (e.entity = 'anomaly' AND e.entity_id IN (SELECT a.id FROM anomalies a JOIN measurements m ON m.id = a.measurement_id WHERE m.run_id = ?))
        OR (e.entity = 'cause' AND e.entity_id IN (SELECT c.id FROM cause_hypotheses c JOIN anomalies a ON a.id = c.anomaly_id JOIN measurements m ON m.id = a.measurement_id WHERE m.run_id = ?))
        OR (e.entity = 'countermeasure' AND e.entity_id IN (SELECT k.id FROM countermeasures k JOIN cause_hypotheses c ON c.id = k.cause_id JOIN anomalies a ON a.id = c.anomaly_id JOIN measurements m ON m.id = a.measurement_id WHERE m.run_id = ?))`,
        id, id, id,
    );
    if (!touched) await db.run('DELETE FROM measurement_runs WHERE id = ?', id);
  }
}

// ---------- GA4 inputs ----------

interface Ga4Inputs {
  periods: Periods;
  sessions: Partial<Record<SegmentRole, Pair>>;
  cv: Partial<Record<SegmentRole, Pair>>;
  series: { sessions: Partial<Record<SegmentRole, DailySeries>>; cv: Partial<Record<SegmentRole, DailySeries>> };
  /** Other GA4 segments present in daily data (shown on the Data page / analysis results only). */
  otherSegments: string[];
}

async function loadGa4(db: DB, cfg: AppConfig, periods: Periods, issues: Issue[]): Promise<Ga4Inputs> {
  const out: Ga4Inputs = { periods, sessions: {}, cv: {}, series: { sessions: {}, cv: {} }, otherSegments: [] };
  for (const role of ['total', 'organic', 'advertising'] as SegmentRole[]) {
    const segment = cfg.segments[role].value;
    const includeSynthetic = cfg.dataPolicy.evaluateSyntheticData;
    const s = await dailySeries(db, { source: 'GA4', segment, sourceMetricNames: cfg.metricNames.sessions.value, includeSynthetic, uploadIds: scopeIds(cfg, 'GA4') });
    const c = await dailySeries(db, { source: 'GA4', segment, sourceMetricNames: cfg.metricNames.cv.value, includeSynthetic, uploadIds: scopeIds(cfg, 'GA4') });
    out.series.sessions[role] = s;
    out.series.cv[role] = c;
    if (s.byDate.size) out.sessions[role] = { prev: sumPeriod(s, periods.previous), cur: sumPeriod(s, periods.current) };
    if (c.byDate.size) out.cv[role] = { prev: sumPeriod(c, periods.previous), cur: sumPeriod(c, periods.current) };
    issues.push(...overlapIssues(tx(`GA4 ${segment} sessions`, `GA4 ${segment} のセッション`), s));
    if (role === 'total') issues.push(...syntheticIssues(s, periods, includeSynthetic));
  }
  const mapped = new Set(Object.values(cfg.segments).map((m) => m.value));
  out.otherSegments = (
    await db.values<string>(`SELECT DISTINCT segment FROM imported_data WHERE source = 'GA4' AND is_valid = 1 AND data_date IS NOT NULL AND segment IS NOT NULL${scopeSql(cfg, 'GA4').sql}`, ...scopeSql(cfg, 'GA4').args)
  ).filter((s) => !mapped.has(s));
  return out;
}

const complete = (p: Pair | undefined): p is Pair => !!p && p.prev.value !== null && p.cur.value !== null;
const pairChange = (p: Pair): Change => change(p.prev.value!, p.cur.value!);

const NOT_EVALUABLE = tx('Not evaluable', '評価不可');
const MISSING = tx('missing', '欠損');

function missingNote(p: Pair | undefined, what: LText): LText {
  if (!p) return tx(`No ${what.en} data uploaded.`, `${what.ja}のデータがアップロードされていません。`);
  const en: string[] = [];
  const ja: string[] = [];
  const fake = (x: PeriodSum) => {
    const f = x.missingDates.filter((d) => x.syntheticDates.includes(d));
    return f.length ? { en: ` (${describeMissing(f)} marked as not real data in the export and excluded)`, ja: `（うち ${describeMissing(f)} はエクスポートで実データではないとされているため除外）` } : { en: '', ja: '' };
  };
  if (p.prev.missingDates.length) {
    en.push(`previous period missing ${describeMissing(p.prev.missingDates)}${fake(p.prev).en}`);
    ja.push(`前期に欠損 ${describeMissing(p.prev.missingDates)}${fake(p.prev).ja}`);
  }
  if (p.cur.missingDates.length) {
    en.push(`current period missing ${describeMissing(p.cur.missingDates)}${fake(p.cur).en}`);
    ja.push(`今期に欠損 ${describeMissing(p.cur.missingDates)}${fake(p.cur).ja}`);
  }
  return en.length ? tx(`${what.en}: ${en.join('; ')}.`, `${what.ja}：${ja.join('、')}。`) : tx('');
}

const W = {
  sessions: tx('Sessions', 'セッション'),
  cv: tx('CV'),
  total: tx('Total sessions', '全体セッション'),
  organic: tx('Organic', 'オーガニック流入'),
  advertising: tx('Advertising', '広告流入'),
};
const blank = (t: LText) => t.en === '';
const encOrNull = (t: LText) => (blank(t) ? null : enc(t));

// ---------- Analysis results (current vs previous; calculated values) ----------

type ResultKey = `${string}|${string}`;

async function storeAnalysisResults(db: DB, cfg: AppConfig, runId: number, periods: Periods, ga4: Ga4Inputs): Promise<Map<ResultKey, number>> {
  const ins = (...args: unknown[]) => db.insert(
    `INSERT INTO analysis_results (run_id, source, subject_type, subject_key, metric, current_period_start, current_period_end,
       previous_period_start, previous_period_end, previous_value, current_value, absolute_change, change_rate, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...args,
  );
  const ids = new Map<ResultKey, number>();
  const put = async (key: ResultKey, source: string, subjectType: string, subjectKey: string, metric: string, prev: number | null, cur: number | null, note: LText) => {
    const c = prev !== null && cur !== null ? change(prev, cur) : null;
    const id = await ins(runId, source, subjectType, subjectKey, metric, periods.current.start, periods.current.end, periods.previous.start, periods.previous.end,
        prev, cur, c?.abs ?? null, c?.rate ?? null, encOrNull(note));
    ids.set(key, id);
  };
  for (const role of ['total', 'organic', 'advertising'] as SegmentRole[]) {
    const s = ga4.sessions[role];
    const c = ga4.cv[role];
    const seg = ga4.series.sessions[role];
    if (!s && !c && !seg?.byDate.size) continue;
    const subjectType = role === 'total' ? 'site' : 'traffic_source';
    const segment = cfg.segments[role].value;
    await put(`${role}|sessions`, 'GA4', subjectType, segment, 'sessions', s?.prev.value ?? null, s?.cur.value ?? null, missingNote(s, W.sessions));
    await put(`${role}|cv`, 'GA4', subjectType, segment, 'cv', c?.prev.value ?? null, c?.cur.value ?? null, missingNote(c, W.cv));
    const cvrPrev = s?.prev.value != null && c?.prev.value != null ? ratio(c.prev.value, s.prev.value) : null;
    const cvrCur = s?.cur.value != null && c?.cur.value != null ? ratio(c.cur.value, s.cur.value) : null;
    await put(`${role}|cvr`, 'GA4', subjectType, segment, 'cvr', cvrPrev, cvrCur, cat([missingNote(s, W.sessions), missingNote(c, W.cv)]));
  }
  // Unmapped segments (e.g. direct): stored for traffic-source performance, not used by any rule.
  for (const segment of ga4.otherSegments) {
    const ss = await dailySeries(db, { source: 'GA4', segment, sourceMetricNames: cfg.metricNames.sessions.value, includeSynthetic: cfg.dataPolicy.evaluateSyntheticData, uploadIds: scopeIds(cfg, 'GA4') });
    if (!ss.byDate.size) continue;
    const s: Pair = { prev: sumPeriod(ss, periods.previous), cur: sumPeriod(ss, periods.current) };
    const note = missingNote(s, W.sessions);
    await put(`${segment}|sessions`, 'GA4', 'traffic_source', segment, 'sessions', s.prev.value, s.cur.value, blank(note) ? tx('Not used by any client rule.', 'クライアントルールでは使用しません。') : note);
  }
  return ids;
}

// ---------- Rules (rules.yaml) ----------
// Inputs are the week sums of the GA4 columns in input_fields; the formulas, the evaluation conditions and
// the cause / countermeasure / feedback of each branch are taken from rules.yaml as written. An investigation
// rule (GSC_R01) runs after the measurement when its trigger holds.

const TEAM: Record<string, string> = { SEO: 'SEO チーム', Advertising: '広告チーム', Ecommerce: 'EC チーム', 'SEO and Advertising': 'SEO チーム・広告チーム' };
const teamText = (team: string | null): LText | null => (team ? tx(`${team} team`.replace(/ team team$/, ' team'), TEAM[team] ?? team) : null);
const pretty = (name: string) => name.replace(/_/g, ' ');
const isCvr = (name: string) => /(^|_)cvr$/.test(name);
const isRate = (name: string) => /(_percent|_change)$/.test(name) && !/absolute/.test(name);
const num = (v: Vars[string]): number | null => (typeof v === 'number' ? v : null);
const fmtVar = (name: string, x: Vars[string]) => {
  const v = num(x);
  return v == null ? '—' : isCvr(name) ? `${v.toFixed(4)}%` : isRate(name) ? fmtPct(v) : fmtNum(v, Number.isInteger(v) ? 0 : 2);
};

function fieldSeries(db: DB, cfg: AppConfig, f: FieldSpec): Promise<DailySeries> {
  const names = f.metric === 'sessions' ? cfg.metricNames.sessions.value : f.metric === 'ecommerce_purchases' ? cfg.metricNames.cv.value : [f.sourceMetric];
  return dailySeries(db, { source: 'GA4', segment: f.segment, sourceMetricNames: [f.sourceMetric, ...names.filter((n) => n !== f.sourceMetric)], includeSynthetic: cfg.dataPolicy.evaluateSyntheticData, uploadIds: scopeIds(cfg, 'GA4') });
}

async function measureRule(db: DB, cfg: AppConfig, rule: RuleConfig, periods: Periods, results: Map<ResultKey, number>): Promise<MeasurementDraft> {
  const spec = cfg.specs[rule.id];
  if (!spec) return notImplemented(rule);
  const site = await siteKey(db, cfg);
  const base: Omit<MeasurementDraft, 'judgment' | 'cause' | 'change'> = {
    rule,
    analysisResultId: results.get(`total|${rule.metric}`) ?? null,
    evidence: { items: [], tables: [] },
    importedDataIds: [],
    subjectType: 'site',
    subject: site,
    metric: rule.metric,
  };

  // ---- inputs: required_ga4_fields → current_week_* / previous_week_* ----
  const vars: Vars = {};
  const pairs: Pair[] = [];
  const series = new Map<string, DailySeries>();
  const missing: LText[] = [];
  const inputRows: (string | number | null)[][] = [];
  for (const f of spec.fields) {
    const s = await fieldSeries(db, cfg, f);
    series.set(f.key, s);
    const p: Pair | undefined = s.byDate.size ? { prev: sumPeriod(s, periods.previous), cur: sumPeriod(s, periods.current) } : undefined;
    const ok = complete(p);
    if (ok) pairs.push(p);
    else {
      const note = missingNote(p, tx(f.column));
      missing.push(blank(note) ? tx(`${f.column}: no data.`, `${f.column}：データがありません。`) : note);
    }
    for (const n of inputNames(f, 'current_week')) vars[n] = ok ? p.cur.value : null;
    for (const n of inputNames(f, 'previous_week')) vars[n] = ok ? p.prev.value : null;
    base.importedDataIds.push(...refs(p));
    const c = ok ? pairChange(p) : null;
    inputRows.push([pretty(f.key), f.column, p?.prev.value ?? null, p?.cur.value ?? null, c?.abs ?? null, c ? fmtPct(c.rate) : enc(MISSING)]);
  }
  // ---- formulas (in rules.yaml order; comparison formulas last) ----
  applyFormulas(spec, vars);

  base.evidence.tables.push(
    {
      group: 'ga4',
      title: enc(tx(`Inputs — rules.yaml input_fields (GA4, ${periods.previous.start} – ${periods.previous.end} vs ${periods.current.start} – ${periods.current.end})`, `入力 — rules.yaml の input_fields（GA4、${periods.previous.start} – ${periods.previous.end} と ${periods.current.start} – ${periods.current.end}）`)),
      columns: [enc(tx('Field', '項目')), enc(tx('GA4 column', 'GA4 の列')), enc(tx('Previous week', '前週')), enc(tx('Current week', '今週')), enc(tx('Change', '変化')), enc(tx('WoW', '前週比'))],
      rows: inputRows,
    },
    {
      group: 'ga4',
      title: enc(tx('Calculated — rules.yaml formula', '計算値 — rules.yaml の formula')),
      columns: [enc(tx('Name', '名前')), enc(tx('Formula', '式')), enc(tx('Value', '値'))],
      rows: spec.formulas.map(([name, f]) => [name, f, fmtVar(name, vars[name])]),
    },
  );

  // ---- judged value ----
  const judgedExpr = spec.formulas.find(([n]) => n === spec.judged)?.[1] ?? '';
  // The values the judged formula compares: current_week_total_sessions / current_cvr …
  const operand = (week: string) => variablesOf(judgedExpr).find((v) => v.startsWith(week));
  const cur = num(vars[operand('current') ?? '']);
  const prev = num(vars[operand('previous') ?? '']);
  const rate = num(vars[spec.judged]);
  if (cur == null || prev == null || rate == null) {
    const why = missing.length ? cat(missing) : tx('The previous week\'s value is zero, so the week-on-week change cannot be calculated.', '前週の値がゼロのため、前週比を計算できません。');
    return { ...base, change: null, cause: null, judgment: { status: 'NOT_EVALUABLE', result: NOT_EVALUABLE, reason: cat([NOT_EVALUABLE_REASON, why]) } };
  }
  const judged: Change = { previous: prev, current: cur, abs: cur - prev, rate };

  // ---- evaluation ----
  const sel = selectBranch(spec, vars);
  const hit = sel?.hit;
  if (!sel || !hit || !hit.status)
    return {
      ...base,
      change: judged,
      cause: null,
      judgment: {
        status: 'NOT_EVALUABLE',
        result: NOT_EVALUABLE,
        reason: cat([NOT_EVALUABLE_REASON, tx(`The measured change (${fmtPct(rate)}) matches none of the rule's evaluation conditions.`, `測定された変化（${fmtPct(rate)}）はルールの評価条件のいずれにも該当しません。`)]),
      },
    };
  const t = rule.thresholdValue;
  const figures = tx(
    `${spec.judged} = ${fmtPct(rate)} (${fmtVar(operand('previous') ?? '', prev)} → ${fmtVar(operand('current') ?? '', cur)}). Condition: ${hit.condition}.`,
    `${spec.judged} = ${fmtPct(rate)}（${fmtVar(operand('previous') ?? '', prev)} → ${fmtVar(operand('current') ?? '', cur)}）。条件：${hit.condition}。`,
  );
  // The calculation (rules.yaml reason, variables, matched condition) stays in the evidence for audit; the reason
  // shown to users is the plain-language explanation.
  base.evidence.items.push({ group: 'ga4', label: enc(tx('Matched rules.yaml condition', '該当した rules.yaml の条件')), value: enc(cat([hit.reason ?? tx(''), figures])) });
  const judgment = testData(
    {
      status: hit.status,
      result: tx(`${fmtPct(rate)} ${hit.status === 'NG' ? '≥' : '<'} ±${t}%`),
      reason: explainResult({ status: hit.status, metric: rule.metric, rate, threshold: t, unit: rule.thresholdUnit }) ?? cat([hit.reason ?? tx(''), figures]),
    },
    pairs,
  );
  if (judgment.status !== 'NG') return { ...base, change: judged, judgment, cause: null };

  // ---- NG: source_analysis / patterns → cause, countermeasure, feedback ----
  const { sub, variant, outcome } = sel;
  const node = sub ?? hit;
  const facts: LText[] = [];
  const used = [...new Set([...variablesOf(hit.condition), ...(sub ? variablesOf(sub.condition) : []), ...Object.keys(node.comparison)])];
  facts.push(tx(`${used.map((v) => `${v} = ${fmtVar(v, vars[v])}`).join(', ')}.`));
  const contributor = node.compareSources ? primaryContributor(spec, vars) : null;
  if (contributor) facts.push(contributor.text);
  if (variant) facts.push(tx(`Primary cause rule → ${pretty(variant)}.`, `主因の判定 → ${pretty(variant)}。`));
  const subKey = rule.metric === 'cvr' ? 'patterns' : 'source_analysis';
  if (hit.sub.length && !sub) facts.push(tx(`No ${subKey} condition in rules.yaml matches these values.`, `rules.yaml の ${subKey} に該当する条件がありません。`));

  // The traffic source the branch points at: primary_cause, the chosen variant, the increase's contributor.
  const channel: 'organic' | 'advertising' | 'both' | null = (() => {
    const named = (node.primaryCause ?? '').toLowerCase();
    if (named === 'organic' || named === 'advertising') return named;
    if (variant) return /equal/.test(variant) ? 'both' : variant.startsWith('organic') ? 'organic' : variant.startsWith('advertising') ? 'advertising' : null;
    if (contributor?.role === 'organic' || contributor?.role === 'advertising') return contributor.role;
    const key = outcome?.causeType ?? '';
    return /organic/.test(key) ? 'organic' : /advertising/.test(key) ? 'advertising' : null;
  })();
  const fieldOf = (role: SegmentRole) => spec.fields.find((f) => f.role === role && f.metric === 'sessions');
  const target = (() => {
    const f = channel === 'organic' || channel === 'advertising' ? fieldOf(channel) : undefined;
    return f
      ? { target: tx(`${channel === 'organic' ? 'Organic' : 'Advertising'} traffic — GA4 segment ${f.segment}`, `${channel === 'organic' ? 'オーガニック流入' : '広告流入'} — GA4 セグメント ${f.segment}`), targetType: 'traffic_source' as const, targetKey: f.segment }
      : { target: tx(`Site total — GA4 segment ${cfg.segments.total.value}`, `サイト全体 — GA4 セグメント ${cfg.segments.total.value}`), targetType: 'site' as const, targetKey: site };
  })();

  // Supporting evidence for a traffic-source cause: GA4 daily trend, and Search Console for organic.
  const causeEvidence: Evidence = { items: facts.map((f, i) => ({ group: 'ga4' as const, label: enc(i === 0 ? tx('rules.yaml values', 'rules.yaml の値') : tx('Finding', '所見')), value: enc(f) })), tables: [...base.evidence.tables] };
  let analysis: CauseAnalysis | null = null;
  const totalField = spec.fields.find((f) => f.role === 'total' && f.metric === 'sessions');
  const sessionsChange = (role: SegmentRole) => {
    const f = fieldOf(role);
    const a = f ? num(vars[`previous_week_${f.key}`]) : null;
    const b = f ? num(vars[`current_week_${f.key}`]) : null;
    return f && a != null && b != null ? { f, c: change(a, b) } : null;
  };
  const total = totalField ? sessionsChange('total') : null;
  const share = (c: Change) => (total && total.c.abs < 0 && c.abs < 0 ? (c.abs / total.c.abs) * 100 : null);
  // Investigation rules whose trigger holds (GSC_R01: this rule NG and organic sessions decreased).
  const investigations = cfg.investigations.filter((x) => triggered(x, rule.id, 'NG', vars));
  const findings: Finding[] = [];
  if (channel === 'organic' || channel === 'both' || investigations.length) {
    const o = sessionsChange('organic');
    if (o && (o.c.abs < 0 || channel === 'organic' || channel === 'both')) findings.push(await investigateOrganic(db, cfg, periods, o.c, share(o.c), series.get(o.f.key)!, o.f.segment));
  }
  if (channel === 'advertising' || channel === 'both') {
    const a = sessionsChange('advertising');
    if (a) findings.push(investigateAdvertising(cfg, periods, a.c, share(a.c), series.get(a.f.key)!, a.f.segment));
  }
  for (const f of findings) {
    causeEvidence.tables.push(...f.evidence.tables);
    base.evidence.tables.push(...f.evidence.tables);
    base.importedDataIds.push(...f.importedDataIds);
  }
  const organic = findings.find((f) => f.analysis.channel === 'organic');
  // Cause: the branch description; a cause given only as a type reads as that type (+ the contributor / variant).
  const title = !outcome
    ? tx('Cause cannot be determined: no rules.yaml branch matches.', '原因を特定できません：rules.yaml に該当する分岐がありません。')
    : outcome.cause ??
      (contributor || variant
        ? cat([causeTypeText(outcome.causeType ?? 'cause'), contributor ? tx(`— ${contributor.short.en}.`, `— ${contributor.short.ja}。`) : tx(`— ${pretty(variant!)}.`, `— ${pretty(variant!)}。`)])
        : cat([causeTypeText(outcome.causeType ?? 'cause'), tx('.', '。')], '', ''));

  const countermeasures: CauseDraft['countermeasures'] = outcome?.countermeasure
    ? [{ action: outcome.countermeasure, reason: outcome.feedback ?? tx(''), ...target, team: teamText(outcome.team) }]
    : [];

  // ---- investigation (GSC_R01) ----
  let investigation: GscInvestigation | null = null;
  for (const inv of investigations) {
    const chart = organic?.analysis.gscEvidence?.dateChart;
    const chartSite = chart?.available ? chart.metrics : [];
    const r = await runGscInvestigation(db, inv, periods, chartSite, scopeIds(cfg, 'GSC'));
    investigation = r.result;
    base.importedDataIds.push(...r.importedDataIds);
    const cause = dec(r.result.cause);
    facts.push(tx(`${inv.id}: ${cause.en} (confidence: ${r.result.confidence}).`, `${inv.id}：${cause.ja}（信頼度：${r.result.confidence}）。`));
    const organicField = fieldOf('organic');
    countermeasures.push({
      action: dec(r.result.countermeasure),
      reason: cat([tx(`${inv.id} ${inv.name.en}: ${cause.en}`, `${inv.id} ${inv.name.ja}：${cause.ja}`), ...r.result.evidence.slice(0, 3).map(dec)]),
      target: organicField
        ? tx(`Organic traffic — GA4 segment ${organicField.segment}`, `オーガニック流入 — GA4 セグメント ${organicField.segment}`)
        : tx('Organic search traffic', 'オーガニック検索流入'),
      targetType: organicField ? 'traffic_source' : 'site',
      targetKey: organicField?.segment ?? site,
      team: teamText('SEO'),
    });
  }
  causeEvidence.items.splice(0, causeEvidence.items.length, ...facts.map((f, i) => ({ group: 'ga4' as const, label: enc(i === 0 ? tx('rules.yaml values', 'rules.yaml の値') : tx('Finding', '所見')), value: enc(f) })));
  if (organic)
    analysis = {
      ...organic.analysis,
      title,
      facts: [...facts, ...findings.flatMap((f) => f.analysis.facts)],
      missing: organic.analysis.missing,
      determined: !!outcome,
      limitation: null,
      investigation,
    };
  const chain = sub ? `${hit.condition} AND ${sub.condition}` : hit.condition;
  return {
    ...base,
    change: judged,
    judgment,
    cause: {
      branch: [outcome?.causeType ?? 'undetermined', variant].filter(Boolean).join(':'),
      text: title,
      confidence: outcome ? 'High' : 'Low',
      confidenceReason: outcome
        ? tx(`The GA4 values match the rules.yaml branch ${chain}.`, `GA4 の値が rules.yaml の分岐 ${chain} に該当します。`)
        : tx('The GA4 values match no rules.yaml branch.', 'GA4 の値は rules.yaml のどの分岐にも該当しません。'),
      evidence: causeEvidence,
      analysis,
      countermeasures,
    },
  };
}

/** Computes the rules.yaml formulas (in order) into `vars`. */
export function applyFormulas(spec: RuleSpec, vars: Vars): Vars {
  for (const [name, f] of spec.formulas) vars[name] = evalNumber(f, vars);
  return vars;
}

export interface Selection {
  hit: Branch;
  sub: Branch | null;
  variant: string | null;
  outcome: Outcome | null;
}

/**
 * The rules.yaml branch the values fall into: the first `evaluation` entry whose condition holds, then
 * (NG) the first matching source_analysis / pattern_analysis entry, then the comparison variant.
 * Null when no evaluation condition holds.
 */
export function selectBranch(spec: RuleSpec, vars: Vars): Selection | null {
  const hit = spec.evaluation.find((b) => evalCondition(b.condition, vars) === true);
  if (!hit) return null;
  const sub = hit.sub.length ? (hit.sub.find((b) => evalCondition(b.condition, vars) === true) ?? null) : null;
  const node = hit.sub.length ? sub : hit;
  if (!node) return { hit, sub, variant: null, outcome: null };
  if (node.outcome || !Object.keys(node.variants).length) return { hit, sub, variant: null, outcome: node.outcome };
  const variant = pickVariant(node, vars);
  return { hit, sub, variant, outcome: node.variants[variant] ?? null };
}

/** Variant chosen by the comparison formulas: the largest value is primary (organic_primary …); a tie is *_equal. */
function pickVariant(b: Branch, vars: Vars): string {
  const keys = Object.keys(b.variants);
  const values = Object.keys(b.comparison).map((name) => ({ name, v: vars[name] ?? null }));
  const known = values.filter((x): x is { name: string; v: number } => x.v !== null);
  if (!known.length) return keys[0]!;
  const max = Math.max(...known.map((x) => x.v));
  const top = known.filter((x) => Math.abs(x.v - max) < 1e-9);
  if (top.length > 1) return keys.find((k) => /equal/.test(k)) ?? keys[0]!;
  const prefix = top[0]!.name.split('_')[0]!;
  return keys.find((k) => k.startsWith(`${prefix}_`)) ?? keys[0]!;
}

/** analysis.primary_contributor: the traffic source with the larger absolute increase in sessions. */
function primaryContributor(spec: RuleSpec, vars: Vars): { text: LText; short: LText; role: SegmentRole | 'equal' | null } {
  const rows = spec.fields
    .filter((f) => f.role !== 'total' && f.metric === 'sessions')
    .map((f) => {
      const a = num(vars[`previous_week_${f.key}`]);
      const b = num(vars[`current_week_${f.key}`]);
      return { f, abs: a != null && b != null ? b - a : null };
    })
    .filter((x): x is { f: FieldSpec; abs: number } => x.abs !== null);
  const up = rows.filter((x) => x.abs > 0).sort((x, y) => y.abs - x.abs);
  const list = rows.map((x) => `${pretty(x.f.key)} ${x.abs > 0 ? '+' : ''}${fmtNum(x.abs)}`).join(', ');
  const name = (f: FieldSpec) => (f.role === 'organic' ? tx('Organic traffic', 'オーガニック流入') : f.role === 'advertising' ? tx('Advertising traffic', '広告流入') : tx(pretty(f.key)));
  if (!up.length) return { text: tx(`Primary contributor: none — no traffic source increased (${list}).`, `主な寄与：なし — 増加した流入はありません（${list}）。`), short: tx('no traffic source increased', '増加した流入なし'), role: null };
  if (up.length > 1 && Math.abs(up[0]!.abs - up[1]!.abs) < 1e-9) return { text: tx(`Primary contributor: equal (${list}).`, `主な寄与：同等（${list}）。`), short: tx('equal contribution', '同等の寄与'), role: 'equal' };
  const n = name(up[0]!.f);
  return {
    text: tx(`Primary contributor: ${n.en} (${list}).`, `主な寄与：${n.ja}（${list}）。`),
    short: tx(`primary contributor: ${n.en} (+${fmtNum(up[0]!.abs)} sessions)`, `主な寄与：${n.ja}（+${fmtNum(up[0]!.abs)} セッション）`),
    role: up[0]!.f.role,
  };
}

function notImplemented(rule: RuleConfig): MeasurementDraft {
  return {
    rule,
    analysisResultId: null,
    judgment: { status: 'NOT_EVALUABLE', result: NOT_EVALUABLE, reason: cat([NOT_EVALUABLE_REASON, tx(`No evaluator exists for rule ${rule.id}.`, `ルール ${rule.id} の評価処理がありません。`)]) },
    evidence: { items: [], tables: [] },
    importedDataIds: [],
    subjectType: 'site',
    subject: rule.subject,
    metric: rule.metric,
    change: null,
    cause: null,
  };
}

// ---------- Persistence ----------

async function persistMeasurement(db: DB, runId: number, d: MeasurementDraft) {
  const now = nowIso();
  const name = dec(d.rule.name);
  const mId = await db.insert(
    `INSERT INTO measurements (run_id, analysis_result_id, measurement_name, rule_id, threshold_value, threshold_unit, result, status, reason, evidence_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    runId, d.analysisResultId, enc(tx(`${d.rule.number} ${name.en}`, `${d.rule.number} ${name.ja}`)), d.rule.id, d.rule.thresholdValue, d.rule.thresholdUnit,
    enc(d.judgment.result), d.judgment.status, enc(d.judgment.reason), JSON.stringify(d.evidence), now,
  );
  for (const id of new Set(d.importedDataIds))
    await db.run('INSERT INTO measurement_sources (measurement_id, imported_data_id) VALUES (?, ?) ON CONFLICT DO NOTHING', mId, id);

  if (d.judgment.status !== 'NG' || !d.change) return;
  const aId = await db.insert(
    `INSERT INTO anomalies (measurement_id, subject_type, subject_key, metric, previous_value, current_value, change, change_rate, detection_date, state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Detected')`,
    mId, d.subjectType, d.subject, d.metric, d.change.previous, d.change.current, d.change.abs, d.change.rate, now.slice(0, 10),
  );
  if (!d.cause) return;
  const cId = await db.insert(
    `INSERT INTO cause_hypotheses (anomaly_id, branch, cause_text, supporting_evidence, confidence, confidence_reason, review_status, created_at, analysis_json)
     VALUES (?, ?, ?, ?, ?, ?, 'NotReviewed', ?, ?)`,
    aId, d.cause.branch, enc(d.cause.text), JSON.stringify(d.cause.evidence), d.cause.confidence, enc(d.cause.confidenceReason), now, d.cause.analysis ? JSON.stringify(d.cause.analysis) : null,
  );
  for (const k of d.cause.countermeasures)
    await db.run(
      `INSERT INTO countermeasures (cause_id, action_text, reason, target, target_type, target_key, responsible_team, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'Proposed', ?)`,
      cId, enc(k.action), enc(k.reason), enc(k.target), k.targetType, k.targetKey, k.team ? enc(k.team) : null, now,
    );
}

// ---------- Helpers ----------

/**
 * The Site the client rules judge (ontology Site): the property URL from the GA4 export notes
 * (e.g. "# https://www.dospara.co.jp - GA4"); the total segment name when no URL is given.
 */
export async function siteKey(db: DB, cfg: AppConfig): Promise<string> {
  const metas = await db.values<string>(`SELECT metadata_json FROM uploads WHERE source = 'GA4' AND import_status = 'imported'${scopeSql(cfg, 'GA4', 'id').sql} ORDER BY id DESC`, ...scopeSql(cfg, 'GA4', 'id').args);
  let key: string | null = null;
  for (const m of metas) {
    const comments = Object.values(parseJson<Record<string, { exportComments?: string[] }>>(m, {})).flatMap((v) => (Array.isArray(v?.exportComments) ? v.exportComments : []));
    const url = comments.map((c) => /^(https?:\/\/[^\s]+)/.exec(c)?.[1]).find(Boolean);
    if (url) {
      key = url.replace(/\/$/, '');
      break;
    }
  }
  key ??= cfg.segments.total.value;
  await db.run('INSERT INTO sites (key) VALUES (?) ON CONFLICT DO NOTHING', key);
  return key;
}

/** Run warning when the measured weeks contain data the export marks as not real. */
function syntheticIssues(s: DailySeries, periods: Periods, included: boolean): Issue[] {
  // Test mode: the measured days that used such data. Default: every excluded date, so a run without
  // a complete period still says why the data stops there.
  const dates = included ? [...daysOf(periods.previous), ...daysOf(periods.current)].filter((d) => s.synthetic.has(d)) : [...s.synthetic].sort();
  if (!dates.length) return [];
  const which = describeMissing(dates);
  return [
    included
      ? {
          severity: 'warning',
          code: 'synthetic-data-used',
          message: enc(tx(`TEST DATA: ${which} in the measured weeks are marked as not real in the export and were used (data_policy.evaluate_synthetic_data: true). Results are not business results.`, `テストデータ：測定週の ${which} はエクスポートで実データではないとされていますが使用しました（data_policy.evaluate_synthetic_data: true）。結果は業務上の結果ではありません。`)),
        }
      : {
          severity: 'warning',
          code: 'synthetic-data-excluded',
          message: enc(tx(`GA4 data for ${which} is marked as not real in the export and is excluded (rules.yaml data_policy); those days count as missing.`, `GA4 の ${which} のデータはエクスポートで実データではないとされているため除外しました（rules.yaml の data_policy）。これらの日は欠損として扱います。`)),
        },
  ];
}

/** In test mode a judgment that used synthetic values is labelled in its result; the reason stays the business explanation (the TEST DATA notice is shown separately). */
function testData(j: Judgment, pairs: (Pair | undefined)[]): Judgment {
  const used = pairs.some((p) => p && [...p.prev.syntheticDates, ...p.cur.syntheticDates].some((d) => [...p.prev.refs, ...p.cur.refs].some((r) => r.date === d)));
  if (!used) return j;
  return {
    ...j,
    result: cat([tx('[TEST DATA]', '［テストデータ］'), j.result]),
  };
}

function refs(p: Pair | undefined): number[] {
  return p ? [...p.prev.refs, ...p.cur.refs].map((r) => r.importedDataId) : [];
}
