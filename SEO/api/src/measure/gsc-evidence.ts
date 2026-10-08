// Search Console supporting evidence for rule ① when GA4 organic traffic decreased (SEO.txt).
// GSC never produces its own measurement, OK / NG or anomaly.
//   Track A — Chart by Date: the only dated GSC data. Compared current week vs previous week (the measured
//     GA4 weeks) to see whether organic search performance went down. Client meanings (SEO.txt), by
//     direction: position worse = ranking dropped, impressions ↓ = fewer searches, CTR ↓ = title/snippet.
//   Track B — Pages / Queries / Devices / Countries: period-total snapshots with no dates. They show where
//     organic search traffic is concentrated (important pages / queries, device and country split); they
//     cannot show what changed week on week.
import type { GscMetricChange, GscShareRow, GscSnapshot, GscSupportingEvidence, GscUploadRef, Period } from '@seo/shared';
import { scopeIds, type AppConfig } from '../config.ts';
import type { DB } from '../db.ts';
import { enc, tx, type LText } from '../i18n.ts';
import { isBrandQuery } from '../import/index.ts';
import { change, fmtNum, ratio } from './logic.ts';
import { dailySeries, sumPeriod, weightedPeriod, weekPeriods, type DailySeries } from './series.ts';

/** SEO.txt: Position worse = ranking dropped · Impressions ↓ = fewer searches · CTR ↓ = title/snippet problem. */
export type GscSignalKey = 'ranking' | 'searches' | 'snippet';

export interface GscEvidenceResult {
  evidence: GscSupportingEvidence;
  /** The date chart covers the measured weeks. */
  dailyAligned: boolean;
  /** Clicks fell in the measured weeks (organic search performance decreased). */
  clicksDown: boolean;
  signals: GscSignalKey[];
  importedDataIds: number[];
}

const e = (en: string, ja: string) => enc(tx(en, ja));
const BOTTOM_ROWS = 5;
const SIGNAL_TO_INDICATION = { ranking: 'ranking', searches: 'search_demand', snippet: 'ctr' } as const;
export const INDICATION_TEXT: Record<GscSupportingEvidence['dateChart']['indications'][number], LText> = {
  ranking: tx('ranking', '順位'),
  search_demand: tx('search demand', '検索需要'),
  ctr: tx('CTR issue', 'CTR の問題'),
};

/** Latest upload that holds rows of a structure (also inside multi-tab exports). */
async function latestUpload(db: DB, structure: string, ids?: number[]): Promise<GscUploadRef | null> {
  const r = await db.get<{ id: number; file_name: string; s: string | null; e: string | null }>(
      `SELECT u.id, u.file_name, MIN(d.period_start) AS s, MAX(d.period_end) AS e FROM uploads u JOIN imported_data d ON d.upload_id = u.id
       WHERE u.source = 'GSC' AND u.import_status = 'imported' AND d.structure = ?${ids ? ` AND u.id IN (${ids.map(() => '?').join(',') || 'NULL'})` : ''} GROUP BY u.id ORDER BY u.id DESC LIMIT 1`,
      structure,
      ...(ids ?? []),
  );
  return r ? { id: r.id, fileName: r.file_name, period: r.s && r.e ? { start: r.s, end: r.e } : null } : null;
}

type Column = 'query' | 'page_url' | 'device' | 'country';

async function rowsOf(db: DB, uploadId: number, structure: string, column: Column): Promise<{ rows: GscShareRow[]; ids: Map<string, number[]> }> {
  const data = await db.all<{ id: number; key: string; metric_name: string; metric_value: number }>(
    `SELECT id, ${column} AS key, metric_name, metric_value FROM imported_data WHERE upload_id = ? AND structure = ? AND is_valid = 1 AND ${column} IS NOT NULL`,
    uploadId,
    structure,
  );
  const map = new Map<string, GscShareRow>();
  const ids = new Map<string, number[]>();
  for (const d of data) {
    const r = map.get(d.key) ?? { key: d.key, clicks: 0, share: null, impressions: 0, ctr: null, position: null };
    if (d.metric_name === 'clicks') r.clicks = d.metric_value;
    if (d.metric_name === 'impressions') r.impressions = d.metric_value;
    if (d.metric_name === 'ctr') r.ctr = d.metric_value;
    if (d.metric_name === 'position') r.position = d.metric_value;
    map.set(d.key, r);
    (ids.get(d.key) ?? ids.set(d.key, []).get(d.key)!).push(d.id);
  }
  return { rows: [...map.values()].sort((a, b) => b.clicks - a.clicks), ids };
}

const missing = (what: LText): GscSnapshot => ({
  available: false,
  reason: e(`No Search Console ${what.en} export uploaded.`, `Search Console の${what.ja}エクスポートがアップロードされていません。`),
  upload: null,
  top: [],
  bottom: [],
  other: null,
  totalClicks: 0,
  note: null,
});

const pct1 = (v: number) => Math.round(v * 10) / 10;

/** Track B snapshot: highest (and lowest) rows by clicks with their share of the total. */
async function snapshot(
  db: DB,
  scope: number[] | undefined,
  structure: string,
  column: Column,
  what: LText,
  topN: number,
  opts: { bottom?: boolean; other?: boolean; denominator?: (u: GscUploadRef) => number | null; note?: (u: GscUploadRef, total: number) => string | null } = {},
): Promise<{ snap: GscSnapshot; ids: number[]; rows: GscShareRow[] }> {
  const up = await latestUpload(db, structure, scope);
  if (!up) return { snap: missing(what), ids: [], rows: [] };
  const { rows, ids } = await rowsOf(db, up.id, structure, column);
  const total = rows.reduce((a, r) => a + r.clicks, 0);
  const impr = rows.reduce((a, r) => a + r.impressions, 0);
  const denom = opts.denominator?.(up) ?? total;
  for (const r of rows) {
    r.share = denom ? pct1((r.clicks / denom) * 100) : null;
    r.impressionsShare = impr ? pct1((r.impressions / impr) * 100) : null;
  }
  const top = rows.slice(0, topN);
  const bottom = opts.bottom ? rows.slice(Math.max(topN, rows.length - BOTTOM_ROWS)).reverse() : [];
  const rest = rows.slice(topN);
  const sum = (f: (r: GscShareRow) => number) => rest.reduce((a, r) => a + f(r), 0);
  const other: GscShareRow | null =
    opts.other && rest.length
      ? {
          key: e(`Other (${rest.length})`, `その他（${rest.length}）`),
          clicks: sum((r) => r.clicks),
          share: denom ? pct1((sum((r) => r.clicks) / denom) * 100) : null,
          impressions: sum((r) => r.impressions),
          impressionsShare: impr ? pct1((sum((r) => r.impressions) / impr) * 100) : null,
          ctr: null,
          position: null,
        }
      : null;
  return {
    snap: { available: true, reason: null, upload: up, top, bottom, other, totalClicks: total, note: opts.note?.(up, total) ?? null },
    ids: [...top, ...bottom].flatMap((r) => ids.get(r.key) ?? []),
    rows,
  };
}

const periodText = (u: GscUploadRef) => (u.period ? `${u.period.start} – ${u.period.end}` : '?');

export async function buildGscEvidence(db: DB, cfg: AppConfig, measured: { current: Period; previous: Period }): Promise<GscEvidenceResult> {
  const ids: number[] = [];
  const n = cfg.evidenceRows;

  // ---- Track A: Chart by Date (current vs previous week) ----
  const gscIds = scopeIds(cfg, 'GSC');
  const sel = (metricName: string) => dailySeries(db, { source: 'GSC', structure: 'gsc-date', metricName, uploadIds: gscIds });
  const clicks = await sel('clicks');
  const impressions = await sel('impressions');
  const position = await sel('position');
  let dateChart: GscSupportingEvidence['dateChart'] = {
    available: false,
    reason: e('No Search Console Chart by Date (daily) export uploaded.', 'Search Console の日付別チャート（日次）エクスポートがアップロードされていません。'),
    upload: await latestUpload(db, 'gsc-date', gscIds),
    periods: null,
    reference: false,
    metrics: [],
    summary: null,
    indications: [],
    indicationText: null,
  };
  let dailyAligned = false;
  let clicksDown = false;
  let signals: GscSignalKey[] = [];
  if (clicks.byDate.size) {
    const daily = compareDaily(clicks, impressions, position, measured);
    if (daily.complete) {
      dailyAligned = true;
      clicksDown = daily.clicksDown;
      signals = daily.signals;
      ids.push(...daily.ids);
      dateChart = { ...dateChart, available: true, reason: null, periods: measured, metrics: daily.metrics, ...describe(daily.clicksDown, daily.signals) };
    } else {
      const dates = [...clicks.byDate.keys()].sort();
      const last = dates[dates.length - 1]!;
      // Latest available weeks, for reference only: not used in the cause hypothesis.
      const ref = compareDaily(clicks, impressions, position, weekPeriods(last));
      dateChart = {
        ...dateChart,
        reason: e(
          `The uploaded chart covers ${dates[0]} – ${last}, not the measured weeks ${measured.previous.start} – ${measured.current.end}. GSC dates are Pacific Time.`,
          `アップロード済みのチャートは ${dates[0]} – ${last} で、測定週 ${measured.previous.start} – ${measured.current.end} を含みません。GSC の日付は太平洋時間です。`,
        ),
        reference: ref.complete,
        periods: ref.complete ? ref.periods : null,
        metrics: ref.complete ? ref.metrics : [],
      };
    }
  }

  // ---- Track B: snapshots (period totals, no dates) ----
  const siteClicks = (u: GscUploadRef) => (u.period ? sumPeriod(clicks, u.period).value : null);
  const capNote = (what: LText) => (u: GscUploadRef, total: number) => {
    const site = siteClicks(u);
    return e(
      `${periodText(u)} total, no dates: shows the important ${what.en}, not week-on-week change. Search Console exports at most 1,000 rows, so not every ${what.en} is listed. Share = clicks ÷ ${site !== null ? `site clicks from the daily chart (${fmtNum(site)})` : `clicks in this export (${fmtNum(total)})`}.`,
      `${periodText(u)} の合計（日付なし）：重要な${what.ja}を示し、前週比の変化は示しません。Search Console のエクスポートは最大 1,000 行のため、すべての${what.ja}は含まれません。シェア = クリック数 ÷ ${site !== null ? `日次チャートのサイト全体クリック数（${fmtNum(site)}）` : `このエクスポートのクリック数（${fmtNum(total)}）`}。`,
    );
  };
  const distNote = (what: LText) => (u: GscUploadRef) =>
    e(`${periodText(u)} total, no dates: ${what.en} distribution, not week-on-week change.`, `${periodText(u)} の合計（日付なし）：${what.ja}別の分布で、前週比の変化ではありません。`);
  const pages = await snapshot(db, gscIds, 'gsc-page', 'page_url', tx('pages', 'ページ'), n, { bottom: true, denominator: siteClicks, note: capNote(tx('pages', 'ページ')) });
  const queries = await snapshot(db, gscIds, 'gsc-query', 'query', tx('queries', 'クエリ'), n, { bottom: true, note: capNote(tx('queries', 'クエリ')) });
  const devices = await snapshot(db, gscIds, 'gsc-device', 'device', tx('device', 'デバイス'), 10, { note: distNote(tx('device', 'デバイス')) });
  const countries = await snapshot(db, gscIds, 'gsc-country', 'country', tx('country', '国'), 10, { other: true, note: distNote(tx('country', '国')) });
  for (const s of [pages, queries, devices, countries]) ids.push(...s.ids);
  for (const r of [...queries.snap.top, ...queries.snap.bottom]) r.classification = isBrandQuery(cfg, r.key) ? e('brand', 'ブランド') : e('non-brand', '非ブランド');
  const brandClicks = queries.rows.filter((r) => isBrandQuery(cfg, r.key)).reduce((a, r) => a + r.clicks, 0);

  return {
    evidence: {
      dateChart,
      pages: pages.snap,
      queries: {
        ...queries.snap,
        brandShare: queries.snap.available && queries.snap.totalClicks ? pct1((brandClicks / queries.snap.totalClicks) * 100) : null,
        brandCaveat: cfg.brandTerms.confirmed ? null : e('Brand classification rule not supplied by the client — provisional term list.', 'ブランド分類ルールはクライアント未提供 — 暫定の語句リストです。'),
      },
      devices: devices.snap,
      countries: countries.snap,
      note: e(
        'Supporting evidence for M1 — not a separate measurement (Search Console has no OK / NG). Only Chart by Date is compared week on week; Pages, Queries, Devices and Countries are period totals that show where organic search traffic is concentrated.',
        'M1 の裏付け根拠です — 別の測定ではありません（Search Console に OK / NG はありません）。前週比で比較するのは日付別チャートのみで、ページ・クエリ・デバイス・国は期間合計として、オーガニック検索流入がどこに集中しているかを示します。',
      ),
    },
    dailyAligned,
    clicksDown,
    signals,
    importedDataIds: ids,
  };
}

/** Summary and possible indications for the measured weeks (SEO.txt meanings, direction only). */
function describe(clicksDown: boolean, signals: GscSignalKey[]) {
  const indications = signals.map((k) => SIGNAL_TO_INDICATION[k]);
  const list = (lang: 'en' | 'ja') => indications.map((i) => INDICATION_TEXT[i][lang]).join(lang === 'en' ? ' / ' : '・');
  return {
    summary: clicksDown
      ? e('Organic search performance decreased (Search Console clicks ↓).', 'オーガニック検索のパフォーマンスが低下しました（Search Console のクリック数 ↓）。')
      : e('Organic search clicks did not decrease — the GA4 organic decrease is not explained by Search Console.', 'オーガニック検索のクリック数は減少していません — GA4 のオーガニック流入の減少は Search Console では説明できません。'),
    indications,
    indicationText: indications.length ? e(`Possible indication: ${list('en')}.`, `考えられる兆候：${list('ja')}。`) : null,
  };
}

function compareDaily(clicks: DailySeries, impressions: DailySeries, position: DailySeries, periods: { current: Period; previous: Period }) {
  const c = { prev: sumPeriod(clicks, periods.previous), cur: sumPeriod(clicks, periods.current) };
  const i = { prev: sumPeriod(impressions, periods.previous), cur: sumPeriod(impressions, periods.current) };
  const p = { prev: weightedPeriod(position, impressions, periods.previous), cur: weightedPeriod(position, impressions, periods.current) };
  const complete = [c.prev, c.cur, i.prev, i.cur, p.prev, p.cur].every((x) => x.value !== null);
  const metrics: GscMetricChange[] = [];
  const signals: GscSignalKey[] = [];
  let clicksDown = false;
  const dir = (abs: number): GscMetricChange['direction'] => (abs < 0 ? 'down' : abs > 0 ? 'up' : 'same');
  const row = (metric: GscMetricChange['metric'], prev: number, cur: number, direction?: GscMetricChange['direction']) => {
    const ch = change(prev, cur);
    metrics.push({ metric, previous: round(prev, 4), current: round(cur, 4), change: round(ch.abs, 4), changeRate: ch.rate === null ? null : round(ch.rate, 2), direction: direction ?? dir(ch.abs) });
    return ch;
  };
  if (complete) {
    clicksDown = row('clicks', c.prev.value!, c.cur.value!).abs < 0;
    if (row('impressions', i.prev.value!, i.cur.value!).abs < 0) signals.push('searches');
    const ctrPrev = ratio(c.prev.value!, i.prev.value!);
    const ctrCur = ratio(c.cur.value!, i.cur.value!);
    if (ctrPrev !== null && ctrCur !== null && row('ctr', ctrPrev, ctrCur).abs < 0) signals.push('snippet');
    const pc = change(p.prev.value!, p.cur.value!);
    // A higher position number is worse.
    row('position', p.prev.value!, p.cur.value!, pc.abs > 0 ? 'worse' : pc.abs < 0 ? 'better' : 'same');
    if (pc.abs > 0) signals.unshift('ranking');
  }
  const ids = [c.prev, c.cur, i.prev, i.cur, p.prev, p.cur].flatMap((x) => x.refs.map((r) => r.importedDataId));
  return { complete, periods, metrics, signals, clicksDown, ids };
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
