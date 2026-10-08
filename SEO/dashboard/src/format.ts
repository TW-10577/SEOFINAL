import { t } from './i18n.ts';

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

export const dateTime = (iso: string) => iso.slice(0, 16).replace('T', ' ');
export const period = (p: { start: string; end: string } | null | undefined) => (p ? `${p.start} – ${p.end}` : '—');
