// Google Search Console Performance export. Each tab is a separate file (or sheet):
//   <dimension> | クリック数 | 表示回数 | CTR | 掲載順位
// The dimension is identified by the first header cell; the filter tab holds export conditions.
import type { Issue, Period, Structure } from '@seo/shared';
import { isBlankRow, parseDate, parseNumber, type Grid } from './grid.ts';
import { missingDays } from './ga4.ts';
import { enc, tx } from '../i18n.ts';
import type { Detection, NormalizedValue, ParsedRecord } from './types.ts';

type Dim = 'query' | 'page' | 'date' | 'device' | 'country' | 'appearance';

const DIMENSIONS: Record<string, Dim> = {
  '上位のクエリ': 'query',
  'top queries': 'query',
  'クエリ': 'query',
  '上位のページ': 'page',
  'top pages': 'page',
  'ページ': 'page',
  '日付': 'date',
  date: 'date',
  'デバイス': 'device',
  device: 'device',
  '国': 'country',
  country: 'country',
  '検索での見え方': 'appearance',
  'search appearance': 'appearance',
};
const FILTER_HEADERS = ['フィルタ', 'filter', 'filters'];

const METRICS: Record<string, 'clicks' | 'impressions' | 'ctr' | 'position'> = {
  'クリック数': 'clicks',
  clicks: 'clicks',
  '表示回数': 'impressions',
  impressions: 'impressions',
  ctr: 'ctr',
  '掲載順位': 'position',
  position: 'position',
};

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


function headerRowIndex(grid: Grid): number {
  return grid.rows.findIndex((r) => !isBlankRow(r));
}

export function looksLikeGsc(grid: Grid): boolean {
  const first = lower(grid.rows[headerRowIndex(grid)]?.[0] ?? '');
  return first in DIMENSIONS || FILTER_HEADERS.includes(first);
}

export function parseGsc(grid: Grid): Detection {
  const h = headerRowIndex(grid);
  const header = (grid.rows[h] ?? []).map(norm);
  const first = (header[0] ?? '').toLowerCase();

  if (FILTER_HEADERS.includes(first)) {
    const filters: Record<string, string> = {};
    const records: ParsedRecord[] = [];
    for (let i = h + 1; i < grid.rows.length; i++) {
      const r = grid.rows[i]!;
      if (isBlankRow(r)) continue;
      filters[norm(r[0] ?? '')] = norm(r[1] ?? '');
      records.push({ rowNumber: i + 1, status: 'metadata', values: { [header[0]!]: norm(r[0] ?? ''), [header[1] ?? 'value']: norm(r[1] ?? '') }, issues: [], data: [] });
    }
    return {
      ok: true,
      table: { source: 'GSC', structure: 'gsc-filter', sheet: grid.name, period: null, periodNote: null, undated: true, metadata: { filters }, records, issues: [] },
    };
  }

  const dim = DIMENSIONS[first];
  if (!dim) return { ok: false, issue: { severity: 'error', code: 'unknown-structure', message: bi(`GSC export: unrecognised first column "${header[0] ?? ''}".`, `GSC エクスポート：先頭列「${header[0] ?? ''}」を認識できません。`) } };

  const metricCols = header.map((name, index) => ({ name, index, key: METRICS[name.toLowerCase()] })).filter((c) => c.key && c.index > 0);
  for (const required of ['clicks', 'impressions'] as const)
    if (!metricCols.some((c) => c.key === required))
      return { ok: false, issue: { severity: 'error', code: 'missing-column', message: bi(`GSC export has no ${required === 'clicks' ? 'クリック数 (Clicks)' : '表示回数 (Impressions)'} column.`, `GSC エクスポートに「${required === 'clicks' ? 'クリック数' : '表示回数'}」列がありません。`), column: required } };
  const issues: Issue[] = [];
  for (const optional of ['ctr', 'position'] as const)
    if (!metricCols.some((c) => c.key === optional)) issues.push({ severity: 'warning', code: 'missing-column', message: bi(`GSC export has no ${optional} column.`, `GSC エクスポートに ${optional === 'ctr' ? 'CTR' : '掲載順位'} 列がありません。`), column: optional });
  const unknown = header.slice(1).filter((n) => n && !METRICS[n.toLowerCase()]);
  if (unknown.length) issues.push({ severity: 'warning', code: 'unknown-column', message: bi(`Columns not imported: ${unknown.join(', ')}`, `取り込まなかった列：${unknown.join('、')}`) });

  const records: ParsedRecord[] = [];
  const seen = new Map<string, number>();
  const dates: string[] = [];

  for (let i = h + 1; i < grid.rows.length; i++) {
    const row = grid.rows[i]!;
    if (isBlankRow(row)) continue;
    const rowNumber = i + 1;
    const values: Record<string, string> = {};
    header.forEach((name, j) => (values[name || `(column ${j + 1})`] = norm(row[j] ?? '')));
    const recIssues: string[] = [];
    let ctrMismatch = false;

    const key = norm(row[0] ?? '');
    let dimOk = key !== '';
    if (!dimOk) recIssues.push(bi(`${header[0]}: missing value`, `${header[0]}：値がありません`));
    let date: string | null = null;
    if (dim === 'date' && dimOk) {
      date = parseDate(key);
      if (!date) {
        dimOk = false;
        recIssues.push(bi(`Invalid date "${key}"`, `日付が不正です「${key}」`));
      }
    }
    if (dim === 'page' && dimOk && !isHttpUrl(key)) {
      dimOk = false;
      recIssues.push(bi(`Invalid URL "${key}"`, `URL が不正です「${key}」`));
    }
    const dupKey = date ?? key;
    const duplicate = dimOk && seen.has(dupKey);
    if (duplicate) recIssues.push(bi(`Duplicate ${dim} "${dupKey}" (first seen on row ${seen.get(dupKey)})`, `「${dupKey}」が重複しています（初出は ${seen.get(dupKey)} 行目）`));
    else if (dimOk) seen.set(dupKey, rowNumber);

    const parsed = new Map<string, number | null>();
    for (const c of metricCols) parsed.set(c.key!, parseNumber(row[c.index] ?? ''));
    const clicks = parsed.get('clicks');
    const impressions = parsed.get('impressions');
    if (typeof clicks === 'number' && typeof impressions === 'number' && !Number.isNaN(clicks) && !Number.isNaN(impressions)) {
      if (clicks > impressions) recIssues.push(bi('Clicks exceed impressions', 'クリック数が表示回数を超えています'));
      const ctr = parsed.get('ctr');
      if (typeof ctr === 'number' && !Number.isNaN(ctr) && impressions > 0 && Math.abs((clicks / impressions) * 100 - ctr) > 0.05)
      {
        ctrMismatch = true;
        recIssues.push(bi(`CTR ${ctr}% does not match clicks / impressions (${((clicks / impressions) * 100).toFixed(2)}%)`, `CTR ${ctr}% がクリック数 ÷ 表示回数（${((clicks / impressions) * 100).toFixed(2)}%）と一致しません`));
      }
    }

    const data: NormalizedValue[] = metricCols.map((c) => {
      const v = parsed.get(c.key!) ?? null;
      let reason: string | null = null;
      if (!dimOk) reason = `invalid ${dim}`;
      else if (duplicate) reason = 'duplicate record';
      else if (v === null) reason = 'missing value';
      else if (Number.isNaN(v)) reason = `not a number: "${norm(row[c.index] ?? '')}"`;
      else if (v < 0) reason = 'negative value';
      else if (c.key === 'clicks' && typeof impressions === 'number' && v > impressions) reason = 'clicks exceed impressions';
      if (reason && reason.startsWith('not a number')) recIssues.push(bi(`${c.name}: ${reason}`, `${c.name}：${reasonJa(reason)}`));
      if (reason === 'missing value' || reason === 'negative value') recIssues.push(bi(`${c.name}: ${reason}`, `${c.name}：${reasonJa(reason)}`));
      const ok = reason === null;
      return {
        dataDate: date,
        query: dim === 'query' ? key : null,
        pageUrl: dim === 'page' ? key : null,
        device: dim === 'device' ? key : null,
        country: dim === 'country' ? key : null,
        searchAppearance: dim === 'appearance' ? key : null,
        metricName: c.key!,
        sourceMetricName: c.name,
        metricValue: v === null || Number.isNaN(v) ? null : v,
        isValid: ok,
        invalidReason: reason,
      };
    });
    // A record with any invalid value is invalid as a whole: none of its values are used.
    if (data.some((d) => !d.isValid))
      for (const d of data) if (d.isValid) Object.assign(d, { isValid: false, invalidReason: 'other values in this record are invalid' });
    if (date && !duplicate) dates.push(date);
    const status = duplicate ? 'duplicate' : data.every((d) => d.isValid) ? 'valid' : 'invalid';
    records.push({ rowNumber, status, values, issues: recIssues, data });
    for (const msg of recIssues) issues.push({ severity: 'warning', code: duplicate ? 'duplicate' : ctrMismatch && msg.startsWith('{"en":"CTR') ? 'ctr-mismatch' : 'invalid-record', message: msg, row: rowNumber });
  }
  if (!records.length) return { ok: false, issue: { severity: 'error', code: 'empty', message: bi('GSC export contains no data rows.', 'GSC エクスポートにデータ行がありません。') } };

  let period: Period | null = null;
  let periodNote: string | null = null;
  if (dim === 'date' && dates.length) {
    const sorted = [...dates].sort();
    period = { start: sorted[0]!, end: sorted[sorted.length - 1]! };
    periodNote = bi('From the dates in the file', 'ファイル内の日付から');
    const missing = missingDays(period, new Set(dates));
    if (missing.length) issues.push({ severity: 'warning', code: 'missing-dates', message: bi(`No rows for ${missing.length} day(s): ${missing.slice(0, 10).join(', ')}`, `${missing.length} 日分の行がありません：${missing.slice(0, 10).join('、')}`) });
  }

  return {
    ok: true,
    table: {
      source: 'GSC',
      structure: `gsc-${dim}` as Structure,
      sheet: grid.name,
      period,
      periodNote,
      undated: dim !== 'date',
      metadata: { dimension: header[0], rowLimitNote: records.length === 1000 ? bi('Exactly 1,000 rows — the Search Console UI export limit; rows beyond it are missing.', 'ちょうど 1,000 行 — Search Console UI エクスポートの上限で、それ以降の行は欠落しています。') : undefined },
      records,
      issues: records.length === 1000
        ? [...issues, { severity: 'warning', code: 'row-cap', message: bi('Exactly 1,000 rows: Search Console UI exports are capped at 1,000 rows, so this file is likely truncated.', 'ちょうど 1,000 行です。Search Console の UI エクスポートは 1,000 行が上限のため、途中で切れている可能性があります。') }]
        : issues,
    },
  };
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
