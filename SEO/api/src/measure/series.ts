// Reads daily values from imported_data and aggregates them per period.
import type { Issue, Period } from '@seo/shared';
import type { DB } from '../db.ts';
import { enc, tx, type LText } from '../i18n.ts';
import { addDays } from '../import/ga4.ts';
import { isSynthetic, syntheticMarks } from '../import/synthetic.ts';

export interface DailyValue {
  date: string;
  value: number;
  importedDataId: number;
  uploadId: number;
}

export interface DailySeries {
  byDate: Map<string, DailyValue>;
  /** Dates present in more than one upload (the latest upload is used). */
  overlaps: { date: string; uploads: number[] }[];
  /** Dates whose value the export marks as not real; excluded from byDate unless includeSynthetic. */
  synthetic: Set<string>;
  includesSynthetic: boolean;
}

export interface Selector {
  source: 'GA4' | 'GSC';
  structure?: string;
  segment?: string;
  /** Matches imported_data.source_metric_name (exported header) … */
  sourceMetricNames?: string[];
  /** … or imported_data.metric_name (normalized key). */
  metricName?: string;
  /** Keep values the export marks as not real (test mode, rules.yaml data_policy). Default: excluded. */
  includeSynthetic?: boolean;
  /** Only these uploads (the active import context); undefined = all uploads. */
  uploadIds?: number[];
}

/** Valid daily values; when several uploads cover a date, the most recent upload wins. */
export async function dailySeries(db: DB, sel: Selector): Promise<DailySeries> {
  const where = ['source = ?', 'is_valid = 1', 'data_date IS NOT NULL'];
  const args: unknown[] = [sel.source];
  if (sel.structure) (where.push('structure = ?'), args.push(sel.structure));
  if (sel.segment) (where.push('segment = ?'), args.push(sel.segment));
  if (sel.sourceMetricNames) {
    where.push(`source_metric_name IN (${sel.sourceMetricNames.map(() => '?').join(',')})`);
    args.push(...sel.sourceMetricNames);
  }
  if (sel.metricName) (where.push('metric_name = ?'), args.push(sel.metricName));
  if (sel.uploadIds) (where.push(`upload_id IN (${sel.uploadIds.map(() => '?').join(',') || 'NULL'})`), args.push(...sel.uploadIds));
  const rows = await db.all<{ id: number; upload_id: number; data_date: string; metric_value: number }>(
    `SELECT id, upload_id, data_date, metric_value FROM imported_data WHERE ${where.join(' AND ')} ORDER BY upload_id, id`,
    ...args,
  );
  const byDate = new Map<string, DailyValue>();
  const seen = new Map<string, Set<number>>();
  const marks = await syntheticMarks(db);
  const synthetic = new Set<string>();
  for (const r of rows) {
    if (isSynthetic(marks.get(r.upload_id), r.data_date)) {
      synthetic.add(r.data_date);
      if (!sel.includeSynthetic) continue;
    }
    byDate.set(r.data_date, { date: r.data_date, value: r.metric_value, importedDataId: r.id, uploadId: r.upload_id });
    (seen.get(r.data_date) ?? seen.set(r.data_date, new Set()).get(r.data_date)!).add(r.upload_id);
  }
  const overlaps = [...seen].filter(([, u]) => u.size > 1).map(([date, u]) => ({ date, uploads: [...u] }));
  // A date counts as synthetic only when the value actually used is synthetic.
  for (const d of [...synthetic]) {
    const v = byDate.get(d);
    if (v && !isSynthetic(marks.get(v.uploadId), d)) synthetic.delete(d);
  }
  return { byDate, overlaps, synthetic, includesSynthetic: !!sel.includeSynthetic };
}

export interface PeriodSum {
  value: number | null;
  missingDates: string[];
  refs: DailyValue[];
  /** Dates in the period whose data the export marks as not real (excluded, or used in test mode). */
  syntheticDates: string[];
}

export function daysOf(p: Period): string[] {
  const out: string[] = [];
  for (let d = p.start; d <= p.end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Sum over the period. Null (with the missing dates) unless every day has a value. */
export function sumPeriod(s: DailySeries, p: Period): PeriodSum {
  const refs: DailyValue[] = [];
  const missingDates: string[] = [];
  for (const d of daysOf(p)) {
    const v = s.byDate.get(d);
    if (v) refs.push(v);
    else missingDates.push(d);
  }
  return { value: missingDates.length ? null : refs.reduce((a, r) => a + r.value, 0), missingDates, refs, syntheticDates: daysOf(p).filter((d) => s.synthetic.has(d)) };
}

/** Impression-weighted average of daily average positions. */
export function weightedPeriod(values: DailySeries, weights: DailySeries, p: Period): PeriodSum {
  const refs: DailyValue[] = [];
  const missingDates: string[] = [];
  let num = 0;
  let den = 0;
  for (const d of daysOf(p)) {
    const v = values.byDate.get(d);
    const w = weights.byDate.get(d);
    if (!v || !w) {
      missingDates.push(d);
      continue;
    }
    refs.push(v);
    num += v.value * w.value;
    den += w.value;
  }
  return { value: missingDates.length || den === 0 ? null : num / den, missingDates, refs, syntheticDates: daysOf(p).filter((d) => values.synthetic.has(d)) };
}

export function overlapIssues(label: LText, s: DailySeries): Issue[] {
  if (!s.overlaps.length) return [];
  const ex = s.overlaps[0]!;
  return [
    {
      severity: 'warning',
      code: 'overlapping-uploads',
      message: enc(
        tx(
          `${label.en}: ${s.overlaps.length} date(s) are in more than one upload (e.g. ${ex.date} in uploads ${ex.uploads.join(', ')}); the latest upload is used.`,
          `${label.ja}：${s.overlaps.length} 日分が複数のアップロードに含まれています（例：${ex.date} はアップロード ${ex.uploads.join('、')}）。最新のアップロードを使用します。`,
        ),
      ),
    },
  ];
}

export function describeMissing(dates: string[]): string {
  if (!dates.length) return '';
  return dates.length <= 3 ? dates.join(', ') : `${dates[0]} … ${dates[dates.length - 1]} (${dates.length} days)`;
}

/** WoW periods ending on `currentEnd`. */
export function weekPeriods(currentEnd: string): { current: Period; previous: Period } {
  return {
    current: { start: addDays(currentEnd, -6), end: currentEnd },
    previous: { start: addDays(currentEnd, -13), end: addDays(currentEnd, -7) },
  };
}
