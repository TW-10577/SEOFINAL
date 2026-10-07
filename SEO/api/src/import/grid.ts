// Turns an uploaded file into grids of cell text. CSV → one grid; Excel → one grid per sheet.
import * as XLSX from 'xlsx';

export interface Grid {
  /** Sheet name for Excel, '' for CSV. */
  name: string;
  /** rows[i] is source row i + 1. */
  rows: string[][];
}

export type FileType = 'csv' | 'xlsx';

export function fileTypeOf(fileName: string): FileType | null {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') return 'csv';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  return null;
}

export function readGrids(fileType: FileType, buf: Buffer): Grid[] {
  if (fileType === 'xlsx') {
    const wb = XLSX.read(buf, { type: 'buffer' });
    return wb.SheetNames.map((name) => {
      const sheet = wb.Sheets[name]!;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: true });
      return { name, rows: rows.map((r) => r.map((c) => (c == null ? '' : String(c)))) };
    });
  }
  return [{ name: '', rows: parseDelimited(decodeText(buf)) }];
}

/** UTF-8 (with or without BOM), UTF-16 with BOM, otherwise Shift_JIS. */
export function decodeText(buf: Buffer): string {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('shift_jis').decode(buf);
  }
}

/** RFC 4180 parser; delimiter is comma unless the first data line has more tabs. */
export function parseDelimited(text: string): string[][] {
  const sample = text.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) ?? '';
  const delim = (sample.match(/\t/g)?.length ?? 0) > (sample.match(/,/g)?.length ?? 0) ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export const isBlankRow = (r: string[]) => r.every((c) => c.trim() === '');

/** Parses "1,234", "75.2%", "6.04". Returns null for blank, NaN for unparseable. */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(/,/g, '').replace(/%$/, '');
  if (t === '') return null;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return NaN;
  return Number(t);
}

/** Accepts yyyymmdd, yyyy-mm-dd, yyyy/mm/dd. Returns ISO date or null when invalid. */
export function parseDate(text: string): string | null {
  const t = text.trim();
  const m = /^(\d{4})[-/]?(\d{1,2})[-/]?(\d{1,2})$/.exec(t);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}
