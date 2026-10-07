// Measurement run: period comparison → client rules → OK / NG / NOT_EVALUABLE
// → SEO Anomaly (NG only) → Cause Hypothesis → Countermeasure (Proposed).
import type { Confidence, Evidence, EvidenceItem, EvidenceTable, Issue, Period, RuleConfig } from '@seo/shared';
import type { AppConfig, SegmentRole } from '../config.ts';
import { nowIso, type DB } from '../db.ts';
import { cat, dec, enc, tx, type LText } from '../i18n.ts';
import { buildGscEvidence } from './gsc-evidence.ts';
import {
  change,
  describeChannelChange,
  fmtNum,
  fmtPct,
  judge,
  ratio,
  rule1FollowUp,
  rule2FollowUp,
  type Change,
  type Channel,
  type Judgment,
} from './logic.ts';
import { dailySeries, describeMissing, overlapIssues, sumPeriod, weekPeriods, type DailySeries, type PeriodSum } from './series.ts';

export interface RunOptions {
  /** Last day of the current week (yyyy-mm-dd). Default: latest GA4 date for the total segment. */
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
  countermeasures: { action: LText; reason: LText; target: LText; team: LText | null }[];
}

interface MeasurementDraft {
  rule: RuleConfig;
  analysisResultId: number | null;
  judgment: Judgment;
  evidence: Evidence;
  importedDataIds: number[];
  subject: string;
  metric: string;
  change: Change | null;
  cause: CauseDraft | null;
}

export function latestGa4Date(db: DB, cfg: AppConfig): string | null {
  const row = db
    .prepare(`SELECT MAX(data_date) AS d FROM imported_data WHERE source = 'GA4' AND is_valid = 1 AND segment = ? AND data_date IS NOT NULL`)
    .get(cfg.segments.total.value) as { d: string | null };
  return row.d;
}

export function runMeasurements(db: DB, cfg: AppConfig, opts: RunOptions = {}): number {
  const end = opts.currentEnd ?? latestGa4Date(db, cfg);
  const issues: Issue[] = [];
  if (!end)
    issues.push({
      severity: 'error',
      code: 'no-ga4-data',
      message: enc(tx('No valid GA4 daily data for the total segment — nothing can be measured.', '全体セグメントの有効な GA4 日次データがないため、測定できません。')),
    });
  const periods = weekPeriods(end ?? new Date().toISOString().slice(0, 10));

  return db.transaction(() => {
    replaceUntouchedRuns(db, periods);
    const runId = Number(
      db
        .prepare(`INSERT INTO measurement_runs (current_start, current_end, previous_start, previous_end, created_at, config_json, issues_json) VALUES (?, ?, ?, ?, ?, ?, '[]')`)
        .run(periods.current.start, periods.current.end, periods.previous.start, periods.previous.end, nowIso(), JSON.stringify(cfg.rules)).lastInsertRowid,
    );

    const ga4 = loadGa4(db, cfg, periods, issues);
    const results = storeAnalysisResults(db, cfg, runId, periods, ga4);

    for (const rule of cfg.rules) {
      const draft =
        rule.id === 'GA4-R1' ? measureRule1(db, cfg, rule, periods, ga4, results) :
        rule.id === 'GA4-R2' ? measureRule2(cfg, rule, ga4, results) :
        notImplemented(rule);
      persistMeasurement(db, runId, draft);
    }
    db.prepare('UPDATE measurement_runs SET issues_json = ? WHERE id = ?').run(JSON.stringify(issues), runId);
    return runId;
  })();
}

/** A re-run of the same weeks replaces the earlier run unless the SEO team has already acted on it. */
function replaceUntouchedRuns(db: DB, p: Periods) {
  const runs = db
    .prepare('SELECT id FROM measurement_runs WHERE current_start = ? AND current_end = ? AND previous_start = ? AND previous_end = ?')
    .pluck()
    .all(p.current.start, p.current.end, p.previous.start, p.previous.end) as number[];
  for (const id of runs) {
    const touched = db
      .prepare(
        `SELECT COUNT(*) FROM state_events e WHERE
           (e.entity = 'anomaly' AND e.entity_id IN (SELECT a.id FROM anomalies a JOIN measurements m ON m.id = a.measurement_id WHERE m.run_id = ?))
        OR (e.entity = 'cause' AND e.entity_id IN (SELECT c.id FROM cause_hypotheses c JOIN anomalies a ON a.id = c.anomaly_id JOIN measurements m ON m.id = a.measurement_id WHERE m.run_id = ?))
        OR (e.entity = 'countermeasure' AND e.entity_id IN (SELECT k.id FROM countermeasures k JOIN cause_hypotheses c ON c.id = k.cause_id JOIN anomalies a ON a.id = c.anomaly_id JOIN measurements m ON m.id = a.measurement_id WHERE m.run_id = ?))`,
      )
      .pluck()
      .get(id, id, id) as number;
    if (!touched) db.prepare('DELETE FROM measurement_runs WHERE id = ?').run(id);
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

function loadGa4(db: DB, cfg: AppConfig, periods: Periods, issues: Issue[]): Ga4Inputs {
  const out: Ga4Inputs = { periods, sessions: {}, cv: {}, series: { sessions: {}, cv: {} }, otherSegments: [] };
  for (const role of ['total', 'organic', 'advertising'] as SegmentRole[]) {
    const segment = cfg.segments[role].value;
    const s = dailySeries(db, { source: 'GA4', segment, sourceMetricNames: cfg.metricNames.sessions.value });
    const c = dailySeries(db, { source: 'GA4', segment, sourceMetricNames: cfg.metricNames.cv.value });
    out.series.sessions[role] = s;
    out.series.cv[role] = c;
    if (s.byDate.size) out.sessions[role] = { prev: sumPeriod(s, periods.previous), cur: sumPeriod(s, periods.current) };
    if (c.byDate.size) out.cv[role] = { prev: sumPeriod(c, periods.previous), cur: sumPeriod(c, periods.current) };
    issues.push(...overlapIssues(tx(`GA4 ${segment} sessions`, `GA4 ${segment} のセッション`), s));
  }
  const mapped = new Set(Object.values(cfg.segments).map((m) => m.value));
  out.otherSegments = (
    db.prepare(`SELECT DISTINCT segment FROM imported_data WHERE source = 'GA4' AND is_valid = 1 AND data_date IS NOT NULL AND segment IS NOT NULL`).pluck().all() as string[]
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
  if (p.prev.missingDates.length) {
    en.push(`previous period missing ${describeMissing(p.prev.missingDates)}`);
    ja.push(`前期に欠損 ${describeMissing(p.prev.missingDates)}`);
  }
  if (p.cur.missingDates.length) {
    en.push(`current period missing ${describeMissing(p.cur.missingDates)}`);
    ja.push(`今期に欠損 ${describeMissing(p.cur.missingDates)}`);
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

function storeAnalysisResults(db: DB, cfg: AppConfig, runId: number, periods: Periods, ga4: Ga4Inputs): Map<ResultKey, number> {
  const ins = db.prepare(
    `INSERT INTO analysis_results (run_id, source, subject_type, subject_key, metric, current_period_start, current_period_end,
       previous_period_start, previous_period_end, previous_value, current_value, absolute_change, change_rate, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const ids = new Map<ResultKey, number>();
  const put = (key: ResultKey, source: string, subjectType: string, subjectKey: string, metric: string, prev: number | null, cur: number | null, note: LText) => {
    const c = prev !== null && cur !== null ? change(prev, cur) : null;
    const id = Number(
      ins.run(runId, source, subjectType, subjectKey, metric, periods.current.start, periods.current.end, periods.previous.start, periods.previous.end,
        prev, cur, c?.abs ?? null, c?.rate ?? null, encOrNull(note)).lastInsertRowid,
    );
    ids.set(key, id);
  };
  for (const role of ['total', 'organic', 'advertising'] as SegmentRole[]) {
    const s = ga4.sessions[role];
    const c = ga4.cv[role];
    const seg = ga4.series.sessions[role];
    if (!s && !c && !seg?.byDate.size) continue;
    const subjectType = role === 'total' ? 'site' : 'traffic_source';
    const segment = cfg.segments[role].value;
    put(`${role}|sessions`, 'GA4', subjectType, segment, 'sessions', s?.prev.value ?? null, s?.cur.value ?? null, missingNote(s, W.sessions));
    put(`${role}|cv`, 'GA4', subjectType, segment, 'cv', c?.prev.value ?? null, c?.cur.value ?? null, missingNote(c, W.cv));
    const cvrPrev = s?.prev.value != null && c?.prev.value != null ? ratio(c.prev.value, s.prev.value) : null;
    const cvrCur = s?.cur.value != null && c?.cur.value != null ? ratio(c.cur.value, s.cur.value) : null;
    put(`${role}|cvr`, 'GA4', subjectType, segment, 'cvr', cvrPrev, cvrCur, cat([missingNote(s, W.sessions), missingNote(c, W.cv)]));
  }
  // Unmapped segments (e.g. direct): stored for traffic-source performance, not used by any rule.
  for (const segment of ga4.otherSegments) {
    const ss = dailySeries(db, { source: 'GA4', segment, sourceMetricNames: cfg.metricNames.sessions.value });
    if (!ss.byDate.size) continue;
    const s: Pair = { prev: sumPeriod(ss, periods.previous), cur: sumPeriod(ss, periods.current) };
    const note = missingNote(s, W.sessions);
    put(`${segment}|sessions`, 'GA4', 'traffic_source', segment, 'sessions', s.prev.value, s.cur.value, blank(note) ? tx('Not used by any client rule.', 'クライアントルールでは使用しません。') : note);
  }
  return ids;
}

// ---------- Rule ① ----------

function measureRule1(db: DB, cfg: AppConfig, rule: RuleConfig, periods: Periods, ga4: Ga4Inputs, results: Map<ResultKey, number>): MeasurementDraft {
  const total = ga4.sessions.total;
  const base: Omit<MeasurementDraft, 'judgment' | 'cause' | 'change'> = {
    rule,
    analysisResultId: results.get('total|sessions') ?? null,
    evidence: { items: mappingItems(cfg, ['total', 'organic', 'advertising'], 'sessions'), tables: [] },
    importedDataIds: refs(total),
    subject: cfg.segments.total.value,
    metric: 'sessions',
  };
  if (!complete(total)) {
    const note = missingNote(total, W.total);
    return { ...base, change: null, cause: null, judgment: { status: 'NOT_EVALUABLE', result: NOT_EVALUABLE, reason: blank(note) ? tx('Total sessions data missing.', '全体セッションのデータがありません。') : note } };
  }

  const totalChange = pairChange(total);
  const judgment = judge(rule, totalChange);
  const organic = complete(ga4.sessions.organic) ? pairChange(ga4.sessions.organic) : null;
  const advertising = complete(ga4.sessions.advertising) ? pairChange(ga4.sessions.advertising) : null;
  const follow = rule1FollowUp(totalChange, organic, advertising);

  // Primary judgment: organic and advertising traffic (always shown, also when OK).
  // Share is shown only for channels that decreased while total sessions decreased.
  const label: Record<Channel, LText> = { organic: W.organic, advertising: W.advertising };
  const missingRow = (l: LText, seg: string) => [enc(l), seg, null, null, null, enc(MISSING), null];
  const primaryTable: EvidenceTable = {
    title: enc(tx('Primary judgment — organic and advertising traffic (GA4 sessions)', '一次判断 — オーガニック流入と広告流入（GA4 セッション）')),
    columns: [
      enc(tx('Traffic', '流入')), enc(tx('GA4 segment', 'GA4 セグメント')), enc(tx('Previous', '前期')), enc(tx('Current', '今期')),
      enc(tx('Change', '変化')), enc(tx('Change rate', '変化率')), enc(tx('Share of total decrease', '全体減少に占める割合')),
    ],
    rows: [
      row(tx('Total', '全体'), cfg.segments.total.value, totalChange, null),
      organic ? row(W.organic, cfg.segments.organic.value, organic, follow.contribution.organic) : missingRow(W.organic, cfg.segments.organic.value),
      advertising ? row(W.advertising, cfg.segments.advertising.value, advertising, follow.contribution.advertising) : missingRow(W.advertising, cfg.segments.advertising.value),
    ],
    note: encOrNull(cat([missingNote(ga4.sessions.organic, W.organic), missingNote(ga4.sessions.advertising, W.advertising)])) ?? undefined,
  };
  base.evidence.tables.push(primaryTable);
  base.importedDataIds.push(...refs(ga4.sessions.organic), ...refs(ga4.sessions.advertising));

  if (judgment.status !== 'NG') return { ...base, change: totalChange, judgment, cause: null };

  // ---- What to Check Next ----
  const actions = cfg.actions['GA4-R1'] ?? {};
  const changes: Record<Channel, Change | null> = { organic, advertising };
  const lines: LText[] = [];
  const causeEvidence: Evidence = { items: [], tables: [primaryTable] };
  const caveats: LText[] = unconfirmedMappings(cfg, ['total', 'organic', 'advertising']);

  const up = totalChange.abs > 0;
  lines.push(
    tx(
      `Total sessions ${up ? 'increased' : 'decreased'} ${fmtPct(totalChange.rate)} WoW (${fmtNum(totalChange.previous)} → ${fmtNum(totalChange.current)}).`,
      `全体セッションが前週比 ${fmtPct(totalChange.rate)} ${up ? '増加' : '減少'}しました（${fmtNum(totalChange.previous)} → ${fmtNum(totalChange.current)}）。`,
    ),
  );
  for (const ch of follow.decreased) lines.push(cat([describeChannelChange(label[ch], changes[ch]!, follow.contribution[ch]), tx('.', '。')], ''));

  let branch: string = follow.branch;
  let confidence: Confidence = 'Medium';
  const countermeasures: CauseDraft['countermeasures'] = [];
  if (follow.branch === 'missing-data') {
    const m = follow.missing.map((x) => label[x]);
    lines.push(
      tx(
        `Follow-up cannot be fully determined: no complete ${m.map((x) => x.en.toLowerCase()).join(' / ')} data for both weeks.`,
        `両週の${m.map((x) => x.ja).join('・')}のデータが揃っていないため、フォローアップを判定できません。`,
      ),
    );
    confidence = 'Low';
  } else if (follow.branch === 'none') {
    lines.push(
      tx(
        `Neither organic nor advertising traffic decreased (organic ${fmtPct(organic!.rate)}, advertising ${fmtPct(advertising!.rate)}). Rule ① defines no follow-up for this case.`,
        `オーガニック流入・広告流入のどちらも減少していません（オーガニック ${fmtPct(organic!.rate)}、広告 ${fmtPct(advertising!.rate)}）。ルール①にはこのケースのフォローアップが定義されていません。`,
      ),
    );
    confidence = 'Low';
  } else if (follow.branch === 'both') {
    lines.push(
      follow.primary
        ? tx(
            `Both decreased; ${label[follow.primary].en.toLowerCase()} traffic has the larger contribution to the decrease and is reported as the primary cause.`,
            `両方が減少しました。減少への寄与が大きい${label[follow.primary].ja}を主因として報告します。`,
          )
        : tx('Both decreased by the same number of sessions; neither has a larger contribution.', '両方が同じセッション数だけ減少しており、寄与の大小はありません。'),
    );
    branch = follow.primary ? `both-${follow.primary}-primary` : 'both-equal';
  }
  for (const ch of follow.decreased) {
    const a = actions[ch];
    if (!a) continue;
    const role =
      follow.branch === 'both' ? (ch === follow.primary ? tx(' (primary cause)', '（主因）') : tx(' (secondary)', '（副次）')) : tx('');
    const describe = describeChannelChange(label[ch], changes[ch]!, follow.contribution[ch]);
    countermeasures.push({
      action: a.action,
      team: a.team ?? null,
      target: tx(`${label[ch].en} traffic — GA4 segment ${cfg.segments[ch].value}`, `${label[ch].ja} — GA4 セグメント ${cfg.segments[ch].value}`),
      reason: tx(
        `${describe.en}${role.en}. Rule ① What to Check Next: "If ${ch} traffic decreases → ${a.action.en}"`,
        `${describe.ja}${role.ja}。ルール①「次に確認すること」：${label[ch].ja}が減少 → ${a.action.ja}`,
      ),
    });
  }

  // GSC supporting evidence — only when organic traffic decreased.
  if (follow.decreased.includes('organic')) {
    const gsc = buildGscEvidence(db, cfg, periods);
    causeEvidence.items.push(...gsc.items);
    causeEvidence.tables.push(...gsc.tables);
    base.importedDataIds.push(...gsc.importedDataIds);
    if (gsc.dailyAligned)
      lines.push(
        gsc.observations.length
          ? tx(`GSC daily chart for the same weeks: ${gsc.observations.map((o) => o.en).join('; ')}.`, `同じ週の GSC 日次チャート：${gsc.observations.map((o) => o.ja).join('、')}。`)
          : tx('GSC daily chart for the same weeks shows no decrease in position, impressions or CTR.', '同じ週の GSC 日次チャートでは、掲載順位・表示回数・CTR の悪化は見られません。'),
      );
    else {
      lines.push(tx('GSC daily chart does not cover the measured weeks, so it gives no reason for the organic change.', 'GSC 日次チャートが測定週をカバーしていないため、オーガニック変化の理由は示せません。'));
      caveats.push(tx('GSC daily chart not available for the measured weeks', '測定週の GSC 日次チャートなし'));
    }
    if (!cfg.brandTerms.confirmed) caveats.push(tx('brand classification provisional', 'ブランド分類は暫定'));
  }
  base.evidence.items.push(...causeEvidence.items);
  base.evidence.tables.push(...causeEvidence.tables.filter((t) => t !== primaryTable));

  const confidenceReason =
    confidence === 'Low'
      ? tx('No Rule ① branch could be applied to the data.', 'データにルール①の分岐を適用できませんでした。')
      : caveats.length
        ? tx(`Rule ① branch matched; depends on: ${caveats.map((c) => c.en).join('; ')}.`, `ルール①の分岐に該当。前提：${caveats.map((c) => c.ja).join('、')}。`)
        : tx('Rule ① branch matched with complete data.', '完全なデータでルール①の分岐に該当しました。');
  if (confidence === 'Medium' && !caveats.length) confidence = 'High';

  return {
    ...base,
    change: totalChange,
    judgment,
    cause: { branch, text: cat(lines), confidence, confidenceReason, evidence: causeEvidence, countermeasures },
  };
}

// ---------- Rule ② ----------

function measureRule2(cfg: AppConfig, rule: RuleConfig, ga4: Ga4Inputs, results: Map<ResultKey, number>): MeasurementDraft {
  const s = ga4.sessions.total;
  const c = ga4.cv.total;
  const base: Omit<MeasurementDraft, 'judgment' | 'cause' | 'change'> = {
    rule,
    analysisResultId: results.get('total|cvr') ?? null,
    evidence: { items: mappingItems(cfg, ['total'], 'cv'), tables: [] },
    importedDataIds: [...refs(s), ...refs(c)],
    subject: cfg.segments.total.value,
    metric: 'cvr',
  };
  if (!complete(s) || !complete(c)) {
    const why = cat([missingNote(s, W.sessions), missingNote(c, tx(`CV (${cfg.metricNames.cv.value.join(' / ')})`))]);
    return {
      ...base,
      change: null,
      cause: null,
      judgment: { status: 'NOT_EVALUABLE', result: NOT_EVALUABLE, reason: blank(why) ? tx('Sessions or CV data missing.', 'セッションまたは CV のデータがありません。') : why },
    };
  }
  const sessions = pairChange(s);
  const cv = pairChange(c);
  const cvrPrev = ratio(cv.previous, sessions.previous);
  const cvrCur = ratio(cv.current, sessions.current);
  base.evidence.tables.push({
    title: enc(tx('Primary judgment — sessions and CV (GA4, total segment)', '一次判断 — セッションと CV（GA4 全体セグメント）')),
    columns: [enc(tx('Metric', '指標')), enc(tx('Previous', '前期')), enc(tx('Current', '今期')), enc(tx('Change', '変化')), enc(tx('Change rate', '変化率'))],
    rows: [
      [enc(W.sessions), sessions.previous, sessions.current, sessions.abs, fmtPct(sessions.rate)],
      [`CV (${cfg.metricNames.cv.value[0]})`, cv.previous, cv.current, cv.abs, fmtPct(cv.rate)],
      [enc(tx('CVR (%) = CV ÷ Sessions × 100', 'CVR (%) = CV ÷ セッション × 100')), cvrPrev === null ? null : round(cvrPrev, 4), cvrCur === null ? null : round(cvrCur, 4),
        cvrPrev === null || cvrCur === null ? null : round(cvrCur - cvrPrev, 4), cvrPrev && cvrCur !== null ? fmtPct(((cvrCur - cvrPrev) / cvrPrev) * 100) : '—'],
    ],
  });
  if (cvrPrev === null || cvrCur === null)
    return {
      ...base,
      change: null,
      cause: null,
      judgment: { status: 'NOT_EVALUABLE', result: NOT_EVALUABLE, reason: tx('Sessions are 0 in a period, so CVR cannot be calculated (division by zero).', 'セッションが 0 の期間があるため CVR を計算できません（ゼロ除算）。') },
    };

  const cvr = change(cvrPrev, cvrCur);
  const judgment = judge(rule, cvr);
  if (judgment.status !== 'NG') return { ...base, change: cvr, judgment, cause: null };

  const follow = rule2FollowUp(sessions, cv, cvr, rule.flatBandPercent);
  const action = follow.branch in (cfg.actions['GA4-R2'] ?? {}) ? cfg.actions['GA4-R2']![follow.branch] : undefined;
  const caveats = unconfirmedMappings(cfg, ['total']);
  if (!cfg.metricNames.cv.confirmed) caveats.push(tx('CV column mapping unconfirmed', 'CV 列の対応は未確認'));
  const matched = !!action;
  const cond = action?.condition ?? tx('');
  const text = matched ? tx(`${follow.explanation.en} Rule ② branch: "${cond.en}".`, `${follow.explanation.ja}ルール②の分岐：「${cond.ja}」。`) : follow.explanation;
  return {
    ...base,
    change: cvr,
    judgment,
    cause: {
      branch: follow.branch,
      text,
      confidence: matched ? (caveats.length ? 'Medium' : 'High') : 'Low',
      confidenceReason: matched
        ? caveats.length
          ? tx(`Rule ② branch matched; depends on: ${caveats.map((x) => x.en).join('; ')}.`, `ルール②の分岐に該当。前提：${caveats.map((x) => x.ja).join('、')}。`)
          : tx('Rule ② branch matched with complete data.', '完全なデータでルール②の分岐に該当しました。')
        : follow.branch === 'undetermined'
          ? tx('"Flat" is not defined by the client, so no branch can be applied.', 'クライアントが「横ばい」を定義していないため、分岐を適用できません。')
          : tx('No Rule ② branch covers this combination.', 'ルール②にこの組み合わせの分岐はありません。'),
      evidence: { items: [], tables: base.evidence.tables },
      countermeasures: matched
        ? [
            {
              action: action!.action,
              team: action!.team ?? null,
              target: tx(`Site total — GA4 segment ${cfg.segments.total.value}`, `サイト全体 — GA4 セグメント ${cfg.segments.total.value}`),
              reason: tx(
                `${follow.explanation.en} Rule ② What to Check Next: "${cond.en} → ${action!.action.en}"`,
                `${follow.explanation.ja}ルール②「次に確認すること」：${cond.ja} → ${action!.action.ja}`,
              ),
            },
          ]
        : [],
    },
  };
}

function notImplemented(rule: RuleConfig): MeasurementDraft {
  return {
    rule,
    analysisResultId: null,
    judgment: { status: 'NOT_EVALUABLE', result: NOT_EVALUABLE, reason: tx(`No evaluator exists for rule ${rule.id}.`, `ルール ${rule.id} の評価処理がありません。`) },
    evidence: { items: [], tables: [] },
    importedDataIds: [],
    subject: rule.subject,
    metric: rule.metric,
    change: null,
    cause: null,
  };
}

// ---------- Persistence ----------

function persistMeasurement(db: DB, runId: number, d: MeasurementDraft) {
  const now = nowIso();
  const name = dec(d.rule.name);
  const mId = Number(
    db
      .prepare(
        `INSERT INTO measurements (run_id, analysis_result_id, measurement_name, rule_id, threshold_value, threshold_unit, result, status, reason, evidence_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(runId, d.analysisResultId, enc(tx(`${d.rule.number} ${name.en}`, `${d.rule.number} ${name.ja}`)), d.rule.id, d.rule.thresholdValue, d.rule.thresholdUnit,
        enc(d.judgment.result), d.judgment.status, enc(d.judgment.reason), JSON.stringify(d.evidence), now).lastInsertRowid,
  );
  const link = db.prepare('INSERT OR IGNORE INTO measurement_sources (measurement_id, imported_data_id) VALUES (?, ?)');
  for (const id of new Set(d.importedDataIds)) link.run(mId, id);

  if (d.judgment.status !== 'NG' || !d.change) return;
  const aId = Number(
    db
      .prepare(
        `INSERT INTO anomalies (measurement_id, subject_type, subject_key, metric, previous_value, current_value, change, change_rate, detection_date, state)
         VALUES (?, 'site', ?, ?, ?, ?, ?, ?, ?, 'Detected')`,
      )
      .run(mId, d.subject, d.metric, d.change.previous, d.change.current, d.change.abs, d.change.rate, now.slice(0, 10)).lastInsertRowid,
  );
  if (!d.cause) return;
  const cId = Number(
    db
      .prepare(
        `INSERT INTO cause_hypotheses (anomaly_id, branch, cause_text, supporting_evidence, confidence, confidence_reason, review_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'NotReviewed', ?)`,
      )
      .run(aId, d.cause.branch, enc(d.cause.text), JSON.stringify(d.cause.evidence), d.cause.confidence, enc(d.cause.confidenceReason), now).lastInsertRowid,
  );
  const ins = db.prepare(`INSERT INTO countermeasures (cause_id, action_text, reason, target, responsible_team, status, created_at) VALUES (?, ?, ?, ?, ?, 'Proposed', ?)`);
  for (const k of d.cause.countermeasures) ins.run(cId, enc(k.action), enc(k.reason), enc(k.target), k.team ? enc(k.team) : null, now);
}

// ---------- Helpers ----------

function refs(p: Pair | undefined): number[] {
  return p ? [...p.prev.refs, ...p.cur.refs].map((r) => r.importedDataId) : [];
}

function row(label: LText, segment: string, c: Change, share: number | null) {
  return [enc(label), segment, c.previous, c.current, c.abs, fmtPct(c.rate), share === null ? '—' : `${share.toFixed(1)}%`];
}

const ROLE: Record<SegmentRole, LText> = { total: tx('total', '全体'), organic: tx('organic', 'オーガニック流入'), advertising: tx('advertising', '広告流入') };

function unconfirmedMappings(cfg: AppConfig, roles: SegmentRole[]): LText[] {
  return roles
    .filter((r) => !cfg.segments[r].confirmed)
    .map((r) => tx(`segment "${cfg.segments[r].value}" as ${ROLE[r].en} (unconfirmed)`, `セグメント「${cfg.segments[r].value}」を${ROLE[r].ja}として使用（未確認）`));
}

function mappingItems(cfg: AppConfig, roles: SegmentRole[], metric: 'sessions' | 'cv'): EvidenceItem[] {
  const unconfirmed = enc(tx('Mapping not confirmed by the client.', 'クライアント未確認の対応付けです。'));
  const label: Record<SegmentRole, LText> = { total: tx('Total traffic', '全体'), organic: tx('Organic traffic', 'オーガニック流入'), advertising: tx('Advertising traffic', '広告流入') };
  const items: EvidenceItem[] = roles.map((r) => ({
    label: enc(label[r]),
    value: enc(tx(`GA4 segment "${cfg.segments[r].value}"`, `GA4 セグメント「${cfg.segments[r].value}」`)),
    caveat: cfg.segments[r].confirmed ? undefined : unconfirmed,
  }));
  if (metric === 'cv') {
    const cols = cfg.metricNames.cv.value.map((n) => `"${n}"`).join(' / ');
    items.push({ label: 'CV', value: enc(tx(`GA4 column ${cols}`, `GA4 の列 ${cols}`)), caveat: cfg.metricNames.cv.confirmed ? undefined : unconfirmed });
  }
  return items;
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
