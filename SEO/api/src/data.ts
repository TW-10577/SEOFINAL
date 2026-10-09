// Read models for the Data page. Everything is computed from imported_data (valid rows only).
import type { ComparisonRow, DataFilters, Ga4Overview, ImportedRow, Period, Series, Source, TopRow } from '@seo/shared';
import { scopeIds, scopeSql, type AppConfig } from './config.ts';
import type { DB } from './db.ts';
import { isBrandQuery } from './import/index.ts';
import { detectPeriods } from './periods.ts';
import { enc, tx } from './i18n.ts';
import { change, ratio } from './measure/logic.ts';
import { dailySeries, sumPeriod, weekPeriods, weightedPeriod } from './measure/series.ts';

type Row = Record<string, any>;

const SEARCH_DAILY = enc(tx('Search (daily chart)', '検索（日次チャート）'));

export async function dataFilters(db: DB, cfg: AppConfig): Promise<DataFilters> {
  const range = async (source: Source): Promise<Period | null> => {
    const sc = scopeSql(cfg, source);
    const r = (await db.get(`SELECT MIN(data_date) AS s, MAX(data_date) AS e FROM imported_data WHERE source = ? AND is_valid = 1 AND data_date IS NOT NULL${sc.sql}`, source, ...sc.args))!;
    return r.s ? { start: r.s, end: r.e } : null;
  };
  return {
    sources: await db.values<Source>(`SELECT DISTINCT source FROM imported_data ORDER BY source`),
    dateRange: { GA4: await range('GA4'), GSC: await range('GSC') },
    // Traffic source = a GA4 channel / segment; the site-total segment is not a traffic source.
    segments: await db.values<string>(
      `SELECT DISTINCT segment FROM imported_data WHERE source = 'GA4' AND segment IS NOT NULL AND segment != ?${scopeSql(cfg, 'GA4').sql} ORDER BY segment`,
      cfg.segments.total.value,
      ...scopeSql(cfg, 'GA4').args,
    ),
    metrics: await db.all<DataFilters['metrics'][number]>(`SELECT DISTINCT source, metric_name AS metric FROM imported_data WHERE is_valid = 1 ORDER BY source, metric_name`),
    pageSources: await db.values<Source>('SELECT DISTINCT source FROM imported_data WHERE page_url IS NOT NULL ORDER BY source'),
    querySources: await db.values<Source>('SELECT DISTINCT source FROM imported_data WHERE query IS NOT NULL ORDER BY source'),
  };
}

export interface DataQuery {
  source?: string;
  uploadId?: number;
  /** Active import context: only these uploads. */
  uploadIds?: number[];
  segment?: string;
  page?: string;
  query?: string;
  metric?: string;
  from?: string;
  to?: string;
  includeInvalid?: boolean;
  limit?: number;
  offset?: number;
}

export async function listData(db: DB, q: DataQuery): Promise<{ total: number; rows: ImportedRow[] }> {
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (sql: string, v: unknown) => (where.push(sql), args.push(v));
  if (q.source) add('source = ?', q.source);
  if (q.uploadId) add('upload_id = ?', q.uploadId);
  if (q.uploadIds?.length) (where.push(`upload_id IN (${q.uploadIds.map(() => '?').join(',')})`), args.push(...q.uploadIds));
  if (q.segment) add('segment = ?', q.segment);
  // ILIKE: case-insensitive "contains", as LIKE was in SQLite.
  if (q.page) add('page_url ILIKE ?', `%${q.page}%`);
  if (q.query) add('query ILIKE ?', `%${q.query}%`);
  if (q.metric) add('metric_name = ?', q.metric);
  if (q.from) add('COALESCE(data_date, period_end) >= ?', q.from);
  if (q.to) add('COALESCE(data_date, period_start) <= ?', q.to);
  if (!q.includeInvalid) where.push('is_valid = 1');
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await db.value<number>(`SELECT COUNT(*) FROM imported_data ${w}`, ...args))!;
  const rows = await db.all(`SELECT * FROM imported_data ${w} ORDER BY upload_id DESC, data_date NULLS FIRST, id LIMIT ? OFFSET ?`, ...args, Math.min(q.limit ?? 100, 1000), q.offset ?? 0);
  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      uploadId: r.upload_id,
      sourceRecordId: r.source_record_id,
      source: r.source,
      structure: r.structure,
      dataDate: r.data_date,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      pageUrl: r.page_url,
      query: r.query,
      segment: r.segment,
      trafficSource: r.traffic_source,
      device: r.device,
      country: r.country,
      searchAppearance: r.search_appearance,
      metricName: r.metric_name,
      sourceMetricName: r.source_metric_name,
      metricValue: r.metric_value,
      isValid: !!r.is_valid,
    })),
  };
}

export async function rawRecords(db: DB, uploadId: number, limit = 200, offset = 0) {
  const total = (await db.value<number>('SELECT COUNT(*) FROM raw_records WHERE upload_id = ?', uploadId))!;
  const rows = (await db.all('SELECT * FROM raw_records WHERE upload_id = ? ORDER BY id LIMIT ? OFFSET ?', uploadId, Math.min(limit, 1000), offset)).map((r) => ({
    id: r.id,
    rowNumber: r.row_number,
    table: r.table_name,
    status: r.status,
    values: JSON.parse(r.values_json),
    issues: JSON.parse(r.issues_json),
  }));
  return { total, rows };
}

// ---------- Export of one GSC file ----------

/**
 * Every valid source record of one Search Console table (e.g. gsc-page) of an upload, with all of its columns in
 * file order — the table of the dashboard's formatted Excel report. Plain numbers become numbers; everything else
 * (URLs, "5.75%") stays as exported. `search` keeps only rows whose dimension (first column: page, query, …)
 * contains it, case-insensitive — the same match as the Data page filter.
 */
export async function exportGscTable(db: DB, uploadId: number, table: string, search = '') {
  const u = await db.get<{ file_name: string; source: string | null }>('SELECT file_name, source FROM uploads WHERE id = ?', uploadId);
  if (!u) return { error: tx('Upload not found', 'アップロードが見つかりません'), status: 404 as const };
  if (u.source !== 'GSC' || !/^gsc-[a-z]+$/.test(table)) return { error: tx('Only Google Search Console data can be downloaded here.', 'ここでダウンロードできるのは Google Search Console のデータのみです。'), status: 400 as const };
  // Excel sheets are stored as "<structure> (<sheet>)".
  const records = await db.all<{ values_json: string }>(
    `SELECT values_json FROM raw_records WHERE upload_id = ? AND status = 'valid' AND (table_name = ? OR table_name LIKE ?) ORDER BY id`,
    uploadId, table, `${table} (%`,
  );
  if (!records.length) return { error: tx(`No valid ${table} rows in this upload.`, `このアップロードに有効な ${table} の行はありません。`), status: 404 as const };
  const needle = search.trim().toLowerCase();
  const rows = records
    .map((r) => JSON.parse(r.values_json) as Record<string, string>)
    .filter((r) => !needle || String(Object.values(r)[0] ?? '').toLowerCase().includes(needle));
  if (!rows.length) return { error: tx(`No ${table} rows match "${search.trim()}".`, `「${search.trim()}」に一致する ${table} の行はありません。`), status: 404 as const };
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const asValue = (v: string | undefined) => (v !== undefined && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v ?? '');
  return { fileName: u.file_name, table, columns, rows: rows.map((r) => columns.map((c) => asValue(r[c]))) };
}

// ---------- Period comparison ----------

export interface ComparisonResult {
  periods: Record<Source, { current: Period; previous: Period } | null>;
  rows: ComparisonRow[];
}

/**
 * Current week vs previous week per subject and metric. `currentEnd` applies to both sources;
 * without it each source uses its own latest week.
 */
/** Current vs previous week per source. Each source defaults to its newest valid period detected from the data. */
export async function comparison(db: DB, cfg: AppConfig, ends: { ga4End?: string; gscEnd?: string } = {}): Promise<ComparisonResult> {
  const rows: ComparisonRow[] = [];
  const periods: ComparisonResult['periods'] = { GA4: null, GSC: null };
  const push = (source: Source, subjectType: string, subjectKey: string, metric: string, prev: number | null, cur: number | null, note: string | null) => {
    const c = prev !== null && cur !== null ? change(prev, cur) : null;
    rows.push({ source, subjectType, subjectKey, metric, previous: prev, current: cur, absoluteChange: c?.abs ?? null, changeRate: c?.rate ?? null, note });
  };
  const gap = (a: { missingDates: string[]; syntheticDates?: string[] }, b: { missingDates: string[]; syntheticDates?: string[] }) => {
    const missing = a.missingDates.length + b.missingDates.length;
    const fake = (a.syntheticDates?.length ?? 0) + (b.syntheticDates?.length ?? 0);
    if (fake && cfg.dataPolicy.evaluateSyntheticData)
      return enc(tx(`Test data: ${fake} day(s) are marked as not real in the export`, `テストデータ：${fake} 日分はエクスポートで実データではないとされています`));
    if (!missing) return null;
    return fake
      ? enc(tx(`Incomplete: ${missing} day(s) missing (${fake} marked as not real data and excluded)`, `不完全：${missing} 日分が欠損（うち ${fake} 日分は実データではないため除外）`))
      : enc(tx(`Incomplete: ${missing} day(s) missing`, `不完全：${missing} 日分が欠損`));
  };

  // Only a complete detected period is compared; without one, nothing is compared (no made-up fallback weeks).
  const gaEnd = ends.ga4End ?? (await detectPeriods(db, cfg, 'GA4')).periods[0]?.current.end;
  if (gaEnd) {
    const p = (periods.GA4 = weekPeriods(gaEnd));
    const sc = scopeSql(cfg, 'GA4');
    const segs = await db.values<string>(`SELECT DISTINCT segment FROM imported_data WHERE source = 'GA4' AND is_valid = 1 AND data_date IS NOT NULL${sc.sql} ORDER BY segment`, ...sc.args);
    // ORDER BY metric_name: the order SQLite returned through its (source, metric_name, …) index.
    const metrics = await db.values<string>(`SELECT DISTINCT metric_name FROM imported_data WHERE source = 'GA4' AND is_valid = 1 AND data_date IS NOT NULL${sc.sql} ORDER BY metric_name`, ...sc.args);
    for (const seg of segs) {
      const role = Object.entries(cfg.segments).find(([, m]) => m.value === seg)?.[0];
      const type = role === 'total' ? 'site' : role ? 'traffic_source' : 'segment';
      const sums: Record<string, { prev: number | null; cur: number | null }> = {};
      for (const metric of metrics) {
        const s = await dailySeries(db, { source: 'GA4', segment: seg, metricName: metric, includeSynthetic: cfg.dataPolicy.evaluateSyntheticData, uploadIds: scopeIds(cfg, 'GA4') });
        if (!s.byDate.size) continue;
        const prev = sumPeriod(s, p.previous);
        const cur = sumPeriod(s, p.current);
        sums[metric] = { prev: prev.value, cur: cur.value };
        push('GA4', type, seg, metric, prev.value, cur.value, gap(prev, cur));
      }
      const cvKey = await cvMetricKey(db, cfg);
      const s = sums.sessions;
      const v = cvKey ? sums[cvKey] : undefined;
      if (s && v) {
        const pr = s.prev !== null && v.prev !== null ? ratio(v.prev, s.prev) : null;
        const cu = s.cur !== null && v.cur !== null ? ratio(v.cur, s.cur) : null;
        push('GA4', type, seg, 'cvr', pr, cu, cfg.metricNames.cv.confirmed ? null : enc(tx('CV column mapping unconfirmed', 'CV 列の対応は未確認')));
      }
    }
  }

  const gscEnd = ends.gscEnd ?? (await detectPeriods(db, cfg, 'GSC')).periods[0]?.current.end;
  if (gscEnd) {
    const p = (periods.GSC = weekPeriods(gscEnd));
    const sel = (metricName: string) => dailySeries(db, { source: 'GSC', structure: 'gsc-date', metricName, uploadIds: scopeIds(cfg, 'GSC') });
    const clicks = await sel('clicks');
    const impressions = await sel('impressions');
    if (clicks.byDate.size) {
      const c = { prev: sumPeriod(clicks, p.previous), cur: sumPeriod(clicks, p.current) };
      const i = { prev: sumPeriod(impressions, p.previous), cur: sumPeriod(impressions, p.current) };
      const position = await sel('position');
      const pos = { prev: weightedPeriod(position, impressions, p.previous), cur: weightedPeriod(position, impressions, p.current) };
      push('GSC', 'site', SEARCH_DAILY, 'clicks', c.prev.value, c.cur.value, gap(c.prev, c.cur));
      push('GSC', 'site', SEARCH_DAILY, 'impressions', i.prev.value, i.cur.value, gap(i.prev, i.cur));
      const ctr = (x: typeof c.prev, y: typeof i.prev) => (x.value !== null && y.value !== null ? ratio(x.value, y.value) : null);
      push('GSC', 'site', SEARCH_DAILY, 'ctr', ctr(c.prev, i.prev), ctr(c.cur, i.cur), gap(c.prev, c.cur));
      push('GSC', 'site', SEARCH_DAILY, 'position', pos.prev.value, pos.cur.value, gap(pos.prev, pos.cur) ?? enc(tx('Impression-weighted average of daily positions', '日次掲載順位の表示回数加重平均')));
    }
  }
  return { periods, rows };
}

/** Normalized metric key of the configured CV column (e.g. ecommerce_purchases). */
async function cvMetricKey(db: DB, cfg: AppConfig): Promise<string | null> {
  const names = cfg.metricNames.cv.value;
  return (
    (await db.value<string>(
      `SELECT metric_name FROM imported_data WHERE source = 'GA4' AND source_metric_name IN (${names.map(() => '?').join(',')}) ORDER BY metric_name, data_date NULLS FIRST, id LIMIT 1`,
      ...names,
    )) ?? null
  );
}

// ---------- Trends ----------

export async function trends(db: DB, cfg: AppConfig, source: Source, metric: string, segment?: string, period?: Partial<Period>): Promise<Series[]> {
  const inRange = (d: string) => (!period?.start || d >= period.start) && (!period?.end || d <= period.end);
  const toPoints = (m: Map<string, number>) => [...m].filter(([d]) => inRange(d)).sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
  if (source === 'GSC') {
    const sel = (m: string) => dailySeries(db, { source: 'GSC', structure: 'gsc-date', metricName: m, uploadIds: scopeIds(cfg, 'GSC') });
    let values = new Map<string, number>();
    if (metric === 'ctr') {
      const c = await sel('clicks');
      const i = await sel('impressions');
      for (const [d, v] of c.byDate) {
        const imp = i.byDate.get(d)?.value;
        if (imp) values.set(d, (v.value / imp) * 100);
      }
    } else values = new Map([...(await sel(metric)).byDate].map(([d, v]) => [d, v.value]));
    return values.size ? [{ key: metric, label: SEARCH_DAILY, points: toPoints(values) }] : [];
  }
  const segs = segment
    ? [segment]
    : await db.values<string>(`SELECT DISTINCT segment FROM imported_data WHERE source = 'GA4' AND is_valid = 1 AND data_date IS NOT NULL${scopeSql(cfg, 'GA4').sql} ORDER BY segment`, ...scopeSql(cfg, 'GA4').args);
  const ga4Ids = scopeIds(cfg, 'GA4');
  const out: Series[] = [];
  for (const seg of segs) {
    let values = new Map<string, number>();
    if (metric === 'cvr') {
      const s = await dailySeries(db, { source: 'GA4', segment: seg, sourceMetricNames: cfg.metricNames.sessions.value, includeSynthetic: cfg.dataPolicy.evaluateSyntheticData, uploadIds: ga4Ids });
      const c = await dailySeries(db, { source: 'GA4', segment: seg, sourceMetricNames: cfg.metricNames.cv.value, includeSynthetic: cfg.dataPolicy.evaluateSyntheticData, uploadIds: ga4Ids });
      for (const [d, v] of s.byDate) {
        const cv = c.byDate.get(d)?.value;
        if (cv !== undefined && v.value) values.set(d, (cv / v.value) * 100);
      }
    } else values = new Map([...(await dailySeries(db, { source: 'GA4', segment: seg, metricName: metric, includeSynthetic: cfg.dataPolicy.evaluateSyntheticData, uploadIds: ga4Ids })).byDate].map(([d, v]) => [d, v.value]));
    if (values.size) out.push({ key: seg, label: seg, points: toPoints(values) });
  }
  return out;
}

// ---------- Top rows of undated GSC tabs ----------

const DIM_COLUMN = { query: 'query', page: 'page_url', device: 'device', country: 'country', appearance: 'search_appearance' } as const;
export type Dimension = keyof typeof DIM_COLUMN;

/** Ranking of one Search Console tab: the given upload, or the latest upload of that tab. */
export async function topRows(db: DB, cfg: AppConfig, dim: Dimension, opts: { limit?: number; search?: string; uploadId?: number } = {}) {
  const col = DIM_COLUMN[dim];
  const upload = opts.uploadId
    ? await db.get(`SELECT id, file_name, analysis_period_start AS start, analysis_period_end AS end FROM uploads WHERE id = ? AND import_status = 'imported' AND structure LIKE ?`, opts.uploadId, `%gsc-${dim}%`)
    : await db.get(`SELECT id, file_name, analysis_period_start AS start, analysis_period_end AS end FROM uploads WHERE source = 'GSC' AND import_status = 'imported' AND structure = ?${scopeSql(cfg, 'GSC', 'id').sql} ORDER BY id DESC LIMIT 1`, `gsc-${dim}`, ...scopeSql(cfg, 'GSC', 'id').args);
  if (!upload) return { upload: null, siteClicks: null, rows: [] as TopRow[], total: 0 };
  const data = await db.all(`SELECT ${col} AS key, metric_name, metric_value FROM imported_data WHERE upload_id = ? AND is_valid = 1 AND ${col} IS NOT NULL ORDER BY id`, upload.id);
  const map = new Map<string, TopRow>();
  for (const d of data) {
    const r = map.get(d.key) ?? { key: d.key, clicks: 0, impressions: 0, ctr: null, position: null, share: null };
    if (d.metric_name in r) (r as any)[d.metric_name] = d.metric_value;
    map.set(d.key, r);
  }
  let rows = [...map.values()].sort((a, b) => b.clicks - a.clicks);
  const siteClicks =
    upload.start && upload.end ? sumPeriod(await dailySeries(db, { source: 'GSC', structure: 'gsc-date', metricName: 'clicks', uploadIds: scopeIds(cfg, 'GSC') }), { start: upload.start, end: upload.end }).value : null;
  const denom = siteClicks ?? rows.reduce((a, r) => a + r.clicks, 0);
  for (const r of rows) {
    r.share = denom ? (r.clicks / denom) * 100 : null;
    if (dim === 'query') r.classification = isBrandQuery(cfg, r.key) ? 'brand' : 'non-brand';
  }
  if (opts.search) rows = rows.filter((r) => r.key.toLowerCase().includes(opts.search!.toLowerCase()));
  return {
    upload: { id: upload.id, fileName: upload.file_name, period: upload.start ? { start: upload.start, end: upload.end } : null },
    siteClicks,
    total: rows.length,
    rows: rows.slice(0, opts.limit ?? 20),
  };
}


// ---------- GA4 dataset overview (Data page header, KPIs, dataset health) ----------

const dayList = (p: Period): string[] => {
  const out: string[] = [];
  for (let d = new Date(`${p.start}T00:00:00Z`); d <= new Date(`${p.end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
};

/** What GA4 data was uploaded, its totals over the dates present, and whether it is complete. Never OK / NG. */
export async function ga4Overview(db: DB, cfg: AppConfig): Promise<Ga4Overview> {
  const include = cfg.dataPolicy.evaluateSyntheticData;
  const uploads = (
    await db.all(`SELECT * FROM uploads WHERE source = 'GA4' AND import_status = 'imported'${scopeSql(cfg, 'GA4', 'id').sql} ORDER BY id`, ...scopeSql(cfg, 'GA4', 'id').args)
  ).map((u) => ({
    id: u.id,
    fileName: u.file_name,
    validationStatus: u.validation_status,
    rowCount: u.row_count,
    validRowCount: u.valid_row_count,
    period: u.analysis_period_start ? { start: u.analysis_period_start, end: u.analysis_period_end } : null,
    uploadedAt: u.uploaded_at,
  }));
  const seg = { total: cfg.segments.total.value, organic: cfg.segments.organic.value, advertising: cfg.segments.advertising.value };
  const sc = scopeSql(cfg, 'GA4');
  const all = await db.values<string>(`SELECT DISTINCT segment FROM imported_data WHERE source = 'GA4' AND is_valid = 1 AND data_date IS NOT NULL AND segment IS NOT NULL${sc.sql} ORDER BY segment`, ...sc.args);
  const series = (segment: string, names: string[]) => dailySeries(db, { source: 'GA4', segment, sourceMetricNames: names, includeSynthetic: include, uploadIds: scopeIds(cfg, 'GA4') });
  const sessions = await series(seg.total, cfg.metricNames.sessions.value);
  const purchases = await series(seg.total, cfg.metricNames.cv.value);
  const organic = await series(seg.organic, cfg.metricNames.sessions.value);
  const sum = (s: typeof sessions) => (s.byDate.size ? [...s.byDate.values()].reduce((a, v) => a + v.value, 0) : null);
  // CVR over the same dates: only days that have both sessions and purchases.
  const both = [...sessions.byDate.keys()].filter((d) => purchases.byDate.has(d));
  const sBoth = both.reduce((a, d) => a + sessions.byDate.get(d)!.value, 0);
  const pBoth = both.reduce((a, d) => a + purchases.byDate.get(d)!.value, 0);

  const dates = [...sessions.byDate.keys()].sort();
  const period = dates.length ? { start: dates[0]!, end: dates.at(-1)! } : null;
  const expected = period ? dayList(period) : [];
  const ids = uploads.map((u) => u.id);
  const inUploads = ids.length ? `upload_id IN (${ids.map(() => '?').join(',')})` : '1 = 0';
  const rawCount = async (status: string) => (await db.value<number>(`SELECT COUNT(*) FROM raw_records WHERE ${inUploads} AND status = ?`, ...ids, status))!;
  const dup = await db.values<string>(
    `SELECT data_date FROM imported_data WHERE source = 'GA4' AND is_valid = 1 AND data_date IS NOT NULL${sc.sql}
     GROUP BY segment, source_metric_name, data_date HAVING COUNT(*) > 1`,
    ...sc.args,
  );
  const fields = new Map<string, { segment: string; sourceMetric: string }>();
  for (const r of cfg.rules.filter((x) => x.source === 'GA4'))
    for (const f of cfg.specs[r.id]?.fields ?? []) fields.set(f.column, { segment: f.segment, sourceMetric: f.sourceMetric });
  const issues = (
    await db.all(`SELECT i.severity, i.message, u.file_name FROM upload_issues i JOIN uploads u ON u.id = i.upload_id WHERE u.source = 'GA4' AND u.import_status = 'imported'${scopeSql(cfg, 'GA4', 'u.id').sql} ORDER BY i.id`, ...scopeSql(cfg, 'GA4', 'u.id').args)
  ).map((i) => ({ severity: i.severity, message: i.message, fileName: i.file_name }));
  const requiredFields: Ga4Overview['health']['requiredFields'] = [];
  for (const [column, f] of fields) {
    const s = await series(f.segment, [f.sourceMetric]);
    requiredFields.push({ column, available: s.byDate.size > 0, days: s.byDate.size });
  }

  return {
    uploads,
    period,
    days: dates.length,
    records: (await db.value<number>(`SELECT COUNT(*) FROM imported_data WHERE source = 'GA4' AND is_valid = 1 AND data_date IS NOT NULL${sc.sql}`, ...sc.args))!,
    segments: { ...seg, all },
    purchasesMetric: await cvMetricKey(db, cfg),
    kpis: { sessions: sum(sessions), purchases: sum(purchases), organicSessions: sum(organic), cvr: both.length ? ratio(pBoth, sBoth) : null },
    health: {
      expectedDays: expected.length,
      missingDates: expected.filter((d) => !sessions.byDate.has(d)),
      duplicateDates: [...new Set(dup)].sort(),
      duplicateRows: await rawCount('duplicate'),
      invalidRows: await rawCount('invalid'),
      totalsRows: await rawCount('total'),
      syntheticDates: [...sessions.synthetic].sort(),
      syntheticIncluded: include,
      requiredFields,
      issues,
    },
  };
}
