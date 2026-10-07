// Read models for the Data page. Everything is computed from imported_data (valid rows only).
import type { ComparisonRow, DataFilters, ImportedRow, Period, Series, Source, TopRow } from '@seo/shared';
import type { AppConfig } from './config.ts';
import type { DB } from './db.ts';
import { isBrandQuery } from './import/index.ts';
import { enc, tx } from './i18n.ts';
import { change, ratio } from './measure/logic.ts';
import { dailySeries, sumPeriod, weekPeriods, weightedPeriod } from './measure/series.ts';

type Row = Record<string, any>;

const SEARCH_DAILY = enc(tx('Search (daily chart)', '検索（日次チャート）'));

export function dataFilters(db: DB): DataFilters {
  const range = (source: Source): Period | null => {
    const r = db.prepare('SELECT MIN(data_date) AS s, MAX(data_date) AS e FROM imported_data WHERE source = ? AND is_valid = 1 AND data_date IS NOT NULL').get(source) as Row;
    return r.s ? { start: r.s, end: r.e } : null;
  };
  return {
    sources: db.prepare(`SELECT DISTINCT source FROM imported_data ORDER BY source`).pluck().all() as Source[],
    dateRange: { GA4: range('GA4'), GSC: range('GSC') },
    segments: db.prepare(`SELECT DISTINCT segment FROM imported_data WHERE segment IS NOT NULL ORDER BY segment`).pluck().all() as string[],
    metrics: db.prepare(`SELECT DISTINCT source, metric_name AS metric FROM imported_data ORDER BY source, metric_name`).all() as DataFilters['metrics'],
    hasPages: !!db.prepare('SELECT 1 FROM imported_data WHERE page_url IS NOT NULL LIMIT 1').get(),
    hasQueries: !!db.prepare('SELECT 1 FROM imported_data WHERE query IS NOT NULL LIMIT 1').get(),
  };
}

export interface DataQuery {
  source?: string;
  uploadId?: number;
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

export function listData(db: DB, q: DataQuery): { total: number; rows: ImportedRow[] } {
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (sql: string, v: unknown) => (where.push(sql), args.push(v));
  if (q.source) add('source = ?', q.source);
  if (q.uploadId) add('upload_id = ?', q.uploadId);
  if (q.segment) add('segment = ?', q.segment);
  if (q.page) add('page_url LIKE ?', `%${q.page}%`);
  if (q.query) add('query LIKE ?', `%${q.query}%`);
  if (q.metric) add('metric_name = ?', q.metric);
  if (q.from) add('COALESCE(data_date, period_end) >= ?', q.from);
  if (q.to) add('COALESCE(data_date, period_start) <= ?', q.to);
  if (!q.includeInvalid) where.push('is_valid = 1');
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) FROM imported_data ${w}`).pluck().get(...args) as number;
  const rows = db
    .prepare(`SELECT * FROM imported_data ${w} ORDER BY upload_id DESC, data_date, id LIMIT ? OFFSET ?`)
    .all(...args, Math.min(q.limit ?? 100, 1000), q.offset ?? 0) as Row[];
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

export function rawRecords(db: DB, uploadId: number, limit = 200, offset = 0) {
  const total = db.prepare('SELECT COUNT(*) FROM raw_records WHERE upload_id = ?').pluck().get(uploadId) as number;
  const rows = (db.prepare('SELECT * FROM raw_records WHERE upload_id = ? ORDER BY id LIMIT ? OFFSET ?').all(uploadId, Math.min(limit, 1000), offset) as Row[]).map((r) => ({
    id: r.id,
    rowNumber: r.row_number,
    table: r.table_name,
    status: r.status,
    values: JSON.parse(r.values_json),
    issues: JSON.parse(r.issues_json),
  }));
  return { total, rows };
}

// ---------- Period comparison ----------

function latestDate(db: DB, source: Source): string | null {
  return db.prepare('SELECT MAX(data_date) FROM imported_data WHERE source = ? AND is_valid = 1 AND data_date IS NOT NULL').pluck().get(source) as string | null;
}

export interface ComparisonResult {
  periods: Record<Source, { current: Period; previous: Period } | null>;
  rows: ComparisonRow[];
}

/**
 * Current week vs previous week per subject and metric. `currentEnd` applies to both sources;
 * without it each source uses its own latest week.
 */
export function comparison(db: DB, cfg: AppConfig, currentEnd?: string): ComparisonResult {
  const rows: ComparisonRow[] = [];
  const periods: ComparisonResult['periods'] = { GA4: null, GSC: null };
  const push = (source: Source, subjectType: string, subjectKey: string, metric: string, prev: number | null, cur: number | null, note: string | null) => {
    const c = prev !== null && cur !== null ? change(prev, cur) : null;
    rows.push({ source, subjectType, subjectKey, metric, previous: prev, current: cur, absoluteChange: c?.abs ?? null, changeRate: c?.rate ?? null, note });
  };
  const gap = (a: { missingDates: string[] }, b: { missingDates: string[] }) =>
    a.missingDates.length || b.missingDates.length
      ? enc(tx(`Incomplete: ${a.missingDates.length + b.missingDates.length} day(s) missing`, `不完全：${a.missingDates.length + b.missingDates.length} 日分が欠損`))
      : null;

  const gaEnd = currentEnd ?? latestDate(db, 'GA4');
  if (gaEnd) {
    const p = (periods.GA4 = weekPeriods(gaEnd));
    const segs = db.prepare(`SELECT DISTINCT segment FROM imported_data WHERE source = 'GA4' AND is_valid = 1 AND data_date IS NOT NULL ORDER BY segment`).pluck().all() as string[];
    const metrics = db.prepare(`SELECT DISTINCT metric_name FROM imported_data WHERE source = 'GA4' AND is_valid = 1 AND data_date IS NOT NULL`).pluck().all() as string[];
    for (const seg of segs) {
      const role = Object.entries(cfg.segments).find(([, m]) => m.value === seg)?.[0];
      const type = role === 'total' ? 'site' : role ? 'traffic_source' : 'segment';
      const sums: Record<string, { prev: number | null; cur: number | null }> = {};
      for (const metric of metrics) {
        const s = dailySeries(db, { source: 'GA4', segment: seg, metricName: metric });
        if (!s.byDate.size) continue;
        const prev = sumPeriod(s, p.previous);
        const cur = sumPeriod(s, p.current);
        sums[metric] = { prev: prev.value, cur: cur.value };
        push('GA4', type, seg, metric, prev.value, cur.value, gap(prev, cur));
      }
      const cvKey = cvMetricKey(db, cfg);
      const s = sums.sessions;
      const v = cvKey ? sums[cvKey] : undefined;
      if (s && v) {
        const pr = s.prev !== null && v.prev !== null ? ratio(v.prev, s.prev) : null;
        const cu = s.cur !== null && v.cur !== null ? ratio(v.cur, s.cur) : null;
        push('GA4', type, seg, 'cvr', pr, cu, cfg.metricNames.cv.confirmed ? null : enc(tx('CV column mapping unconfirmed', 'CV 列の対応は未確認')));
      }
    }
  }

  const gscEnd = currentEnd ?? latestDate(db, 'GSC');
  if (gscEnd) {
    const p = (periods.GSC = weekPeriods(gscEnd));
    const sel = (metricName: string) => dailySeries(db, { source: 'GSC', structure: 'gsc-date', metricName });
    const clicks = sel('clicks');
    const impressions = sel('impressions');
    if (clicks.byDate.size) {
      const c = { prev: sumPeriod(clicks, p.previous), cur: sumPeriod(clicks, p.current) };
      const i = { prev: sumPeriod(impressions, p.previous), cur: sumPeriod(impressions, p.current) };
      const pos = { prev: weightedPeriod(sel('position'), impressions, p.previous), cur: weightedPeriod(sel('position'), impressions, p.current) };
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
function cvMetricKey(db: DB, cfg: AppConfig): string | null {
  const names = cfg.metricNames.cv.value;
  return (db.prepare(`SELECT metric_name FROM imported_data WHERE source = 'GA4' AND source_metric_name IN (${names.map(() => '?').join(',')}) LIMIT 1`).pluck().get(...names) as string | undefined) ?? null;
}

// ---------- Trends ----------

export function trends(db: DB, cfg: AppConfig, source: Source, metric: string, segment?: string, period?: Partial<Period>): Series[] {
  const inRange = (d: string) => (!period?.start || d >= period.start) && (!period?.end || d <= period.end);
  const toPoints = (m: Map<string, number>) => [...m].filter(([d]) => inRange(d)).sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
  if (source === 'GSC') {
    const sel = (m: string) => dailySeries(db, { source: 'GSC', structure: 'gsc-date', metricName: m });
    let values = new Map<string, number>();
    if (metric === 'ctr') {
      const c = sel('clicks');
      const i = sel('impressions');
      for (const [d, v] of c.byDate) {
        const imp = i.byDate.get(d)?.value;
        if (imp) values.set(d, (v.value / imp) * 100);
      }
    } else values = new Map([...sel(metric).byDate].map(([d, v]) => [d, v.value]));
    return values.size ? [{ key: metric, label: SEARCH_DAILY, points: toPoints(values) }] : [];
  }
  const segs = segment
    ? [segment]
    : (db.prepare(`SELECT DISTINCT segment FROM imported_data WHERE source = 'GA4' AND is_valid = 1 AND data_date IS NOT NULL ORDER BY segment`).pluck().all() as string[]);
  const out: Series[] = [];
  for (const seg of segs) {
    let values = new Map<string, number>();
    if (metric === 'cvr') {
      const s = dailySeries(db, { source: 'GA4', segment: seg, sourceMetricNames: cfg.metricNames.sessions.value });
      const c = dailySeries(db, { source: 'GA4', segment: seg, sourceMetricNames: cfg.metricNames.cv.value });
      for (const [d, v] of s.byDate) {
        const cv = c.byDate.get(d)?.value;
        if (cv !== undefined && v.value) values.set(d, (cv / v.value) * 100);
      }
    } else values = new Map([...dailySeries(db, { source: 'GA4', segment: seg, metricName: metric }).byDate].map(([d, v]) => [d, v.value]));
    if (values.size) out.push({ key: seg, label: seg, points: toPoints(values) });
  }
  return out;
}

// ---------- Top rows of undated GSC tabs ----------

const DIM_COLUMN = { query: 'query', page: 'page_url', device: 'device', country: 'country', appearance: 'search_appearance' } as const;
export type Dimension = keyof typeof DIM_COLUMN;

export function topRows(db: DB, cfg: AppConfig, dim: Dimension, opts: { limit?: number; search?: string } = {}) {
  const col = DIM_COLUMN[dim];
  const upload = db
    .prepare(`SELECT id, file_name, analysis_period_start AS start, analysis_period_end AS end FROM uploads WHERE source = 'GSC' AND import_status = 'imported' AND structure = ? ORDER BY id DESC LIMIT 1`)
    .get(`gsc-${dim}`) as Row | undefined;
  if (!upload) return { upload: null, siteClicks: null, rows: [] as TopRow[], total: 0 };
  const data = db.prepare(`SELECT ${col} AS key, metric_name, metric_value FROM imported_data WHERE upload_id = ? AND is_valid = 1 AND ${col} IS NOT NULL`).all(upload.id) as Row[];
  const map = new Map<string, TopRow>();
  for (const d of data) {
    const r = map.get(d.key) ?? { key: d.key, clicks: 0, impressions: 0, ctr: null, position: null, share: null };
    if (d.metric_name in r) (r as any)[d.metric_name] = d.metric_value;
    map.set(d.key, r);
  }
  let rows = [...map.values()].sort((a, b) => b.clicks - a.clicks);
  const siteClicks =
    upload.start && upload.end ? sumPeriod(dailySeries(db, { source: 'GSC', structure: 'gsc-date', metricName: 'clicks' }), { start: upload.start, end: upload.end }).value : null;
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

