// GA4 Explorations (free-form) export, as provided by the client:
//   # comment lines (property, report name, date range, notes)
//   セグメント | <segment> | <segment> ...      ← segment per column
//   日付 (or blank) | <metric> | <metric> ...    ← metric per column
//   総計 row (totals), then one row per date (yyyymmdd) — or a single row when there is no date column.
// Columns are identified by their two header cells, never by position.
import type { Issue, Period } from '@seo/shared';
import { isBlankRow, parseDate, parseNumber, type Grid } from './grid.ts';
import { enc, tx } from '../i18n.ts';
import type { Detection, NormalizedValue, ParsedRecord } from './types.ts';

const SEGMENT_HEADERS = ['セグメント', 'segment'];
const DATE_HEADERS = ['日付', 'date'];
const TOTAL_LABELS = ['総計', 'total', 'totals', 'grand total'];

/** Known GA4 metric headers → normalized metric key. Unknown headers keep their exported name. */
const METRIC_KEYS: Record<string, string> = {
  'セッション': 'sessions',
  sessions: 'sessions',
  'e コマース購入数': 'ecommerce_purchases',
  'ecommerce purchases': 'ecommerce_purchases',
  'トランザクション': 'transactions',
  transactions: 'transactions',
  'アクティブ ユーザー': 'active_users',
  'active users': 'active_users',
  'dau/wau': 'dau_wau',
};

export const SESSIONS_HEADERS = ['セッション', 'sessions'];

const norm = (s: string) => s.replace(/^﻿/, '').trim();
const lower = (s: string) => norm(s).toLowerCase();
// Reason codes stay English in imported_data.invalid_reason; user-facing messages are bilingual.
const REASON_JA: Record<string, string> = {
  'missing value': '値がありません',
  'negative value': '負の値',
  'duplicate record': '重複レコード',
  'invalid date': '日付が不正',
  'clicks exceed impressions': 'クリック数が表示回数を超えています',
};
const reasonJa = (r: string) => REASON_JA[r] ?? r.replace(/^not a number: /, '数値ではありません: ');
const bi = (en: string, ja: string) => enc(tx(en, ja));


export function looksLikeGa4(grid: Grid): boolean {
  return grid.rows.some((r) => SEGMENT_HEADERS.includes(lower(r[0] ?? '')));
}

export function parseGa4(grid: Grid): Detection {
  const rows = grid.rows;
  const segIdx = rows.findIndex((r) => SEGMENT_HEADERS.includes(lower(r[0] ?? '')));
  const segRow = rows[segIdx];
  const metricRow = rows[segIdx + 1];
  if (segIdx < 0 || !segRow || !metricRow)
    return { ok: false, issue: { severity: 'error', code: 'ga4-header', message: bi('GA4 export: segment and metric header rows not found.', 'GA4 エクスポート：セグメント行と指標の見出し行が見つかりません。') } };

  const issues: Issue[] = [];
  const comments = rows
    .slice(0, segIdx)
    .map((r) => norm(r[0] ?? ''))
    .filter((c) => c.startsWith('#'))
    .map((c) => c.replace(/^#\s*/, '').trim())
    .filter((c) => c && !/^-+$/.test(c));

  const dated = DATE_HEADERS.includes(lower(metricRow[0] ?? ''));
  if (!dated && norm(metricRow[0] ?? '') !== '')
    issues.push({ severity: 'warning', code: 'ga4-first-column', message: bi(`Unexpected first header "${norm(metricRow[0] ?? '')}"; expected 日付/Date or blank.`, `先頭の見出し「${norm(metricRow[0] ?? '')}」は想定外です（日付/Date または空欄を想定）。`), row: segIdx + 2 });

  // Columns: segment carried forward when the export leaves a merged cell blank.
  type Col = { index: number; segment: string; metric: string; key: string; header: string };
  const cols: Col[] = [];
  let segment = '';
  for (let j = 1; j < Math.max(segRow.length, metricRow.length); j++) {
    const s = norm(segRow[j] ?? '');
    const m = norm(metricRow[j] ?? '');
    if (s) segment = s;
    if (!m) continue;
    if (!segment) {
      issues.push({ severity: 'warning', code: 'ga4-no-segment', message: bi(`Column ${j + 1} (${m}) has no segment; ignored.`, `${j + 1} 列目（${m}）にセグメントがないため無視しました。`), column: m });
      continue;
    }
    cols.push({ index: j, segment, metric: m, key: METRIC_KEYS[m.toLowerCase()] ?? m, header: `${segment} / ${m}` });
  }
  if (!cols.some((c) => SESSIONS_HEADERS.includes(c.metric.toLowerCase())))
    return { ok: false, issue: { severity: 'error', code: 'missing-column', message: bi('GA4 export has no セッション (Sessions) column.', 'GA4 エクスポートに「セッション」列がありません。'), column: 'セッション' } };

  // Export header date range, e.g. "20260912-20260913".
  let headerPeriod: Period | null = null;
  for (const c of comments) {
    const m = /^(\d{8})\s*-\s*(\d{8})$/.exec(c);
    if (m) {
      const start = parseDate(m[1]!);
      const end = parseDate(m[2]!);
      if (start && end) headerPeriod = { start, end };
    }
  }
  const synthetic = comments.filter((c) => /fake|dummy|synthetic|ダミー/i.test(c));
  if (synthetic.length)
    issues.push({ severity: 'warning', code: 'synthetic-data', message: bi(`Export notes say part of this file is not real data: ${synthetic.join(' / ')}`, `エクスポートの注記によると、このファイルの一部は実データではありません：${synthetic.join(' / ')}`) });

  const records: ParsedRecord[] = [];
  const seenDates = new Map<string, number>();
  const totals = new Map<number, number>();
  const sums = new Map<number, number>();
  const dates: string[] = [];

  for (let i = segIdx + 2; i < rows.length; i++) {
    const row = rows[i]!;
    if (isBlankRow(row)) continue;
    const rowNumber = i + 1;
    const values: Record<string, string> = { [dated ? norm(metricRow[0] ?? '') : '(no date column)']: norm(row[0] ?? '') };
    for (const c of cols) values[c.header] = norm(row[c.index] ?? '');
    // Cells beyond the header (the export tags its totals row there).
    for (let j = Math.max(segRow.length, metricRow.length); j < row.length; j++) if (norm(row[j] ?? '')) values[`(extra column ${j + 1})`] = norm(row[j] ?? '');

    const isTotal = row.some((c) => TOTAL_LABELS.includes(lower(c)));
    if (isTotal) {
      for (const c of cols) {
        const v = parseNumber(row[c.index] ?? '');
        if (v !== null && !Number.isNaN(v)) totals.set(c.index, v);
      }
      records.push({ rowNumber, status: 'total', values, issues: [bi('Totals row from the export — kept for reconciliation, not imported as data.', 'エクスポートの合計行 — 突合用に保持し、データとしては取り込みません。')], data: [] });
      continue;
    }

    const recIssues: string[] = [];
    let date: string | null = null;
    if (dated) {
      date = parseDate(row[0] ?? '');
      if (!date) recIssues.push(bi(`Invalid date "${norm(row[0] ?? '')}"`, `日付が不正です「${norm(row[0] ?? '')}」`));
      else if (seenDates.has(date)) recIssues.push(bi(`Duplicate date ${date} (first seen on row ${seenDates.get(date)})`, `日付 ${date} が重複しています（初出は ${seenDates.get(date)} 行目）`));
    }
    const duplicate = date !== null && seenDates.has(date);
    if (date && !duplicate) seenDates.set(date, rowNumber);

    const data: NormalizedValue[] = cols.map((c) => {
      const v = parseNumber(row[c.index] ?? '');
      let reason: string | null = null;
      if (dated && !date) reason = 'invalid date';
      else if (duplicate) reason = 'duplicate record';
      else if (v === null) reason = 'missing value';
      else if (Number.isNaN(v)) reason = `not a number: "${norm(row[c.index] ?? '')}"`;
      else if (v < 0) reason = 'negative value';
      if (reason && reason !== 'invalid date' && reason !== 'duplicate record') recIssues.push(bi(`${c.header}: ${reason}`, `${c.header}：${reasonJa(reason)}`));
      const ok = reason === null;
      return {
        dataDate: date,
        segment: c.segment,
        metricName: c.key,
        sourceMetricName: c.metric,
        metricValue: ok ? (v as number) : v === null || Number.isNaN(v) ? null : v,
        isValid: ok,
        invalidReason: reason,
      };
    });
    // A record with any invalid value is invalid as a whole: none of its values are used.
    if (data.some((d) => !d.isValid))
      for (const d of data) if (d.isValid) Object.assign(d, { isValid: false, invalidReason: 'other values in this record are invalid' });
    if (date && !duplicate) dates.push(date);
    if (dated) cols.forEach((c, k) => data[k]!.isValid && sums.set(c.index, (sums.get(c.index) ?? 0) + data[k]!.metricValue!));
    const status = duplicate ? 'duplicate' : recIssues.length ? 'invalid' : 'valid';
    records.push({ rowNumber, status, values, issues: recIssues, data });
    for (const msg of recIssues) issues.push({ severity: 'warning', code: duplicate ? 'duplicate' : 'invalid-record', message: msg, row: rowNumber });
  }

  if (!records.some((r) => r.status !== 'total'))
    return { ok: false, issue: { severity: 'error', code: 'empty', message: bi('GA4 export contains no data rows.', 'GA4 エクスポートにデータ行がありません。') } };

  // Totals reconciliation (dated exports only: the totals row equals the sum of the days).
  if (dated)
    for (const c of cols) {
      const total = totals.get(c.index);
      const sum = sums.get(c.index);
      if (total !== undefined && sum !== undefined && Math.abs(total - sum) > 0.5 && !/\//.test(c.metric))
        issues.push({ severity: 'warning', code: 'totals-mismatch', message: bi(`${c.header}: sum of daily rows ${sum} ≠ export total ${total}.`, `${c.header}：日次行の合計 ${sum} がエクスポートの合計 ${total} と一致しません。`), column: c.header });
    }

  let period: Period | null = null;
  let periodNote: string | null = null;
  if (dated && dates.length) {
    const sorted = [...dates].sort();
    period = { start: sorted[0]!, end: sorted[sorted.length - 1]! };
    periodNote = bi('From the dates in the file', 'ファイル内の日付から');
    const missing = missingDays(period, new Set(dates));
    if (missing.length) issues.push({ severity: 'warning', code: 'missing-dates', message: bi(`No rows for ${missing.length} day(s): ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}`, `${missing.length} 日分の行がありません：${missing.slice(0, 10).join('、')}${missing.length > 10 ? '…' : ''}`) });
    if (headerPeriod && (headerPeriod.start !== period.start || headerPeriod.end !== period.end))
      issues.push({ severity: 'warning', code: 'period-mismatch', message: bi(`Export header says ${headerPeriod.start}–${headerPeriod.end} but rows cover ${period.start}–${period.end}.`, `エクスポートの見出しは ${headerPeriod.start}–${headerPeriod.end} ですが、行は ${period.start}–${period.end} です。`) });
  } else if (headerPeriod) {
    period = headerPeriod;
    periodNote = bi('From the export header (rows have no date)', 'エクスポートの見出しから（行に日付なし）');
  }

  return {
    ok: true,
    table: {
      source: 'GA4',
      structure: 'ga4-explorations',
      sheet: grid.name,
      period,
      periodNote,
      undated: !dated,
      metadata: { exportComments: comments, segments: [...new Set(cols.map((c) => c.segment))], metrics: [...new Set(cols.map((c) => c.metric))] },
      records,
      issues,
    },
  };
}

export function missingDays(period: Period, have: Set<string>): string[] {
  const out: string[] = [];
  for (let d = period.start; d <= period.end; d = addDays(d, 1)) if (!have.has(d)) out.push(d);
  return out;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
