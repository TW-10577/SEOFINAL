// Analysis periods detected from the uploaded data — no manual dates.
// Rule (week on week): the current period is 7 consecutive days ending on a date that has data, the
// previous period is the 7 days before it, and a period is valid only when all 14 days have data.
// Candidates step back one week at a time from the latest date, so periods do not overlap; a separate block of
// dates (e.g. another month's file) that gets no such week steps back from its own last date.
// Dates the export marks as not real are not data (rules.yaml data_policy).
import type { Period, Source } from '@seo/shared';
import { scopeIds, type AppConfig } from './config.ts';
import type { DB } from './db.ts';
import { addDays } from './import/ga4.ts';
import { dailySeries, weekPeriods } from './measure/series.ts';

export interface WeekPeriod {
  current: Period;
  previous: Period;
}

export interface SourcePeriods {
  /** Dates with data for this source. */
  range: Period | null;
  /** Valid week-on-week periods, newest first. */
  periods: WeekPeriod[];
  /** Dates the export marks as not real; excluded unless test data is included. */
  synthetic: string[];
}

/** Dates the analysis of each source runs on: GA4 total-segment sessions; GSC daily chart clicks. */
async function datesOf(db: DB, cfg: AppConfig, source: Source): Promise<{ dates: Set<string>; synthetic: string[] }> {
  const series = await (source === 'GA4'
      ? dailySeries(db, { source: 'GA4', segment: cfg.segments.total.value, sourceMetricNames: cfg.metricNames.sessions.value, includeSynthetic: cfg.dataPolicy.evaluateSyntheticData, uploadIds: scopeIds(cfg, 'GA4') })
      : dailySeries(db, { source: 'GSC', structure: 'gsc-date', metricName: 'clicks', uploadIds: scopeIds(cfg, 'GSC') }));
  return { dates: new Set(series.byDate.keys()), synthetic: [...series.synthetic].sort() };
}

/** The config with test data (dates the export marks as not real) included or left out for one request; undefined keeps rules.yaml. */
export function withTestData(cfg: AppConfig, include: boolean | undefined): AppConfig {
  return include === undefined ? cfg : { ...cfg, dataPolicy: { ...cfg.dataPolicy, evaluateSyntheticData: include } };
}

/**
 * The config limited to the active import context (upload ids) for one request. Each source is limited only when
 * the context holds uploads of that source. Empty or undefined ids = all data.
 */
export async function withScope(db: DB, cfg: AppConfig, uploadIds: number[] | undefined): Promise<AppConfig> {
  if (!uploadIds?.length) return cfg;
  const ids = [...new Set(uploadIds)].sort((a, b) => a - b);
  const rows = await db.all<{ id: number; source: string | null }>(`SELECT id, source FROM uploads WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  const of = (s: string) => rows.filter((r) => r.source === s).map((r) => r.id);
  const ga4 = of('GA4');
  const gsc = of('GSC');
  return { ...cfg, scope: { uploadIds: ids, GA4: ga4.length ? ga4 : undefined, GSC: gsc.length ? gsc : undefined } };
}

/** "3,5,8" → [3, 5, 8]; anything else → undefined. */
export const uploadIdsParam = (v: string | undefined): number[] | undefined => {
  const ids = (v ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return ids.length ? ids : undefined;
};

/** Query value "1" / "0" → include / leave out; absent → the rules.yaml default. */
export const testDataParam = (v: string | undefined): boolean | undefined => (v === '1' ? true : v === '0' ? false : undefined);

export async function detectPeriods(db: DB, cfg: AppConfig, source: Source): Promise<SourcePeriods> {
  const { dates, synthetic } = await datesOf(db, cfg, source);
  if (!dates.size) return { range: null, periods: [], synthetic };
  const sorted = [...dates].sort();
  const range = { start: sorted[0]!, end: sorted.at(-1)! };
  const complete = (p: WeekPeriod) => {
    for (let d = p.previous.start; d <= p.current.end; d = addDays(d, 1)) if (!dates.has(d)) return false;
    return true;
  };
  // Weeks aligned to the newest date (same weekday across the data).
  const periods: WeekPeriod[] = [];
  for (let end = range.end; addDays(end, -13) >= range.start; end = addDays(end, -7)) {
    const p = weekPeriods(end);
    if (complete(p)) periods.push(p);
  }
  // A separate block of dates (e.g. another month's file) that gets no aligned week offers its own weeks,
  // stepping back from its own last date — so every uploaded file can be analysed on its own period.
  const blocks: Period[] = [];
  for (const d of sorted) {
    const last = blocks.at(-1);
    if (last && addDays(last.end, 1) === d) last.end = d;
    else blocks.push({ start: d, end: d });
  }
  for (const b of blocks) {
    if (periods.some((p) => p.previous.start >= b.start && p.current.end <= b.end)) continue;
    for (let end = b.end; addDays(end, -13) >= b.start; end = addDays(end, -7)) periods.push(weekPeriods(end));
  }
  periods.sort((x, y) => y.current.end.localeCompare(x.current.end));
  return { range, periods, synthetic };
}

export async function detectAllPeriods(db: DB, cfg: AppConfig): Promise<Record<Source, SourcePeriods>> {
  return { GA4: await detectPeriods(db, cfg, 'GA4'), GSC: await detectPeriods(db, cfg, 'GSC') };
}

/** End of the newest valid period, or — when no complete period exists — the latest date (results are then NOT_EVALUABLE). */
export async function defaultCurrentEnd(db: DB, cfg: AppConfig, source: Source): Promise<string | null> {
  const p = await detectPeriods(db, cfg, source);
  return p.periods[0]?.current.end ?? p.range?.end ?? null;
}
