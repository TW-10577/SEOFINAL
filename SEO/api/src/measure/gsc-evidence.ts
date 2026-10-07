// GSC as supporting evidence for Rule ① when organic traffic decreases (SEO.txt).
// GSC never produces its own measurement or anomaly.
//   Query / page tabs: 3-month totals, no WoW → show which keywords / pages bring traffic.
//   Daily chart: compared for the measured weeks only when it covers them; client meanings:
//     position worse = ranking dropped, impressions ↓ = fewer searches, CTR ↓ = title/snippet problem.
import type { EvidenceItem, EvidenceTable, Period } from '@seo/shared';
import type { AppConfig } from '../config.ts';
import type { DB } from '../db.ts';
import { enc, tx, type LText } from '../i18n.ts';
import { isBrandQuery } from '../import/index.ts';
import { change, fmtNum, fmtPct, ratio } from './logic.ts';
import { dailySeries, sumPeriod, weightedPeriod, weekPeriods, type DailySeries } from './series.ts';

export interface GscEvidence {
  items: EvidenceItem[];
  tables: EvidenceTable[];
  /** Client-defined observations for the measured weeks; empty when the daily chart does not cover them. */
  observations: LText[];
  dailyAligned: boolean;
  importedDataIds: number[];
}

interface TopRow {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
  ids: number[];
}

function latestUpload(db: DB, structure: string): { id: number; file_name: string; start: string | null; end: string | null } | undefined {
  return db
    .prepare(
      `SELECT id, file_name, analysis_period_start AS start, analysis_period_end AS end FROM uploads
       WHERE source = 'GSC' AND import_status = 'imported' AND structure = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(structure) as any;
}

function topRows(db: DB, uploadId: number, column: 'query' | 'page_url'): { rows: TopRow[]; totalClicks: number } {
  const data = db
    .prepare(`SELECT id, ${column} AS key, metric_name, metric_value FROM imported_data WHERE upload_id = ? AND is_valid = 1 AND ${column} IS NOT NULL`)
    .all(uploadId) as { id: number; key: string; metric_name: string; metric_value: number }[];
  const map = new Map<string, TopRow>();
  for (const d of data) {
    const r = map.get(d.key) ?? { key: d.key, clicks: 0, impressions: 0, ctr: null, position: null, ids: [] };
    if (d.metric_name === 'clicks') r.clicks = d.metric_value;
    if (d.metric_name === 'impressions') r.impressions = d.metric_value;
    if (d.metric_name === 'ctr') r.ctr = d.metric_value;
    if (d.metric_name === 'position') r.position = d.metric_value;
    r.ids.push(d.id);
    map.set(d.key, r);
  }
  const rows = [...map.values()].sort((a, b) => b.clicks - a.clicks);
  return { rows, totalClicks: rows.reduce((a, r) => a + r.clicks, 0) };
}

function siteClicksOver(db: DB, p: Period): number | null {
  return sumPeriod(dailySeries(db, { source: 'GSC', structure: 'gsc-date', metricName: 'clicks' }), p).value;
}

const e = (en: string, ja: string) => enc(tx(en, ja));
const COL = {
  clicks: e('Clicks', 'クリック数'),
  impressions: e('Impressions', '表示回数'),
  ctr: 'CTR',
  position: e('Position', '掲載順位'),
};
const BRAND = e('brand', 'ブランド');
const NON_BRAND = e('non-brand', '非ブランド');

export function buildGscEvidence(db: DB, cfg: AppConfig, measured: { current: Period; previous: Period }): GscEvidence {
  const items: EvidenceItem[] = [];
  const tables: EvidenceTable[] = [];
  const observations: LText[] = [];
  const ids: number[] = [];
  const n = cfg.evidenceRows;

  // ---- Query tab ----
  const qUp = latestUpload(db, 'gsc-query');
  if (!qUp) items.push({ label: e('GSC queries', 'GSC クエリ'), value: e('No GSC query export uploaded.', 'GSC クエリのエクスポートがアップロードされていません。') });
  else {
    const { rows, totalClicks } = topRows(db, qUp.id, 'query');
    const brandClicks = rows.filter((r) => isBrandQuery(cfg, r.key)).reduce((a, r) => a + r.clicks, 0);
    const brandShare = totalClicks ? (brandClicks / totalClicks) * 100 : null;
    const share = brandShare === null ? '—' : `${brandShare.toFixed(1)}%`;
    items.push({
      label: e('Brand share of query clicks', 'クエリのクリック数に占めるブランドの割合'),
      value: e(
        `${share} (${fmnum(brandClicks)} of ${fmnum(totalClicks)} clicks in upload #${qUp.id})`,
        `${share}（アップロード #${qUp.id} のクリック数 ${fmnum(totalClicks)} 中 ${fmnum(brandClicks)}）`,
      ),
      caveat: cfg.brandTerms.confirmed ? undefined : e('Brand classification rule not supplied by the client — provisional term list.', 'ブランド分類ルールはクライアント未提供 — 暫定の語句リストです。'),
    });
    tables.push({
      title: e(`GSC queries — top ${n} by clicks (upload #${qUp.id} ${qUp.file_name})`, `GSC クエリ — クリック数上位 ${n}（アップロード #${qUp.id} ${qUp.file_name}）`),
      note: e(
        `Period ${qUp.start ?? '?'} – ${qUp.end ?? '?'} total. No WoW dimension: shows which keywords bring traffic, not which keywords changed.`,
        `期間 ${qUp.start ?? '?'} – ${qUp.end ?? '?'} の合計。前週比の次元がないため、流入をもたらすキーワードは分かりますが、変化したキーワードは分かりません。`,
      ),
      columns: [e('Query', 'クエリ'), e('Classification', '分類'), COL.clicks, COL.impressions, COL.ctr, COL.position],
      rows: rows.slice(0, n).map((r) => [r.key, isBrandQuery(cfg, r.key) ? BRAND : NON_BRAND, r.clicks, r.impressions, pct(r.ctr), r.position]),
    });
    ids.push(...rows.slice(0, n).flatMap((r) => r.ids));
  }

  // ---- Page tab ----
  const pUp = latestUpload(db, 'gsc-page');
  if (!pUp) items.push({ label: e('GSC pages', 'GSC ページ'), value: e('No GSC page export uploaded.', 'GSC ページのエクスポートがアップロードされていません。') });
  else {
    const { rows, totalClicks } = topRows(db, pUp.id, 'page_url');
    const site = pUp.start && pUp.end ? siteClicksOver(db, { start: pUp.start, end: pUp.end }) : null;
    const denom = site ?? totalClicks;
    const denomNote =
      site !== null
        ? tx(`site total clicks from the GSC daily chart for the same period (${fmnum(site)})`, `同期間の GSC 日次チャートのサイト全体クリック数（${fmnum(site)}）`)
        : tx(`sum of clicks in the page export (${fmnum(totalClicks)}) — the daily chart does not cover the same period`, `ページエクスポートのクリック数合計（${fmnum(totalClicks)}）— 日次チャートが同期間をカバーしていません`);
    tables.push({
      title: e(`GSC pages — top ${n} by clicks (upload #${pUp.id} ${pUp.file_name})`, `GSC ページ — クリック数上位 ${n}（アップロード #${pUp.id} ${pUp.file_name}）`),
      note: e(
        `Period ${pUp.start ?? '?'} – ${pUp.end ?? '?'} total. No WoW dimension. Share = page clicks ÷ ${denomNote.en}.`,
        `期間 ${pUp.start ?? '?'} – ${pUp.end ?? '?'} の合計。前週比の次元なし。シェア = ページのクリック数 ÷ ${denomNote.ja}。`,
      ),
      columns: [e('Page', 'ページ'), COL.clicks, e('Share', 'シェア'), COL.impressions, COL.ctr, COL.position],
      rows: rows.slice(0, n).map((r) => [r.key, r.clicks, denom ? `${((r.clicks / denom) * 100).toFixed(1)}%` : '—', r.impressions, pct(r.ctr), r.position]),
    });
    ids.push(...rows.slice(0, n).flatMap((r) => r.ids));
  }

  // ---- Daily chart ----
  const sel = (metricName: string) => dailySeries(db, { source: 'GSC', structure: 'gsc-date', metricName });
  const clicks = sel('clicks');
  const impressions = sel('impressions');
  const position = sel('position');
  const dailyLabel = e('GSC daily chart', 'GSC 日次チャート');
  if (!clicks.byDate.size) {
    items.push({ label: dailyLabel, value: e('No GSC daily chart uploaded.', 'GSC 日次チャートがアップロードされていません。') });
    return { items, tables, observations, dailyAligned: false, importedDataIds: ids };
  }
  const meanings = e(
    'Client meanings: Position worse = ranking dropped; Impressions ↓ = fewer searches; CTR ↓ = title/snippet problem.',
    'クライアント定義：掲載順位の悪化 = 順位低下、表示回数 ↓ = 検索数の減少、CTR ↓ = タイトル/スニペットの問題。',
  );
  const daily = compareDaily(clicks, impressions, position, measured);
  if (daily.complete) {
    observations.push(...daily.observations);
    tables.push({ ...daily.table, title: e('GSC daily chart — same weeks as the measurement', 'GSC 日次チャート — 測定と同じ週'), note: meanings });
    ids.push(...daily.ids);
    items.push({
      label: dailyLabel,
      value: daily.observations.length
        ? e(daily.observations.map((o) => o.en).join('; '), daily.observations.map((o) => o.ja).join('、'))
        : e('No decrease in position, impressions or CTR for the measured weeks.', '測定週では掲載順位・表示回数・CTR の悪化はありません。'),
    });
  } else {
    const dates = [...clicks.byDate.keys()].sort();
    const last = dates[dates.length - 1]!;
    items.push({
      label: dailyLabel,
      value: e(`Not available for the measured weeks — the uploaded chart covers ${dates[0]} to ${last}.`, `測定週のデータはありません — アップロード済みのチャートは ${dates[0]} から ${last} までです。`),
      caveat: e('GSC dates are Pacific Time; GA4 dates are the property time zone.', 'GSC の日付は太平洋時間、GA4 の日付はプロパティのタイムゾーンです。'),
    });
    const ref = compareDaily(clicks, impressions, position, weekPeriods(last));
    if (ref.complete)
      tables.push({
        ...ref.table,
        title: e(
          `Reference only — GSC daily chart, latest available weeks (${ref.periods.previous.start} – ${ref.periods.current.end})`,
          `参考のみ — GSC 日次チャートの直近の週（${ref.periods.previous.start} – ${ref.periods.current.end}）`,
        ),
        note: e('These weeks differ from the measured GA4 weeks, so they are not used in the cause hypothesis.', '測定した GA4 の週と異なるため、原因仮説には使用しません。'),
      });
  }
  return { items, tables, observations, dailyAligned: daily.complete, importedDataIds: ids };
}

function compareDaily(clicks: DailySeries, impressions: DailySeries, position: DailySeries, periods: { current: Period; previous: Period }) {
  const c = { prev: sumPeriod(clicks, periods.previous), cur: sumPeriod(clicks, periods.current) };
  const i = { prev: sumPeriod(impressions, periods.previous), cur: sumPeriod(impressions, periods.current) };
  const p = { prev: weightedPeriod(position, impressions, periods.previous), cur: weightedPeriod(position, impressions, periods.current) };
  const complete = [c.prev, c.cur, i.prev, i.cur, p.prev, p.cur].every((x) => x.value !== null);
  const observations: LText[] = [];
  const rows: (string | number | null)[][] = [];
  if (complete) {
    const cc = change(c.prev.value!, c.cur.value!);
    const ic = change(i.prev.value!, i.cur.value!);
    const ctrPrev = ratio(c.prev.value!, i.prev.value!);
    const ctrCur = ratio(c.cur.value!, i.cur.value!);
    const pc = change(p.prev.value!, p.cur.value!);
    rows.push([COL.clicks, c.prev.value, c.cur.value, cc.abs, fmtPct(cc.rate)]);
    rows.push([COL.impressions, i.prev.value, i.cur.value, ic.abs, fmtPct(ic.rate)]);
    if (ctrPrev !== null && ctrCur !== null) {
      const tc = change(ctrPrev, ctrCur);
      rows.push(['CTR (%)', round(ctrPrev, 2), round(ctrCur, 2), round(tc.abs, 2), fmtPct(tc.rate)]);
      if (tc.abs < 0)
        observations.push(
          tx(
            `CTR decreased ${ctrPrev.toFixed(2)}% → ${ctrCur.toFixed(2)}% (client meaning: title/snippet problem)`,
            `CTR が低下 ${ctrPrev.toFixed(2)}% → ${ctrCur.toFixed(2)}%（クライアント定義：タイトル/スニペットの問題）`,
          ),
        );
    }
    rows.push([e('Avg. position', '平均掲載順位'), round(pc.previous, 2), round(pc.current, 2), round(pc.abs, 2), fmtPct(pc.rate)]);
    if (pc.abs > 0)
      observations.push(
        tx(
          `Position worse ${pc.previous.toFixed(2)} → ${pc.current.toFixed(2)} (client meaning: ranking dropped)`,
          `掲載順位が悪化 ${pc.previous.toFixed(2)} → ${pc.current.toFixed(2)}（クライアント定義：順位低下）`,
        ),
      );
    if (ic.abs < 0)
      observations.push(tx(`Impressions decreased ${fmtPct(ic.rate)} (client meaning: fewer searches)`, `表示回数が減少 ${fmtPct(ic.rate)}（クライアント定義：検索数の減少）`));
  }
  const ids = [c.prev, c.cur, i.prev, i.cur, p.prev, p.cur].flatMap((x) => x.refs.map((r) => r.importedDataId));
  return {
    complete,
    periods,
    observations,
    ids,
    table: {
      title: '',
      columns: [
        e('Metric', '指標'),
        e(`Previous ${periods.previous.start}–${periods.previous.end}`, `前期 ${periods.previous.start}–${periods.previous.end}`),
        e(`Current ${periods.current.start}–${periods.current.end}`, `今期 ${periods.current.start}–${periods.current.end}`),
        e('Change', '変化'),
        e('Change rate', '変化率'),
      ],
      rows,
    } as EvidenceTable,
  };
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const pct = (v: number | null) => (v === null ? null : `${v}%`);
const fmnum = (v: number) => fmtNum(v);
