import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import type { ConfigSummary, MeasurementStatus, RuleConfig, UnresolvedItem } from '@seo/shared';
import { dec, enc, tx, type LText } from './i18n.ts';
import { METRIC_KEYS } from './import/ga4.ts';
import { oneLine, parseExpr, variablesOf } from './measure/expr.ts';

const here = dirname(new URL(import.meta.url).pathname);
export const DEFAULT_CONFIG_PATH = resolve(here, '../../LOGOS_SEO_Ontology_Standalone_Final/rules.yaml');

export interface Mapping<T> {
  value: T;
  confirmed: boolean;
  note: string | null;
}

export type SegmentRole = 'total' | 'organic' | 'advertising';

/** What a rules.yaml branch concludes: cause, countermeasure and the feedback to a team. */
export interface Outcome {
  causeType: string | null;
  cause: LText | null;
  countermeasure: LText | null;
  team: string | null;
  feedbackType: string | null;
  feedback: LText | null;
}

/**
 * One `evaluation` entry of a rule, or one entry of its `source_analysis` / `pattern_analysis`.
 * `variants` + `comparison`: the branch has several outcomes (e.g. organic_primary / advertising_primary /
 * both_equal) and the comparison formulas decide which one applies.
 */
export interface Branch {
  condition: string;
  status: MeasurementStatus | null;
  reason: LText | null;
  outcome: Outcome | null;
  variants: Record<string, Outcome>;
  comparison: Record<string, string>;
  /** analysis.primary_contributor (increase): which traffic source contributed most. */
  compareSources: boolean;
  /** primary_cause: the traffic source the branch names (Organic / Advertising). */
  primaryCause: string | null;
  /** next_step.investigation_rule: the investigation to run (GSC_R01). */
  investigation: string | null;
  sub: Branch[];
}

/** A GA4 column the rule reads (required_ga4_fields), split into segment and metric. */
export interface FieldSpec {
  key: string;
  column: string;
  segment: string;
  role: SegmentRole;
  /** Metric header as exported (e.g. セッション) and its normalized key (sessions). */
  sourceMetric: string;
  metric: string;
}

/** A rule exactly as rules.yaml defines it: inputs, formulas and the evaluation branches. */
export interface RuleSpec {
  id: string;
  fields: FieldSpec[];
  /** Ordered formulas (formula + comparison blocks); later ones may use earlier ones. */
  formulas: [string, string][];
  /** The formula the rule judges (wow_change / cvr_wow_change). */
  judged: string;
  evaluation: Branch[];
}

/** One check of an investigation rule (GSC_QUERY, GSC_PAGE, …). */
export interface InvestigationCheck {
  id: string;
  /** Input key (query, page, device, search_appearance). */
  source: string;
  check: string[];
  identify: string[];
  /** Interpretation per signal (clicks_decrease …), or one text for the whole check. */
  interpretation: Record<string, LText>;
}

/** An investigation rule (GSC_R01): never an OK / NG measurement; runs when its trigger holds. */
export interface InvestigationSpec {
  id: string;
  name: LText;
  purpose: LText;
  source: 'GSC';
  trigger: { ruleId: string; conditions: string[] };
  inputs: Record<string, { file: string; purpose: string[] }>;
  checks: InvestigationCheck[];
  priority: { condition: string; cause: LText }[];
  fallback: LText;
  countermeasures: Record<string, LText>;
  confidenceValues: string[];
}

export interface AppConfig {
  schemaVersion: number;
  segments: Record<SegmentRole, Mapping<string>>;
  metricNames: { sessions: Mapping<string[]>; cv: Mapping<string[]> };
  brandTerms: Mapping<string[]>;
  evidenceRows: number;
  /** Data the export itself marks as not real (fake / dummy): excluded from analysis unless allowed. */
  dataPolicy: { evaluateSyntheticData: boolean };
  /** How GSC data is used: supporting evidence for the sessions rule. */
  gscRole: { supports: string; text: LText; notUsed: LText };
  rules: RuleConfig[];
  specs: Record<string, RuleSpec>;
  investigations: InvestigationSpec[];
  /**
   * Active import context for one request: the uploads to analyse, per source. A source without uploads in the
   * context is not limited (e.g. GSC evidence when only a GA4 file was selected). Undefined = all data.
   */
  scope?: { uploadIds: number[]; GA4?: number[]; GSC?: number[] };
}

/** Upload ids a source is limited to in this request, or undefined (all uploads of that source). */
export const scopeIds = (cfg: AppConfig, source: 'GA4' | 'GSC'): number[] | undefined => cfg.scope?.[source];

/** " AND <col> IN (…)" for the source's scope, with its arguments. */
export function scopeSql(cfg: AppConfig, source: 'GA4' | 'GSC', col = 'upload_id'): { sql: string; args: number[] } {
  const ids = scopeIds(cfg, source);
  return ids ? { sql: ` AND ${col} IN (${ids.map(() => '?').join(',') || 'NULL'})`, args: ids } : { sql: '', args: [] };
}

type Raw = Record<string, any>;

/** Bilingual value from `key` and the optional `key_ja` (falls back to the English text). Folded YAML text becomes one line. */
const bi = (r: Raw | null | undefined, key: string): LText | null =>
  r?.[key] == null ? null : tx(oneLine(r[key]), oneLine(r[`${key}_ja`] ?? r[key]));

/** "SEO_and_Advertising" → "SEO and Advertising". */
const label = (s: unknown) => (s == null ? null : String(s).replace(/_/g, ' ').trim());

const NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
const METRIC_OF_RULE: Record<string, string> = { sessions: 'sessions', cvr: 'cvr' };
const ROLE_PREFIX: Record<SegmentRole, string> = { total: '', organic: 'organic_', advertising: 'advertising_' };

// Defaults for settings rules.yaml (GA4 rules only) does not carry. Overridable with the same keys as before.
const DEFAULT_BRAND_TERMS = ['ドスパラ', 'dospara', 'どすぱら', 'ドスバラ', 'dosupara', 'ガレリア', 'galleria', 'がれりあ', 'サードウェーブ', 'thirdwave'];

export function loadConfig(path = process.env.SEO_CONFIG_PATH ?? DEFAULT_CONFIG_PATH): AppConfig {
  return parseConfig(parse(readFileSync(path, 'utf8')) as Raw);
}

/** "通販（全体） オーガニックサーチ セッション" → segment "通販（全体） オーガニックサーチ" + metric "セッション". */
function splitColumn(column: string): { segment: string; sourceMetric: string; metric: string } {
  const lower = column.toLowerCase();
  const hit = Object.keys(METRIC_KEYS)
    .sort((a, b) => b.length - a.length)
    .find((m) => lower.endsWith(` ${m.toLowerCase()}`));
  if (hit) {
    const sourceMetric = column.slice(column.length - hit.length);
    return { segment: column.slice(0, column.length - hit.length).trim(), sourceMetric, metric: METRIC_KEYS[hit]! };
  }
  const i = column.lastIndexOf(' ');
  const sourceMetric = i < 0 ? column : column.slice(i + 1);
  return { segment: i < 0 ? '' : column.slice(0, i).trim(), sourceMetric, metric: sourceMetric };
}

const roleOf = (key: string): SegmentRole => (/organic/i.test(key) ? 'organic' : /advertis|paid/i.test(key) ? 'advertising' : 'total');

/** "traffic_increase" → "Traffic increase"; used when a cause has a type but no description. */
const CAUSE_JA: Record<string, string> = {
  traffic_increase: '流入の増加',
  organic_traffic_decrease: 'オーガニック流入の減少',
  advertising_traffic_decrease: '広告流入の減少',
  both_traffic_sources_decreased: 'オーガニック流入と広告流入の両方の減少',
  conversion_improvement: 'コンバージョンの改善',
  traffic_quality_issue: '流入の質の問題',
  conversion_side_issue: 'コンバージョン側の問題',
  traffic_growth_outpaced_purchase_growth: '流入の伸びが購入の伸びを上回った',
};
export const causeTypeText = (type: string): LText => {
  const en = type.replace(/_/g, ' ');
  return tx(en.charAt(0).toUpperCase() + en.slice(1), CAUSE_JA[type] ?? en);
};

function outcome(cause: Raw | null | undefined, countermeasure: unknown, feedback: Raw | null | undefined, description: LText | null): Outcome | null {
  if (!cause && !countermeasure && !feedback) return null;
  return {
    causeType: cause?.type ?? null,
    cause: bi(cause, 'description') ?? description,
    countermeasure: countermeasure == null ? null : typeof countermeasure === 'string' ? tx(oneLine(countermeasure)) : bi(countermeasure as Raw, 'action'),
    team: label(feedback?.team),
    feedbackType: feedback?.type ?? null,
    feedback: bi(feedback, 'message'),
  };
}

function branch(r: Raw): Branch {
  const cm = r.countermeasure;
  const fb = r.feedback;
  // Keyed outcomes: countermeasure / feedback hold one entry per variant instead of `action` / `message`.
  const keyed = cm && typeof cm === 'object' && cm.action == null;
  const variants: Record<string, Outcome> = {};
  if (keyed)
    for (const key of Object.keys(cm).filter((k) => !k.endsWith('_ja')))
      variants[key] = outcome(r.cause, { action: cm[key], action_ja: cm[`${key}_ja`] }, fb?.[key], bi(r, 'description'))!;
  const sub = (r.source_analysis ?? r.pattern_analysis ?? r.patterns ?? []) as Raw[];
  // Formulas of the branch: `analysis` (organic_absolute_decrease …) or the older `comparison` block.
  const formulas = { ...((r.comparison ?? {}) as Raw), ...((r.analysis ?? {}) as Raw) };
  return {
    condition: oneLine(r.condition),
    status: r.status === 'OK' || r.status === 'NG' ? r.status : r.result === 'OK' || r.result === 'NG' ? r.result : null,
    reason: bi(r, 'reason'),
    outcome: keyed ? null : outcome(r.cause, cm, fb, bi(r, 'description')),
    variants,
    comparison: Object.fromEntries(Object.entries(formulas).filter(([k, v]) => !k.endsWith('_rule') && !k.endsWith('_ja') && typeof v === 'string').map(([k, v]) => [k, oneLine(v)])),
    compareSources: !!(r.source_comparison || r.analysis?.primary_contributor),
    primaryCause: r.primary_cause == null ? null : String(r.primary_cause),
    investigation: r.next_step?.investigation_rule ?? null,
    sub: sub.map(branch),
  };
}

/** The judged formula: the one the OK condition reads (abs(wow_change) < 3.9 → wow_change). */
function judgedFormula(evaluation: Branch[], formulas: [string, string][]): string {
  const names = new Set(formulas.map(([n]) => n));
  const ok = evaluation.find((b) => b.status === 'OK') ?? evaluation[0];
  return (ok ? variablesOf(ok.condition) : []).find((v) => names.has(v)) ?? formulas[0]?.[0] ?? '';
}

export function parseConfig(raw: Raw): AppConfig {
  const specs: Record<string, RuleSpec> = {};
  const fieldsSeen: FieldSpec[] = [];
  const all = (raw.rules ?? []) as Raw[];
  // Investigation rules (GSC_R01) are not measurements: they never produce OK / NG.
  const isInvestigation = (r: Raw) => r.type === 'investigation' || !!r.investigation;
  const investigations = all.filter(isInvestigation).map(investigation);
  const rules: RuleConfig[] = all.filter((r) => !isInvestigation(r)).map((r, i) => {
    const id = String(r.rule_id ?? r.id);
    const metric = METRIC_OF_RULE[String(r.metric).toLowerCase()] ?? String(r.metric).toLowerCase();
    const fields: FieldSpec[] = Object.entries((r.input_fields ?? r.required_ga4_fields ?? {}) as Raw).map(([key, f]) => {
      const column = String(f?.field ?? f?.current_week ?? f?.previous_week ?? f);
      return { key, column, role: roleOf(key), ...splitColumn(column) };
    });
    fieldsSeen.push(...fields);
    const formulas: [string, string][] = Object.entries((r.formula ?? {}) as Raw).map(([k, v]) => [k, oneLine(v)]);
    const evaluation = ((r.evaluation ?? []) as Raw[]).map(branch);
    // Comparison formulas inside branches (e.g. organic_absolute_decrease) are computed with the others.
    // Parsing every condition and formula here makes a syntax error in rules.yaml fail at startup.
    const walk = (b: Branch) => (variablesOf(b.condition), formulas.push(...Object.entries(b.comparison)), b.sub.forEach(walk));
    evaluation.forEach(walk);
    for (const [, f] of formulas) parseExpr(f);
    specs[id] = { id, fields, formulas, judged: judgedFormula(evaluation, formulas), evaluation };

    const th = r.threshold ?? {};
    const value = typeof th.value === 'number' ? th.value : null;
    const name = bi(r, 'rule_name') ?? tx(id);
    const purpose = bi(r.purpose, 'description') ?? tx('');
    const ng = evaluation.filter((b) => b.status === 'NG');
    const steps = ng.flatMap((b) => {
      const subs = b.sub.length ? b.sub : [b];
      return subs.map((s) => {
        const o = s.outcome ?? Object.values(s.variants)[0] ?? null;
        const what = o?.causeType ? label(o.causeType)! : '';
        const next = s.investigation ? ` → ${s.investigation}` : '';
        const team = s.outcome?.team ?? (Object.keys(s.variants).length ? Object.values(s.variants).map((v) => v.team).filter(Boolean).join(' / ') : '');
        const when = b.sub.length ? `${b.condition} AND ${s.condition}` : b.condition;
        return `${when} → ${what}${team ? ` (${team})` : ''}${next}`;
      });
    });
    const unit = th.unit === 'percent' ? 'percent' : th.unit === 'percentage_points' ? 'percentage_points' : 'unresolved';
    return {
      id,
      number: NUMBERS[i] ?? String(i + 1),
      code: `M${i + 1}`,
      name: enc(name),
      criteria: enc(tx(`${name.en}: ±${value ?? '?'}% or more WoW (relative change)`, `${name.ja}：前週比 ±${value ?? '?'}% 以上（相対変化）`)),
      primaryJudgment: enc(purpose),
      whatToCheckNext: enc(tx(steps.join(' · '))),
      subject: 'total',
      analysisUnit: enc(tx('Site', 'サイト')),
      metric,
      thresholdValue: value,
      thresholdUnit: unit,
      thresholdNote: null,
      source: r.data_source === 'GSC' ? 'GSC' : 'GA4',
      direction: String(th.operator ?? '').startsWith('absolute') ? 'both' : String(th.direction ?? 'both'),
      conditionType: 'numeric',
    } satisfies RuleConfig;
  });

  const segment = (role: SegmentRole, fallback: string): Mapping<string> => {
    const f = fieldsSeen.find((x) => x.role === role);
    return { value: f?.segment ?? fallback, confirmed: !!f, note: f ? `rules.yaml required_ga4_fields: ${f.column}` : null };
  };
  const metricNames = (keys: string[], extra: string[]): Mapping<string[]> => {
    const names = [...new Set(fieldsSeen.filter((f) => keys.includes(f.metric)).map((f) => f.sourceMetric))];
    return { value: [...names, ...extra.filter((x) => !names.includes(x))], confirmed: names.length > 0, note: null };
  };
  const sessionsRule = rules.find((r) => r.metric === 'sessions');
  const gsc = investigations.find((x) => x.source === 'GSC');
  return {
    schemaVersion: Number(raw.schema_version ?? 2),
    segments: {
      total: segment('total', '通販（全体）'),
      organic: segment('organic', '通販（全体） オーガニックサーチ'),
      advertising: segment('advertising', '通販（全体） ペイド系合算'),
    },
    metricNames: {
      sessions: metricNames(['sessions'], ['セッション', 'Sessions']),
      cv: metricNames(['ecommerce_purchases', 'transactions', 'conversions'], ['e コマース購入数', 'Ecommerce purchases']),
    },
    brandTerms: {
      value: ((raw.gsc?.brand_terms?.terms as unknown[]) ?? DEFAULT_BRAND_TERMS).map(String),
      confirmed: raw.gsc?.brand_terms?.confirmed === true,
      note: null,
    },
    evidenceRows: Number(raw.gsc?.evidence_rows ?? 10),
    // Test data (dates the export marks as not real) is used unless rules.yaml turns it off — same default as the UI switch.
    dataPolicy: { evaluateSyntheticData: raw.data_policy?.evaluate_synthetic_data !== false },
    gscRole: {
      supports: gsc?.trigger.ruleId || sessionsRule?.id || '',
      text: gsc
        ? tx(`Search Console data is used by the investigation ${gsc.id} (${gsc.name.en}) when ${gsc.trigger.ruleId} is NG with organic sessions decreasing — never judged on its own.`, `Search Console のデータは、${gsc.trigger.ruleId} が NG でオーガニックのセッションが減少したときに調査 ${gsc.id}（${gsc.name.ja}）で使用します — 単独では判定しません。`)
        : tx('Search Console data is supporting evidence for the Sessions rule (organic traffic) — never judged on its own.', 'Search Console のデータはセッションのルール（オーガニック流入）の裏付け根拠です — 単独では判定しません。'),
      notUsed: tx(''),
    },
    rules,
    specs,
    investigations,
  };
}

function investigation(r: Raw): InvestigationSpec {
  const id = String(r.rule_id ?? r.id);
  const checks: InvestigationCheck[] = ((r.investigation ?? []) as Raw[]).map((c) => ({
    id: String(c.investigation_id ?? c.id),
    source: String(c.source),
    check: ((c.check ?? []) as unknown[]).map(String),
    identify: ((c.identify ?? []) as unknown[]).map(String),
    interpretation:
      typeof c.interpretation === 'string'
        ? { all: bi(c, 'interpretation')! }
        : Object.fromEntries(Object.keys((c.interpretation ?? {}) as Raw).filter((k) => !k.endsWith('_ja')).map((k) => [k, bi(c.interpretation, k)!])),
  }));
  const ci = (r.cause_identification ?? {}) as Raw;
  const priority = ((ci.priority_order ?? []) as Raw[]).map((p) => ({ condition: oneLine(p.condition), cause: bi(p, 'cause')! }));
  for (const p of priority) parseExpr(p.condition);
  const trigger = (r.trigger ?? {}) as Raw;
  return {
    id,
    name: bi(r, 'rule_name') ?? tx(id),
    purpose: bi(r.purpose, 'description') ?? tx(''),
    source: 'GSC',
    trigger: { ruleId: String(trigger.rule_id ?? ''), conditions: ((trigger.conditions ?? []) as unknown[]).map((c) => oneLine(c)) },
    inputs: Object.fromEntries(Object.entries((r.input_files ?? {}) as Raw).map(([k, v]) => [k, { file: String(v?.file ?? ''), purpose: ((v?.purpose ?? []) as unknown[]).map(String) }])),
    checks,
    priority,
    fallback: bi(ci, 'fallback') ?? tx('No single cause can be determined from the available GSC data.'),
    countermeasures: Object.fromEntries(Object.entries((r.countermeasure_mapping ?? {}) as Raw).map(([k, v]) => [k, bi(v, 'action')!])),
    confidenceValues: ((r.output?.confidence_values ?? ['high', 'medium', 'low', 'insufficient_data']) as unknown[]).map(String),
  };
}

/** Which rule logic a stored rule id belongs to (also for runs made before rules.yaml changed). */
export function ruleMetric(cfg: AppConfig, ruleId: string): string | null {
  if (ruleId === 'GA4-R1' || ruleId === 'GA4_Rule_01') return 'sessions';
  if (ruleId === 'GA4-R2' || ruleId === 'GA4_Rule_02') return 'cvr';
  return cfg.rules.find((r) => r.id === ruleId)?.metric ?? null;
}

/** Variable name for a GA4 input: current_week_<key> and current_week_<role prefix><metric> (both are used in rules.yaml). */
export const inputNames = (f: FieldSpec, week: 'current_week' | 'previous_week') => [...new Set([`${week}_${f.key}`, `${week}_${ROLE_PREFIX[f.role]}${f.metric}`])];

/** Everything still waiting on the client, for the UI and the report (descriptions are bilingual). */
export function unresolvedItems(cfg: AppConfig): UnresolvedItem[] {
  const items: UnresolvedItem[] = [];
  const add = (key: string, en: string, ja: string) => items.push({ key, description: enc(tx(en, ja)) });
  for (const rule of cfg.rules) {
    const name = dec(rule.name);
    const note = dec(rule.thresholdNote);
    if (rule.thresholdValue === null)
      add(`${rule.id}.threshold_value`, `${rule.number} ${name.en}: threshold value not configured.`, `${rule.number} ${name.ja}：閾値が設定されていません。`);
    if (rule.thresholdUnit === 'unresolved')
      add(`${rule.id}.threshold_unit`, `${rule.number} ${name.en}: threshold unit not confirmed. ${note.en}`.trim(), `${rule.number} ${name.ja}：閾値の単位が未確認です。${note.ja}`);
  }
  const roleJa: Record<string, string> = { total: '全体', organic: 'オーガニック流入', advertising: '広告流入' };
  for (const [role, m] of Object.entries(cfg.segments))
    if (!m.confirmed) add(`ga4.segments.${role}`, `GA4 segment "${m.value}" is used as ${role} traffic — not confirmed by the client.`, `GA4 セグメント「${m.value}」を${roleJa[role]}として使用 — クライアント未確認。`);
  if (!cfg.metricNames.cv.confirmed) {
    const cols = cfg.metricNames.cv.value.map((n) => `"${n}"`).join(' / ');
    add('ga4.metrics.cv', `CV is read from GA4 column ${cols} — not confirmed by the client.`, `CV は GA4 の列 ${cols} から取得 — クライアント未確認。`);
  }
  add(
    'gsc.signal_size',
    'Search Console signals (position worse, impressions ↓, CTR ↓) have no size defined in SEO.txt, so any change in that direction counts.',
    'Search Console のシグナル（掲載順位の悪化・表示回数 ↓・CTR ↓）の大きさは SEO.txt で定義されていないため、その方向の変化はすべて該当します。',
  );
  if (!cfg.brandTerms.confirmed)
    add('gsc.brand_terms', 'Brand query classification uses a provisional term list (reproduces the 66% cited in SEO.txt) — rule not supplied by the client.', 'ブランドクエリの分類は暫定の語句リストを使用（SEO.txt の 66% を再現）— クライアントからルール未提供。');
  add(
    'data.real_weeks',
    'Real GA4 data for two complete weeks is needed for a week-on-week judgment; for Search Console evidence those weeks must also be covered by the GSC daily chart export.',
    '前週比の判定には GA4 の実データが 2 週間分必要です。Search Console の根拠を使うには、その 2 週間が GSC 日次チャートのエクスポートに含まれている必要があります。',
  );
  return items;
}

export function configSummary(cfg: AppConfig): ConfigSummary {
  return { rules: cfg.rules, unresolved: unresolvedItems(cfg) };
}
