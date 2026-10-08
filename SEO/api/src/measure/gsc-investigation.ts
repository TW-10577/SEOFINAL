// rules.yaml GSC_R01 — Organic Traffic Decrease Investigation.
// Not an OK / NG measurement. It runs when its trigger holds (GA4_R01 NG and organic sessions decreased) and
// looks for evidence that may explain the organic decrease:
//   1. each `investigation` check (query, page, device, search appearance) compares the GSC export of the
//      previous measured week with the export of the current measured week (rows present in both weeks);
//   2. `cause_identification.priority_order` is evaluated in order on the signals found; the first condition
//      that holds is the possible cause, else `fallback`;
//   3. the cause is mapped to a `countermeasure_mapping` action.
// A "decrease" needs two periods. A GSC export that is a single total for a longer period (e.g. 3 months)
// cannot show one, so without exports for both measured weeks the check reports insufficient data.
import type { GscAffectedRow, GscInvestigation, GscInvestigationCheck, GscMetricChange, InvestigationConfidence, Period } from '@seo/shared';
import type { InvestigationSpec } from '../config.ts';
import type { DB } from '../db.ts';
import { cat, enc, tx, type LText } from '../i18n.ts';
import { evalCondition, variablesOf, type Vars } from './expr.ts';
import { change, fmtNum, fmtPct, ratio } from './logic.ts';

interface Periods {
  current: Period;
  previous: Period;
}

/** input key → stored structure and the column holding the row key. */
const SOURCES: Record<string, { structure: string; column: string; noun: LText }> = {
  query: { structure: 'gsc-query', column: 'query', noun: tx('queries', 'クエリ') },
  page: { structure: 'gsc-page', column: 'page_url', noun: tx('pages', 'ページ') },
  device: { structure: 'gsc-device', column: 'device', noun: tx('devices', 'デバイス') },
  country: { structure: 'gsc-country', column: 'country', noun: tx('countries', '国') },
  search_appearance: { structure: 'gsc-appearance', column: 'search_appearance', noun: tx('search appearances', '検索での見え方') },
};

/** Signal name prefix used by cause_identification (queries_with_…, pages_with_…). */
const PLURAL: Record<string, string> = { query: 'queries', page: 'pages', device: 'devices', country: 'countries', search_appearance: 'search_appearances' };

/** "Concentrated": one row accounts for more than half of the clicks decrease. rules.yaml gives no number. */
const CONCENTRATED_SHARE = 50;
const AFFECTED_ROWS = 10;

/**
 * cause_identification condition → countermeasure_mapping key. rules.yaml lists both but does not link them,
 * so the link follows the wording of the cause: ranking → ranking_drop, visibility → impression_drop,
 * specific pages → page_specific_drop, click-through → ctr_drop, device → device_specific_drop.
 */
function countermeasureKey(condition: string): string {
  const c = condition.toLowerCase();
  if (c.includes('queries') && c.includes('position_drop')) return 'ranking_drop';
  if (c.includes('impression_decrease')) return 'impression_drop';
  if (c.includes('pages') && c.includes('position_drop')) return 'page_specific_drop';
  if (c.includes('ctr_decrease')) return 'ctr_drop';
  if (c.includes('device')) return 'device_specific_drop';
  if (c.includes('search_appearance')) return 'ctr_drop';
  return 'no_clear_cause';
}

interface Row {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
  ids: number[];
}

/** Latest upload whose rows of `structure` cover exactly `p`. */
async function uploadFor(db: DB, structure: string, p: Period, ids?: number[]): Promise<{ id: number; fileName: string } | null> {
  const r = await db.get<{ id: number; file_name: string }>(
      `SELECT u.id, u.file_name FROM uploads u JOIN imported_data d ON d.upload_id = u.id
       WHERE u.source = 'GSC' AND u.import_status = 'imported' AND d.structure = ? AND d.period_start = ? AND d.period_end = ?${ids ? ` AND u.id IN (${ids.map(() => '?').join(',') || 'NULL'})` : ''}
       ORDER BY u.id DESC LIMIT 1`,
      structure,
      p.start,
      p.end,
      ...(ids ?? []),
  );
  return r ? { id: r.id, fileName: r.file_name } : null;
}

async function rowsOf(db: DB, uploadId: number, structure: string, column: string): Promise<Map<string, Row>> {
  const data = await db.all<{ id: number; k: string; metric_name: string; metric_value: number | null }>(
    `SELECT id, ${column} AS k, metric_name, metric_value FROM imported_data WHERE upload_id = ? AND structure = ? AND is_valid = 1 AND ${column} IS NOT NULL`,
    uploadId,
    structure,
  );
  const out = new Map<string, Row>();
  for (const d of data) {
    const r = out.get(d.k) ?? { key: d.k, clicks: 0, impressions: 0, ctr: null, position: null, ids: [] };
    if (d.metric_name === 'clicks') r.clicks = d.metric_value ?? 0;
    if (d.metric_name === 'impressions') r.impressions = d.metric_value ?? 0;
    if (d.metric_name === 'ctr') r.ctr = d.metric_value;
    if (d.metric_name === 'position') r.position = d.metric_value;
    r.ids.push(d.id);
    out.set(d.k, r);
  }
  return out;
}

function metricChange(metric: GscMetricChange['metric'], previous: number, current: number): GscMetricChange {
  const c = change(previous, current);
  const eps = 1e-9;
  const direction: GscMetricChange['direction'] =
    metric === 'position' ? (c.abs > eps ? 'worse' : c.abs < -eps ? 'better' : 'same') : c.abs > eps ? 'up' : c.abs < -eps ? 'down' : 'same';
  return { metric, previous, current, change: c.abs, changeRate: c.rate, direction };
}

/** Totals over rows: clicks, impressions, CTR = clicks ÷ impressions, position weighted by impressions. */
function totals(rows: Row[]) {
  const clicks = rows.reduce((a, r) => a + r.clicks, 0);
  const impressions = rows.reduce((a, r) => a + r.impressions, 0);
  const weighted = rows.filter((r) => r.position != null && r.impressions > 0);
  const w = weighted.reduce((a, r) => a + r.impressions, 0);
  return { clicks, impressions, ctr: ratio(clicks, impressions), position: w ? weighted.reduce((a, r) => a + r.position! * r.impressions, 0) / w : null };
}

interface CheckResult {
  check: GscInvestigationCheck;
  /** Key of the row the decrease is concentrated in (device / search appearance). */
  concentrated: string | null;
  affectedKeys: string[];
  ids: number[];
}

async function runCheck(db: DB, spec: InvestigationSpec, c: InvestigationSpec['checks'][number], periods: Periods, ids?: number[]): Promise<CheckResult> {
  const src = SOURCES[c.source];
  const file = spec.inputs[c.source]?.file ?? c.source;
  const empty = (reason: LText, files = { previous: null as string | null, current: null as string | null }): CheckResult => ({
    check: { id: c.id, source: c.source, available: false, reason: enc(reason), files, totals: [], affected: [], signals: {}, interpretations: [] },
    concentrated: null,
    affectedKeys: [],
    ids: [],
  });
  if (!src) return empty(tx(`Unknown source "${c.source}".`, `不明なソース「${c.source}」。`));
  const prevUp = await uploadFor(db, src.structure, periods.previous, ids);
  const curUp = await uploadFor(db, src.structure, periods.current, ids);
  if (!prevUp || !curUp) {
    const missing = [!prevUp ? `${periods.previous.start} – ${periods.previous.end}` : null, !curUp ? `${periods.current.start} – ${periods.current.end}` : null].filter(Boolean).join(', ');
    return empty(
      tx(
        `No ${file} export for ${missing}. A decrease needs one export per measured week; an export for a longer period (e.g. 3 months) is a single total and cannot show a week-on-week change.`,
        `${missing} の ${file} のエクスポートがありません。減少を判断するには測定週ごとのエクスポートが必要です。より長い期間（例：3 か月）のエクスポートは期間全体の合計のため、前週比の変化は分かりません。`,
      ),
      { previous: prevUp?.fileName ?? null, current: curUp?.fileName ?? null },
    );
  }
  const prev = await rowsOf(db, prevUp.id, src.structure, src.column);
  const cur = await rowsOf(db, curUp.id, src.structure, src.column);
  // GSC omits rows (row cap, privacy filtering): a key missing from one week is "not in export", not 0.
  const keys = [...prev.keys()].filter((k) => cur.has(k));
  const p = totals(keys.map((k) => prev.get(k)!));
  const q = totals(keys.map((k) => cur.get(k)!));
  const tot: GscMetricChange[] = [metricChange('clicks', p.clicks, q.clicks), metricChange('impressions', p.impressions, q.impressions)];
  if (p.ctr != null && q.ctr != null) tot.push(metricChange('ctr', p.ctr, q.ctr));
  if (p.position != null && q.position != null) tot.push(metricChange('position', p.position, q.position));
  const dir = (m: string) => tot.find((x) => x.metric === m)?.direction ?? null;

  const rows = keys.map((k) => ({ a: prev.get(k)!, b: cur.get(k)! }));
  const decrease = rows.filter((r) => r.b.clicks < r.a.clicks).reduce((s, r) => s + (r.b.clicks - r.a.clicks), 0);
  const affected: GscAffectedRow[] = rows
    .filter((r) => r.b.clicks < r.a.clicks)
    .sort((x, y) => x.b.clicks - x.a.clicks - (y.b.clicks - y.a.clicks))
    .slice(0, AFFECTED_ROWS)
    .map(({ a, b }) => ({
      key: a.key,
      clicksPrevious: a.clicks,
      clicksCurrent: b.clicks,
      clicksChange: b.clicks - a.clicks,
      impressionsChange: b.impressions - a.impressions,
      ctrPrevious: a.ctr,
      ctrCurrent: b.ctr,
      positionPrevious: a.position,
      positionCurrent: b.position,
      share: decrease < 0 ? ((b.clicks - a.clicks) / decrease) * 100 : null,
    }));

  const n = PLURAL[c.source] ?? c.source;
  const signals: Record<string, boolean | null> = {
    [`${n}_with_click_decrease`]: dir('clicks') === 'down',
    [`${n}_with_impression_decrease`]: dir('impressions') === 'down',
    [`${n}_with_ctr_decrease`]: dir('ctr') == null ? null : dir('ctr') === 'down',
    [`${n}_with_position_drop`]: dir('position') == null ? null : dir('position') === 'worse',
  };
  // "Concentrated" (device / search appearance): clicks fell and one row holds most of the decrease.
  const top = affected[0];
  const concentrated = dir('clicks') === 'down' && top?.share != null && top.share > CONCENTRATED_SHARE ? top.key : null;
  if (c.identify.some((x) => x.startsWith('affected_'))) for (const x of c.identify.filter((y) => y.startsWith('affected_'))) signals[x] = concentrated !== null;

  const interp = c.interpretation;
  const interpretations: LText[] = [];
  if (interp.all) {
    if (concentrated) interpretations.push(cat([interp.all, tx(`→ ${concentrated} (${top!.share!.toFixed(1)}% of the clicks decrease).`, `→ ${concentrated}（クリック減少の ${top!.share!.toFixed(1)}%）。`)]));
  } else
    for (const [sig, key] of [['click_decrease', 'clicks_decrease'], ['impression_decrease', 'impressions_decrease'], ['ctr_decrease', 'ctr_decrease'], ['position_drop', 'position_drop']] as const)
      if (signals[`${n}_with_${sig}`] && interp[key]) interpretations.push(interp[key]!);

  return {
    check: {
      id: c.id,
      source: c.source,
      available: true,
      reason: keys.length < Math.max(prev.size, cur.size) ? enc(tx(`${Math.max(prev.size, cur.size) - keys.length} row(s) appear in only one week's export and are not compared (not in export ≠ 0 clicks).`, `一方の週のエクスポートにしかない ${Math.max(prev.size, cur.size) - keys.length} 行は比較していません（エクスポートにない ≠ 0 クリック）。`)) : null,
      files: { previous: prevUp.fileName, current: curUp.fileName },
      totals: tot,
      affected,
      signals,
      interpretations: interpretations.map(enc),
    },
    concentrated,
    affectedKeys: affected.map((r) => r.key),
    ids: rows.flatMap((r) => [...r.a.ids, ...r.b.ids]),
  };
}

/**
 * Runs GSC_R01 for the measured weeks. `site` is the GSC Chart by Date change for the same weeks when one is
 * uploaded (site-level clicks, impressions, CTR, position).
 */
export async function runGscInvestigation(db: DB, spec: InvestigationSpec, periods: Periods, site: GscMetricChange[], ids?: number[]): Promise<{ result: GscInvestigation; importedDataIds: number[] }> {
  const results: CheckResult[] = [];
  for (const c of spec.checks) results.push(await runCheck(db, spec, c, periods, ids));
  const signals: Vars = {};
  for (const r of results) Object.assign(signals, r.check.signals);
  const siteDir = (m: string) => site.find((x) => x.metric === m)?.direction ?? null;
  const q = results.find((r) => r.check.source === 'query' && r.check.available);
  const pg = results.find((r) => r.check.source === 'page' && r.check.available);
  const definitions: LText[] = [];
  // position_drop / impressions_stable: site-level (Chart by Date) when available, else the query (or page) totals.
  const level = (m: 'position' | 'impressions') => {
    if (siteDir(m)) return { dir: siteDir(m), from: tx('GSC Chart by Date', 'GSC 日付別チャート') };
    const r = q ?? pg;
    const d = r?.check.totals.find((x) => x.metric === m)?.direction ?? null;
    return { dir: d, from: r ? tx(`${r.check.source} export totals`, `${r.check.source} エクスポートの合計`) : null };
  };
  const pos = level('position');
  const imp = level('impressions');
  signals.position_drop = pos.dir == null ? null : pos.dir === 'worse';
  signals.impressions_stable = imp.dir == null ? null : imp.dir !== 'down';
  if (pos.from) definitions.push(tx(`position_drop: average position got worse week on week (${pos.from.en}).`, `position_drop：平均掲載順位が前週より悪化（${pos.from.ja}）。`));
  if (imp.from) definitions.push(tx(`impressions_stable: impressions did not decrease week on week (${imp.from.en}); rules.yaml gives no tolerance.`, `impressions_stable：表示回数が前週より減少していない（${imp.from.ja}）。rules.yaml に許容幅の定義はありません。`));
  definitions.push(
    tx(`affected_device / affected_search_appearance: clicks decreased and one ${'row'} holds more than ${CONCENTRATED_SHARE}% of the clicks decrease ("concentrated" is not given a number in rules.yaml).`, `affected_device / affected_search_appearance：クリック数が減少し、1 つの項目がクリック減少の ${CONCENTRATED_SHARE}% 超を占める（rules.yaml に「集中」の数値定義はありません）。`),
    tx('A decrease is read by direction (current week below previous week); rules.yaml gives no minimum size.', '減少は方向で判断します（今週が前週を下回る）。rules.yaml に最小幅の定義はありません。'),
  );

  // cause_identification: first condition that holds.
  let matched: { condition: string; cause: LText } | null = null;
  for (const p of spec.priority)
    if (evalCondition(p.condition, signals) === true) {
      matched = p;
      break;
    }
  const key = matched ? countermeasureKey(matched.condition) : 'no_clear_cause';
  const action = spec.countermeasures[key] ?? spec.countermeasures.no_clear_cause ?? tx('');

  const anyData = results.some((r) => r.check.available) || site.length > 0;
  const confidence: InvestigationConfidence = !anyData
    ? 'insufficient_data'
    : matched
      ? variablesOf(matched.condition).length > 1
        ? 'high'
        : 'medium'
      : 'low';

  const device = results.find((r) => r.check.source === 'device')?.concentrated ?? null;
  const appearance = results.find((r) => r.check.source === 'search_appearance')?.concentrated ?? null;
  const evidence: LText[] = [];
  for (const m of site)
    evidence.push(tx(`Site (Chart by Date): ${m.metric} ${m.metric === 'position' ? `${m.previous.toFixed(2)} → ${m.current.toFixed(2)}` : fmtPct(m.changeRate)}`, `サイト（日付別チャート）：${m.metric} ${m.metric === 'position' ? `${m.previous.toFixed(2)} → ${m.current.toFixed(2)}` : fmtPct(m.changeRate)}`));
  for (const r of results.filter((x) => x.check.available)) {
    const cl = r.check.totals.find((x) => x.metric === 'clicks');
    const noun = SOURCES[r.check.source]?.noun ?? tx(r.check.source);
    if (cl) evidence.push(tx(`${r.check.id}: clicks ${fmtNum(cl.previous)} → ${fmtNum(cl.current)} (${fmtPct(cl.changeRate)}) over ${noun.en} in both weeks${r.affectedKeys.length ? `; largest decreases: ${r.affectedKeys.slice(0, 3).join(', ')}` : ''}.`, `${r.check.id}：両週にある${noun.ja}のクリック数 ${fmtNum(cl.previous)} → ${fmtNum(cl.current)}（${fmtPct(cl.changeRate)}）${r.affectedKeys.length ? `。減少が大きい順：${r.affectedKeys.slice(0, 3).join('、')}` : ''}。`));
    for (const i of r.check.interpretations) evidence.push(tx(JSON.parse(i).en, JSON.parse(i).ja));
  }
  for (const r of results.filter((x) => !x.check.available)) evidence.push(tx(`${r.check.id}: not checked — ${JSON.parse(r.check.reason!).en}`, `${r.check.id}：確認できません — ${JSON.parse(r.check.reason!).ja}`));

  return {
    result: {
      ruleId: spec.id,
      name: enc(spec.name),
      checks: results.map((r) => r.check),
      signals: Object.fromEntries(Object.entries(signals).map(([k, v]) => [k, typeof v === 'boolean' ? v : null])),
      siteChanges: site,
      matched: matched?.condition ?? null,
      cause: enc(matched?.cause ?? spec.fallback),
      countermeasureKey: key,
      countermeasure: enc(action),
      confidence,
      affectedQueries: q?.affectedKeys ?? [],
      affectedPages: pg?.affectedKeys ?? [],
      affectedDevice: device,
      affectedSearchAppearance: appearance,
      evidence: evidence.map(enc),
      definitions: definitions.map(enc),
    },
    importedDataIds: results.flatMap((r) => r.ids),
  };
}

/** Trigger check: "result == NG" against the rule status, anything else as a rules.yaml condition. */
export function triggered(spec: InvestigationSpec, ruleId: string, status: string, vars: Vars): boolean {
  if (spec.trigger.ruleId !== ruleId) return false;
  return spec.trigger.conditions.every((c) => {
    const m = /^result\s*==\s*(\w+)$/i.exec(c.trim());
    return m ? status === m[1] : evalCondition(c, vars) === true;
  });
}
