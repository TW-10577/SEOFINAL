// Google Search Console data overview and the standalone GSC Performance Report.
// GSC has no client judgment rules (SEO.txt): nothing here is a measurement, an OK / NG result, an anomaly,
// a cause or a countermeasure. The report describes the uploaded GSC data and states what it cannot show.
// Dated data (the Chart by Date) may be compared between two periods; the query / page / country / device /
// search-appearance exports are whole-period totals without dates and are only ever shown as snapshots.
import type { GscOverview, GscReport, Period, ReportBlock, ReportDoc, TopRow } from '@seo/shared';
import { translateDataTerms } from '@seo/shared';
import { scopeIds, scopeSql, type AppConfig } from './config.ts';
import { topRows, type Dimension } from './data.ts';
import { nowIso, type DB } from './db.ts';
import { localize, type Lang } from './i18n.ts';
import { fmtNum, fmtPct, change, ratio } from './measure/logic.ts';
import { dailySeries, daysOf, sumPeriod, weekPeriods, weightedPeriod } from './measure/series.ts';
import { detectPeriods } from './periods.ts';

const DIMS: Dimension[] = ['query', 'page', 'country', 'device', 'appearance'];

const pctOf = (clicks: number | null, impressions: number | null) => (clicks !== null && impressions ? (clicks / impressions) * 100 : null);

export async function gscOverview(db: DB, cfg: AppConfig): Promise<GscOverview> {
  const sc = scopeSql(cfg, 'GSC', 'id');
  const uploads = (await db.all(`SELECT * FROM uploads WHERE source = 'GSC' AND import_status = 'imported'${sc.sql} ORDER BY id`, ...sc.args)).map((u) => ({
    id: u.id as number,
    fileName: u.file_name as string,
    structure: (u.structure ?? null) as string | null,
    period: u.analysis_period_start ? { start: u.analysis_period_start as string, end: u.analysis_period_end as string } : null,
    validationStatus: u.validation_status as string,
    rowCount: u.row_count as number,
    validRowCount: u.valid_row_count as number,
  }));

  const ids = scopeIds(cfg, 'GSC');
  const sel = (metricName: string) => dailySeries(db, { source: 'GSC', structure: 'gsc-date', metricName, uploadIds: ids });
  const clicks = await sel('clicks');
  const impressions = await sel('impressions');
  const position = await sel('position');
  const dates = [...clicks.byDate.keys()].sort();
  const range = dates.length ? { start: dates[0]!, end: dates.at(-1)! } : null;
  const whole = range ?? { start: '', end: '' };
  const c = range ? sumPeriod(clicks, whole) : null;
  const i = range ? sumPeriod(impressions, whole) : null;
  const p = range ? weightedPeriod(position, impressions, whole) : null;
  const points = dates.map((date) => {
    const cl = clicks.byDate.get(date)!.value;
    const im = impressions.byDate.get(date)?.value ?? 0;
    return { date, clicks: cl, impressions: im, ctr: im ? (cl / im) * 100 : null, position: position.byDate.get(date)?.value ?? null };
  });

  // A period comparison exists only when the dated data holds two complete consecutive weeks.
  const periods = (await detectPeriods(db, cfg, 'GSC')).periods[0];
  let comparison: GscOverview['daily']['comparison'] = null;
  if (periods) {
    const w = weekPeriods(periods.current.end);
    const cc = { prev: sumPeriod(clicks, w.previous), cur: sumPeriod(clicks, w.current) };
    const ii = { prev: sumPeriod(impressions, w.previous), cur: sumPeriod(impressions, w.current) };
    const pp = { prev: weightedPeriod(position, impressions, w.previous), cur: weightedPeriod(position, impressions, w.current) };
    const ctr = (a: number | null, b: number | null) => (a !== null && b !== null ? ratio(a, b) : null);
    const row = (metric: string, previous: number | null, current: number | null) => {
      const ch = previous !== null && current !== null ? change(previous, current) : null;
      return { metric, previous, current, absoluteChange: ch?.abs ?? null, changeRate: ch?.rate ?? null };
    };
    comparison = {
      ...w,
      rows: [
        row('clicks', cc.prev.value, cc.cur.value),
        row('impressions', ii.prev.value, ii.cur.value),
        row('ctr', ctr(cc.prev.value, ii.prev.value), ctr(cc.cur.value, ii.cur.value)),
        row('position', pp.prev.value, pp.cur.value),
      ],
    };
  }

  const snapshots = {} as GscOverview['snapshots'];
  for (const dim of DIMS) {
    const t = await topRows(db, cfg, dim, { limit: 1 });
    snapshots[dim] = { available: !!t.upload, upload: t.upload, rows: t.total };
  }
  const isc = scopeSql(cfg, 'GSC', 'u.id');
  const warnings = (
    await db.all(
      `SELECT i.severity, i.code, i.message, u.file_name FROM upload_issues i JOIN uploads u ON u.id = i.upload_id WHERE u.source = 'GSC' AND u.import_status = 'imported'${isc.sql} ORDER BY i.id`,
      ...isc.args,
    )
  ).map((w) => ({ severity: w.severity as string, code: w.code as string, message: w.message as string, fileName: w.file_name as string }));

  return {
    uploads,
    daily: {
      available: dates.length > 0,
      range,
      days: dates.length,
      missingDates: range ? daysOf(range).filter((d) => !clicks.byDate.has(d)) : [],
      totals: { clicks: c?.value ?? null, impressions: i?.value ?? null, ctr: pctOf(c?.value ?? null, i?.value ?? null), position: p?.value ?? null },
      points,
      comparison,
    },
    snapshots,
    warnings,
  };
}

/** The standalone GSC Performance Report: a generated view of the stored GSC data (nothing is stored or judged). */
export async function generateGscReport(db: DB, cfg: AppConfig, lang: Lang, render: (doc: ReportDoc) => string): Promise<GscReport> {
  const doc = await buildGscReportDoc(db, cfg, lang);
  const generatedAt = nowIso();
  return { source: 'GSC', fileName: `LOGOS_GSC_Performance_Report_${generatedAt.slice(0, 10)}.txt`, generatedAt, content: render(doc), doc };
}

const DIM_TITLE: Record<Dimension, [string, string]> = {
  query: ['Search queries', '検索クエリ'],
  page: ['Pages', 'ページ'],
  country: ['Countries', '国'],
  device: ['Devices', 'デバイス'],
  appearance: ['Search appearance', '検索での見え方'],
};

export async function buildGscReportDoc(db: DB, cfg: AppConfig, lang: Lang = 'en'): Promise<ReportDoc> {
  const L = (en: string, ja: string) => (lang === 'ja' ? ja : en);
  const ov = localize(await gscOverview(db, cfg), lang);
  const doc: ReportDoc = { title: L('GSC Performance Report', 'GSC パフォーマンスレポート'), sections: [] };
  let cur: ReportBlock[] = [];
  const section = (en: string, ja: string) => {
    cur = [];
    doc.sections.push({ n: doc.sections.length + 1, title: L(en, ja), blocks: cur });
  };
  const add = (...b: ReportBlock[]) => cur.push(...b);
  const p = (text: string, tone?: 'muted' | 'warn'): ReportBlock => ({ t: 'p', text, tone });
  const d = ov.daily;
  const metricName: Record<string, string> = { clicks: L('Clicks', 'クリック数'), impressions: L('Impressions', '表示回数'), ctr: 'CTR (%)', position: L('Avg. position', '平均掲載順位') };
  const val = (m: string, v: number | null) => (v === null ? '—' : m === 'ctr' ? `${v.toFixed(2)}%` : m === 'position' ? v.toFixed(2) : fmtNum(v, 0));
  const span = (x: Period | null) => (x ? `${x.start} – ${x.end}` : L('unknown (no dates)', '不明（日付なし）'));

  if (!ov.uploads.length) {
    section('Data Coverage', 'データの範囲');
    add(p(L('No Search Console data has been uploaded yet. Upload Search Console performance exports on the Data Import page.', 'Search Console のデータがまだアップロードされていません。データインポートのページでアップロードしてください。'), 'warn'));
    return finish(doc, lang);
  }

  // ---- 1. Data coverage ----
  section('Analysis / Data Coverage', '分析 / データの範囲');
  const tables = DIMS.filter((x) => ov.snapshots[x].available);
  add({
    t: 'kv',
    rows: [
      [L('Data source', 'データソース'), 'Google Search Console'],
      [L('Dated data (Chart by Date)', '日付データ（日付別チャート）'), d.available ? `${span(d.range)} (${d.days} ${L('days', '日')})` : L('not uploaded', '未アップロード')],
      [L('Whole-period snapshots', '期間合計のスナップショット'), tables.length ? tables.map((x) => L(...DIM_TITLE[x])).join(', ') : L('none', 'なし')],
      [L('Files', 'ファイル'), ov.uploads.map((u) => u.fileName).join(', ')],
      [L('Generated', '生成日時'), `${nowIso().slice(0, 16).replace('T', ' ')} UTC`],
    ],
  });
  add(p(L('Search Console has no pass/fail judgment rules: this report only describes the uploaded data.', 'Search Console には合否の判定ルールがありません。このレポートはアップロードされたデータの説明のみを行います。'), 'muted'));

  // ---- 2. Overall performance ----
  section('Overall Search Performance', '検索パフォーマンス全体');
  if (d.available) {
    add({
      t: 'kv',
      rows: [
        [L('Period', '期間'), span(d.range)],
        ...(['clicks', 'impressions', 'ctr', 'position'] as const).map((m) => [metricName[m]!, val(m, d.totals[m])] as [string, string]),
      ],
    });
    add(p(L('CTR is clicks ÷ impressions; position is the impression-weighted average of the daily positions.', 'CTR はクリック数 ÷ 表示回数、掲載順位は日次の表示回数加重平均です。'), 'muted'));
  } else {
    // Without dated data: a device / country export is a complete period total; query / page exports are capped lists.
    const full = await snapshotTotals(db, cfg);
    if (full) {
      add({ t: 'kv', rows: [[L('Source', '出典'), `${full.label} — ${full.fileName}`], [L('Clicks', 'クリック数'), fmtNum(full.clicks, 0)], [L('Impressions', '表示回数'), fmtNum(full.impressions, 0)], ['CTR (%)', full.ctr === null ? '—' : `${full.ctr.toFixed(2)}%`]] });
      add(p(L('Whole-period snapshot with no dates; it is not a daily trend or a comparison.', '日付のない期間全体のスナップショットです。日次の推移や比較ではありません。'), 'muted'));
    } else add(p(L('Site-wide totals are not available: no Chart by Date or complete device / country export was uploaded.', 'サイト全体の合計は利用できません。日付別チャートも、完全なデバイス / 国のエクスポートもアップロードされていません。'), 'warn'));
  }

  // ---- 3. Daily trend ----
  section('Daily Trend', '日次の推移');
  if (!d.available) add(p(L('No dated chart (Chart by Date) was uploaded, so there is no daily trend and no period comparison.', '日付別チャートがアップロードされていないため、日次の推移も期間比較もありません。'), 'warn'));
  else {
    const best = d.points.reduce((a, b) => (b.clicks > a.clicks ? b : a));
    const worst = d.points.reduce((a, b) => (b.clicks < a.clicks ? b : a));
    add({
      t: 'kv',
      rows: [
        [L('Days with data', 'データのある日数'), String(d.days)],
        [L('Highest clicks day', 'クリック数が最大の日'), `${best.date} (${fmtNum(best.clicks, 0)})`],
        [L('Lowest clicks day', 'クリック数が最小の日'), `${worst.date} (${fmtNum(worst.clicks, 0)})`],
      ],
    });
    if (d.comparison)
      add({
        t: 'table',
        title: L(`Period comparison: ${span(d.comparison.current)} vs ${span(d.comparison.previous)}`, `期間比較：${span(d.comparison.current)} と ${span(d.comparison.previous)}`),
        columns: [L('Metric', '指標'), L('Previous', '前期'), L('Current', '今期'), L('Change', '変化')],
        rows: d.comparison.rows.map((r) => [metricName[r.metric]!, val(r.metric, r.previous), val(r.metric, r.current), r.changeRate === null ? '—' : r.metric === 'ctr' || r.metric === 'position' ? `${(r.absoluteChange ?? 0) > 0 ? '+' : ''}${(r.absoluteChange ?? 0).toFixed(2)}` : fmtPct(r.changeRate)]),
      });
    else add(p(L('The dated data does not hold two complete 7-day periods, so no period comparison is shown.', '日付データに完全な 7 日間の期間が 2 つないため、期間比較は表示しません。'), 'muted'));
  }

  // ---- 4. Queries and pages ----
  section('Key Query and Page Findings', '主要なクエリ・ページの所見');
  const tops: Partial<Record<Dimension, Awaited<ReturnType<typeof topRows>>>> = {};
  for (const dim of DIMS) if (ov.snapshots[dim].available) tops[dim] = localize(await topRows(db, cfg, dim, { limit: 8 }), lang);
  const topTable = (dim: Dimension, title: string) => {
    const r = tops[dim];
    if (!r?.upload) return;
    add({
      t: 'table',
      title: `${title} — ${L('top by clicks', 'クリック数の上位')}`,
      note: L(`Snapshot: ${r.upload.period ? `whole period ${span(r.upload.period)}, no dates` : 'whole period, no dates (period unknown)'} (${r.upload.fileName}). Not a week-on-week finding.`, `スナップショット：${r.upload.period ? `期間全体 ${span(r.upload.period)}、日付なし` : '期間全体、日付なし（期間不明）'}（${r.upload.fileName}）。前週比の所見ではありません。`),
      columns: [title, L('Clicks', 'クリック数'), L('Share', 'シェア'), L('Impressions', '表示回数'), 'CTR', L('Position', '掲載順位')],
      rows: r.rows.map((x: TopRow) => [x.key, fmtNum(x.clicks, 0), x.share === null ? '—' : `${x.share.toFixed(1)}%`, fmtNum(x.impressions, 0), x.ctr === null ? '—' : `${x.ctr}%`, x.position === null ? '—' : x.position.toFixed(2)]),
    });
  };
  topTable('query', L(...DIM_TITLE.query));
  topTable('page', L(...DIM_TITLE.page));
  if (!tops.query && !tops.page) add(p(L('No query or page export was uploaded.', 'クエリ・ページのエクスポートはアップロードされていません。'), 'muted'));
  else {
    // Opportunity: high impressions, low CTR — a factual observation from the snapshot, not a cause.
    const q = tops.query?.rows ?? [];
    const low = q.filter((x) => x.impressions > 0 && x.ctr !== null).sort((a, b) => b.impressions - a.impressions).slice(0, 3).filter((x) => x.ctr! < 2);
    if (low.length) add(p(L(`High-impression queries with a CTR below 2%: ${low.map((x) => `${x.key} (${x.ctr}%)`).join(', ')}.`, `表示回数が多く CTR が 2% 未満のクエリ：${low.map((x) => `${x.key}（${x.ctr}%）`).join('、')}。`)));
  }

  // ---- 5. Country / device / appearance ----
  section('Country, Device and Search Appearance', '国・デバイス・検索での見え方');
  for (const dim of ['country', 'device', 'appearance'] as const) topTable(dim, L(...DIM_TITLE[dim]));
  if (!tops.country && !tops.device && !tops.appearance) add(p(L('No country, device or search-appearance export was uploaded.', '国・デバイス・検索での見え方のエクスポートはアップロードされていません。'), 'muted'));
  else if (!tops.appearance) add(p(L('Search appearance data is not available in the uploaded files.', '検索での見え方のデータはアップロードされたファイルにありません。'), 'muted'));

  // ---- 6. Limitations and validation ----
  section('Data Limitations and Validation Warnings', 'データの制約と検証の警告');
  const limits: string[] = [];
  if (!d.available) limits.push(L('No dated chart: no daily trend and no period comparison.', '日付付きチャートなし：日次の推移も期間比較もできません。'));
  else if (!d.comparison) limits.push(L('Dated data is shorter than two complete weeks: no period comparison.', '日付データが完全な 2 週間に満たないため、期間比較はできません。'));
  if (d.missingDates.length) limits.push(L(`Chart by Date is missing ${d.missingDates.length} day(s) inside its range: ${d.missingDates.slice(0, 5).join(', ')}${d.missingDates.length > 5 ? '…' : ''}.`, `日付別チャートの範囲内に ${d.missingDates.length} 日分の欠損があります：${d.missingDates.slice(0, 5).join('、')}${d.missingDates.length > 5 ? '…' : ''}。`));
  if (tables.length) limits.push(L('Query, page, country, device and search-appearance exports are whole-period totals without dates: they are snapshots and cannot show weekly changes.', 'クエリ・ページ・国・デバイス・検索での見え方のエクスポートは日付のない期間合計です。スナップショットであり、週ごとの変化は示せません。'));
  limits.push(L('Search Console shows search performance only; it does not show why performance changed. No cause is stated here.', 'Search Console は検索パフォーマンスのみを示し、変化の理由は示しません。ここでは原因を述べません。'));
  add({ t: 'list', items: limits });
  if (ov.warnings.length) add({ t: 'table', title: L('Validation warnings', '検証の警告'), columns: [L('File', 'ファイル'), L('Level', 'レベル'), L('Message', 'メッセージ')], rows: ov.warnings.map((w) => [w.fileName, w.severity, w.message]) });
  else add(p(L('No validation warnings.', '検証の警告はありません。'), 'muted'));
  return finish(doc, lang);
}

/** Complete period total from a device / country / appearance export (these cover all traffic, unlike capped query / page lists). */
async function snapshotTotals(db: DB, cfg: AppConfig) {
  for (const dim of ['device', 'country', 'appearance'] as const) {
    const r = await topRows(db, cfg, dim, { limit: 1000 });
    if (!r.upload || !r.rows.length) continue;
    const clicks = r.rows.reduce((a, x) => a + x.clicks, 0);
    const impressions = r.rows.reduce((a, x) => a + x.impressions, 0);
    return { label: DIM_TITLE[dim][0], fileName: r.upload.fileName, clicks, impressions, ctr: pctOf(clicks, impressions) };
  }
  return null;
}

const mapStrings = <T,>(v: T, f: (s: string) => string): T => {
  if (typeof v === 'string') return f(v) as T;
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, f)) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 't' || k === 'status' ? x : mapStrings(x, f)])) as T;
  return v;
};
// English report: Japanese country / device names in English (queries and URLs are unchanged by the term map).
const finish = (doc: ReportDoc, lang: Lang) => (lang === 'en' ? mapStrings(doc, (x) => translateDataTerms(x, false)) : doc);
