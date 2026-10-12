import { currentLang, t } from './i18n.ts';

export const METRIC_LABEL: Record<string, string> = {
  sessions: 'Sessions',
  cv: 'CV',
  cvr: 'CVR (%)',
  ecommerce_purchases: 'Ecommerce purchases',
  transactions: 'Transactions',
  active_users: 'Active users',
  dau_wau: 'DAU/WAU',
  clicks: 'Clicks',
  impressions: 'Impressions',
  ctr: 'CTR (%)',
  position: 'Avg. position',
};

export const metricLabel = (m: string) => t(METRIC_LABEL[m] ?? m);

export function num(v: number | null | undefined, digits?: number): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const d = digits ?? (Number.isInteger(v) ? 0 : Math.abs(v) < 10 ? 3 : 2);
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Value formatting by metric: ratios with 3 decimals, position with 2. */
export function metricValue(metric: string, v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (metric === 'cvr' || metric === 'ctr') return num(v, 3);
  if (metric === 'position' || metric === 'dau_wau') return num(v, 2);
  return num(v);
}

export function signed(metric: string, v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${v > 0 ? '+' : ''}${metricValue(metric, v)}`;
}

export const pct = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`);

export function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/** Detected file format → display label. */
const FORMAT_LABEL: Record<string, string> = {
  csv: 'CSV', tsv: 'TSV', txt: 'TXT', xlsx: 'XLSX', xls: 'XLS', ods: 'ODS', 'xml-spreadsheet': 'Excel XML', json: 'JSON', xml: 'XML',
  html: 'HTML', pdf: 'PDF', docx: 'DOCX', zip: 'ZIP', doc: 'DOC', pptx: 'PPTX', png: 'PNG', jpeg: 'JPEG', gif: 'GIF', gzip: 'GZIP', rtf: 'RTF',
};
export const formatLabel = (f: string) => FORMAT_LABEL[f] ?? f.toUpperCase();

/** Axis label for an ISO day: "Oct 4" / "10/4". */
export function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return currentLang() === 'ja' ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}` : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Tooltip label for an ISO day with the weekday: "Sun, Oct 4, 2026" / "2026/10/4 (日)". */
export function dayLong(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return currentLang() === 'ja'
    ? `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()} (${'日月火水木金土'[d.getUTCDay()]})`
    : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export const dateTime = (iso: string) => iso.slice(0, 16).replace('T', ' ');
export const period = (p: { start: string; end: string } | null | undefined) => (p ? `${p.start} – ${p.end}` : '—');

const isRatio = (metric: string) => metric === 'cvr' || metric === 'ctr';

/** Business formatting: ratios as percentages (CVR 0.961%), position with 2 decimals, counts with separators. */
export function fmtValue(metric: string, v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (isRatio(metric)) return `${v.toFixed(3)}%`;
  if (metric === 'position') return v.toFixed(2);
  return num(v);
}

/** Absolute difference: ratios in percentage points, counts as signed numbers. */
export function fmtDiff(metric: string, v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  if (isRatio(metric)) return `${sign}${Math.abs(v).toFixed(3)} pt`;
  if (metric === 'position') return `${sign}${Math.abs(v).toFixed(2)}`;
  return `${sign}${num(Math.abs(v))}`;
}

export const fmtRate = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`);
