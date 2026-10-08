// File format detection (from contents, not only the extension) and table extraction.
// Every supported format is turned into grids of cell text; the GA4 / Search Console parsers
// then recognise the structure exactly as they do for CSV.
import { XMLParser } from 'fast-xml-parser';
import * as XLSX from 'xlsx';
import { decodeText, parseDelimited, type Grid } from './grid.ts';

export type Format =
  | 'csv'
  | 'tsv'
  | 'txt'
  | 'xlsx'
  | 'xls'
  | 'ods'
  | 'xml-spreadsheet'
  | 'json'
  | 'xml'
  | 'html'
  | 'pdf'
  | 'docx'
  | 'zip';

export const FORMAT_LABEL: Record<Format, string> = {
  csv: 'CSV',
  tsv: 'TSV',
  txt: 'Text',
  xlsx: 'Excel (.xlsx)',
  xls: 'Excel 97-2003 (.xls)',
  ods: 'OpenDocument spreadsheet',
  'xml-spreadsheet': 'Excel XML spreadsheet',
  json: 'JSON',
  xml: 'XML',
  html: 'HTML',
  pdf: 'PDF',
  docx: 'Word (.docx)',
  zip: 'ZIP archive',
};

/** The file is of a kind the system cannot read at all. */
export class UnsupportedFormat extends Error {
  constructor(public readonly en: string, public readonly ja: string, public readonly detected = 'unknown') {
    super(en);
  }
}

/** The format is supported but this file could not be processed. */
export class ProcessingFailed extends Error {
  constructor(public readonly en: string, public readonly ja: string) {
    super(en);
  }
}

export interface Extraction {
  format: Format;
  grids: Grid[];
  /** Non-fatal notes, e.g. a ZIP entry that was skipped. */
  notes: { en: string; ja: string }[];
}

const startsWith = (b: Buffer, bytes: number[]) => bytes.every((v, i) => b[i] === v);
const ext = (name: string) => name.toLowerCase().split('.').pop() ?? '';

function containerEntries(buf: Buffer): string[] {
  try {
    return XLSX.CFB.read(buf, { type: 'buffer' }).FullPaths.map((p: string) => p.replace(/^Root Entry\//, ''));
  } catch {
    return [];
  }
}

/** Detects the format from the bytes. Throws UnsupportedFormat with a reason. */
export function detectFormat(fileName: string, buf: Buffer): Format {
  const e = ext(fileName);
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) return 'pdf'; // %PDF
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06])) {
    const entries = containerEntries(buf);
    if (entries.some((p) => /(^|\/)xl\/workbook\.(xml|bin)$/.test(p))) return 'xlsx';
    if (entries.some((p) => /(^|\/)word\/document\.xml$/.test(p))) return 'docx';
    if (entries.some((p) => /(^|\/)content\.xml$/.test(p)) && (e === 'ods' || entries.some((p) => /mimetype$/.test(p)))) {
      if (entries.some((p) => /(^|\/)ppt\//.test(p))) throw new UnsupportedFormat('PowerPoint presentations are not supported.', 'PowerPoint プレゼンテーションには対応していません。', 'pptx');
      return 'ods';
    }
    if (entries.some((p) => /(^|\/)ppt\//.test(p)))
      throw new UnsupportedFormat('PowerPoint presentations are not supported. Export the table as CSV or Excel.', 'PowerPoint プレゼンテーションには対応していません。表を CSV または Excel で書き出してください。', 'pptx');
    return 'zip';
  }
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    const entries = containerEntries(buf);
    if (entries.some((p) => /^(Workbook|Book)$/i.test(p.split('/').pop() ?? ''))) return 'xls';
    if (entries.some((p) => /WordDocument$/.test(p)))
      throw new UnsupportedFormat('Legacy Word 97-2003 documents (.doc) cannot be read. Save the document as .docx and upload it again.', '旧形式の Word 97-2003 文書（.doc）は読み込めません。.docx で保存して再度アップロードしてください。', 'doc');
    throw new UnsupportedFormat('This Microsoft Office 97-2003 file is not a spreadsheet or Word document the system can read.', 'この Microsoft Office 97-2003 ファイルは読み込めるスプレッドシートまたは Word 文書ではありません。', 'ole');
  }
  const image =
    startsWith(buf, [0x89, 0x50, 0x4e, 0x47]) ? 'PNG' :
    startsWith(buf, [0xff, 0xd8, 0xff]) ? 'JPEG' :
    startsWith(buf, [0x47, 0x49, 0x46, 0x38]) ? 'GIF' :
    startsWith(buf, [0x42, 0x4d]) && buf.length > 26 && e === 'bmp' ? 'BMP' :
    buf.subarray(8, 12).toString('latin1') === 'WEBP' ? 'WEBP' : null;
  if (image)
    throw new UnsupportedFormat(`${image} images contain no readable table data. Upload the original export (CSV, Excel, PDF…).`, `${image} 画像には読み取れる表データがありません。元のエクスポート（CSV、Excel、PDF など）をアップロードしてください。`, image.toLowerCase());
  if (startsWith(buf, [0x1f, 0x8b]))
    throw new UnsupportedFormat('Gzip-compressed files are not supported. Upload the uncompressed file or a ZIP archive.', 'Gzip 圧縮ファイルには対応していません。解凍したファイルまたは ZIP をアップロードしてください。', 'gzip');
  if (looksBinary(buf))
    throw new UnsupportedFormat(`Unrecognised binary file${e ? ` (.${e})` : ''}; it is not a data or document format the system can read.`, `認識できないバイナリファイルです${e ? `（.${e}）` : ''}。読み込めるデータ形式・文書形式ではありません。`, e || 'binary');

  const head = decodeText(buf.subarray(0, 4096)).replace(/^﻿/, '').trimStart();
  if (head.startsWith('{\\rtf'))
    throw new UnsupportedFormat('RTF documents are not supported. Save as .docx, PDF or CSV.', 'RTF 文書には対応していません。.docx、PDF または CSV で保存してください。', 'rtf');
  if (head.startsWith('{') || (head.startsWith('[') && /^\[\s*[[{"\]]/.test(head))) return 'json';
  if (head.startsWith('<')) {
    if (/urn:schemas-microsoft-com:office:spreadsheet/.test(head)) return 'xml-spreadsheet';
    if (/<!doctype html|<html[\s>]|<table[\s>]|<body[\s>]/i.test(head) || e === 'html' || e === 'htm') return 'html';
    return 'xml';
  }
  if (e === 'tsv' || e === 'tab') return 'tsv';
  if (e === 'txt' || e === 'text' || e === 'log') return 'txt';
  return 'csv';
}

function looksBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, 1024);
  let control = 0;
  for (const b of sample) if (b === 0 || (b < 8 && b !== 0)) control++;
  // UTF-16 text has NULs in every other byte but starts with a BOM, which decodeText handles.
  if (startsWith(buf, [0xff, 0xfe]) || startsWith(buf, [0xfe, 0xff])) return false;
  return sample.length > 0 && control / sample.length > 0.02;
}

// ---------------------------------------------------------------- extraction

/** Formats that need asynchronous libraries (PDF, Word). */
export const ASYNC_FORMATS: ReadonlySet<Format> = new Set(['pdf', 'docx']);

export async function extract(fileName: string, buf: Buffer, depth = 0): Promise<Extraction> {
  const format = detectFormat(fileName, buf);
  if (format === 'pdf') return { format, grids: await pdfGrids(buf), notes: [] };
  if (format === 'docx') return { format, grids: await docxGrids(buf), notes: [] };
  if (format === 'zip') return zipExtract(buf, depth, true);
  return { format, grids: extractSyncFormat(format, buf), notes: [] };
}

/** Extraction for formats that need no async library. Throws for PDF / Word. */
export function extractSync(fileName: string, buf: Buffer, depth = 0): Extraction {
  const format = detectFormat(fileName, buf);
  if (ASYNC_FORMATS.has(format)) throw new ProcessingFailed(`${FORMAT_LABEL[format]} must be imported through the upload API.`, `${FORMAT_LABEL[format]} はアップロード API から取り込む必要があります。`);
  if (format === 'zip') return zipExtract(buf, depth, false) as Extraction;
  return { format, grids: extractSyncFormat(format, buf), notes: [] };
}

function extractSyncFormat(format: Format, buf: Buffer): Grid[] {
  switch (format) {
    case 'csv':
    case 'tsv':
    case 'txt':
      return [{ name: '', rows: textRows(decodeText(buf)) }];
    case 'xlsx':
    case 'xls':
    case 'ods':
    case 'xml-spreadsheet':
      return workbookGrids(() => XLSX.read(buf, { type: 'buffer' }));
    case 'html':
      return htmlGrids(decodeText(buf));
    case 'json':
      return jsonGrids(decodeText(buf));
    case 'xml':
      return xmlGrids(decodeText(buf));
    default:
      throw new ProcessingFailed(`No extractor for ${format}.`, `${format} の抽出処理がありません。`);
  }
}

/** Delimited text: comma, tab, semicolon or pipe; otherwise columns separated by 2+ spaces. */
function textRows(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  const sample = lines.slice(0, 20);
  const count = (re: RegExp) => sample.reduce((a, l) => a + (l.match(re)?.length ?? 0), 0);
  const delims: [string, number][] = [[',', count(/,/g)], ['\t', count(/\t/g)], [';', count(/;/g)], ['|', count(/\|/g)]];
  const [best, n] = delims.sort((a, b) => b[1] - a[1])[0]!;
  if (n === 0) {
    const rows = text.split(/\r?\n/).map((l) => (l.trim() ? l.trim().split(/\s{2,}/) : []));
    if (!rows.some((r) => r.length > 1)) throw new ProcessingFailed('The text has no columns (no delimiter or aligned columns found).', 'テキストに列がありません（区切り文字や揃った列が見つかりません）。');
    return rows;
  }
  if (best === ',' || best === '\t') return parseDelimited(text);
  return parseDelimited(text.replaceAll(best, '\t'));
}

function workbookGrids(read: () => XLSX.WorkBook): Grid[] {
  let wb: XLSX.WorkBook;
  try {
    wb = read();
  } catch (e) {
    const msg = (e as Error).message;
    if (/password|encrypt/i.test(msg)) throw new ProcessingFailed('The workbook is password-protected. Remove the password and upload it again.', 'ブックにパスワードが設定されています。パスワードを解除して再度アップロードしてください。');
    throw new ProcessingFailed(`The spreadsheet could not be read: ${msg}`, `スプレッドシートを読み込めませんでした：${msg}`);
  }
  return wb.SheetNames.map((name) => ({ name, rows: sheetRows(wb.Sheets[name]!) }));
}

function sheetRows(sheet: XLSX.WorkSheet): string[][] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: true });
  return rows.map((r) => r.map((c) => (c == null ? '' : String(c))));
}

/** Every <table> in an HTML document becomes one grid. */
function htmlGrids(html: string): Grid[] {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  if (!tables.length) throw new ProcessingFailed('The HTML contains no <table>, so there is no tabular data to import.', 'HTML に <table> がないため、取り込める表データがありません。');
  return tables.map((t, i) => {
    const wb = XLSX.read(t, { type: 'string' });
    return { name: tables.length > 1 ? `table ${i + 1}` : '', rows: sheetRows(wb.Sheets[wb.SheetNames[0]!]!) };
  });
}

// ---------- JSON / XML: find arrays of records ----------

type Json = unknown;

function cell(v: Json): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** A GA4 Data API runReport response → one row per report row, columns named by the headers. */
function ga4ReportGrid(o: Record<string, any>): string[][] | null {
  if (!Array.isArray(o.rows) || !(Array.isArray(o.dimensionHeaders) || Array.isArray(o.metricHeaders))) return null;
  const header = [...(o.dimensionHeaders ?? []).map((h: any) => h.name), ...(o.metricHeaders ?? []).map((h: any) => h.name)];
  const rows = o.rows.map((r: any) => [...(r.dimensionValues ?? []).map((v: any) => cell(v?.value)), ...(r.metricValues ?? []).map((v: any) => cell(v?.value))]);
  return [header, ...rows];
}

function recordsToRows(list: Json[]): string[][] | null {
  if (!list.length) return null;
  if (list.every((r) => Array.isArray(r))) return (list as Json[][]).map((r) => r.map(cell));
  if (!list.every((r) => r && typeof r === 'object' && !Array.isArray(r))) return null;
  const header: string[] = [];
  for (const r of list as Record<string, Json>[]) for (const k of Object.keys(r)) if (!header.includes(k)) header.push(k);
  return [header, ...(list as Record<string, Json>[]).map((r) => header.map((k) => cell(r[k])))];
}

/** Collects every array of records in a parsed document, with a dotted path as its name. */
function findTables(root: Json, path = ''): Grid[] {
  const out: Grid[] = [];
  const visit = (v: Json, p: string) => {
    if (Array.isArray(v)) {
      const rows = recordsToRows(v);
      if (rows && rows.length > 1) {
        out.push({ name: p, rows });
        return;
      }
      v.forEach((x, i) => visit(x, `${p}[${i}]`));
    } else if (v && typeof v === 'object') {
      const report = ga4ReportGrid(v as Record<string, any>);
      if (report) {
        out.push({ name: p || 'report', rows: report });
        return;
      }
      for (const [k, x] of Object.entries(v)) visit(x, p ? `${p}.${k}` : k);
    }
  };
  visit(root, path);
  return out;
}

function jsonGrids(text: string): Grid[] {
  let data: Json;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    throw new ProcessingFailed(`Invalid JSON: ${(e as Error).message}`, `JSON の形式が正しくありません：${(e as Error).message}`);
  }
  const grids = findTables(data);
  if (!grids.length) throw new ProcessingFailed('The JSON contains no list of records (array of objects or arrays) to import as a table.', 'JSON に表として取り込めるレコードの配列（オブジェクトまたは配列の配列）がありません。');
  return grids;
}

function xmlGrids(text: string): Grid[] {
  let data: Json;
  try {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', textNodeName: '#text', parseTagValue: false, parseAttributeValue: false, trimValues: true });
    data = parser.parse(text);
  } catch (e) {
    throw new ProcessingFailed(`Invalid XML: ${(e as Error).message}`, `XML の形式が正しくありません：${(e as Error).message}`);
  }
  const grids = findTables(data);
  if (!grids.length) throw new ProcessingFailed('The XML has no repeated record elements to import as a table.', 'XML に表として取り込める繰り返し要素がありません。');
  return grids;
}

// ---------- PDF: rebuild rows from text positions ----------

async function pdfGrids(buf: Buffer): Promise<Grid[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false, verbosity: 0 }).promise;
  } catch (e) {
    const msg = (e as Error).message;
    if (/password/i.test(msg)) throw new ProcessingFailed('The PDF is password-protected.', 'PDF にパスワードが設定されています。');
    throw new ProcessingFailed(`The PDF could not be read: ${msg}`, `PDF を読み込めませんでした：${msg}`);
  }
  const rows: string[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    type Item = { str: string; x: number; y: number; w: number };
    const items: Item[] = (content.items as any[])
      .filter((i) => typeof i.str === 'string' && i.str.trim())
      .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width ?? 0 }));
    // Group into lines by baseline, top to bottom; split cells on wide horizontal gaps.
    const lines: Item[][] = [];
    for (const it of items.sort((a, b) => b.y - a.y || a.x - b.x)) {
      const line = lines.find((l) => Math.abs(l[0]!.y - it.y) < 3);
      if (line) line.push(it);
      else lines.push([it]);
    }
    for (const line of lines) {
      line.sort((a, b) => a.x - b.x);
      const cells: string[] = [];
      let prev: Item | null = null;
      for (const it of line) {
        if (prev && it.x - (prev.x + prev.w) < 6) cells[cells.length - 1] += (it.x - (prev.x + prev.w) > 1 ? ' ' : '') + it.str;
        else cells.push(it.str);
        prev = it;
      }
      rows.push(cells.map((c) => c.trim()));
    }
  }
  if (!rows.length) throw new ProcessingFailed('The PDF has no extractable text (it may be a scanned image).', 'PDF に抽出できるテキストがありません（スキャン画像の可能性があります）。');
  return [{ name: '', rows }];
}

// ---------- Word (.docx): tables, else delimited text ----------

async function docxGrids(buf: Buffer): Promise<Grid[]> {
  const mammoth = await import('mammoth');
  let html: string;
  try {
    html = (await mammoth.convertToHtml({ buffer: buf })).value;
  } catch (e) {
    throw new ProcessingFailed(`The Word document could not be read: ${(e as Error).message}`, `Word 文書を読み込めませんでした：${(e as Error).message}`);
  }
  if (/<table/i.test(html)) return htmlGrids(html);
  const text = (await mammoth.extractRawText({ buffer: buf })).value;
  try {
    return [{ name: '', rows: textRows(text) }];
  } catch {
    throw new ProcessingFailed('The Word document contains no table and no delimited text.', 'Word 文書に表も区切り文字付きのテキストもありません。');
  }
}

// ---------- ZIP: every entry is processed on its own ----------

function zipEntries(buf: Buffer): { name: string; data: Buffer }[] {
  const cfb = XLSX.CFB.read(buf, { type: 'buffer' });
  return cfb.FileIndex.map((f: any, i: number) => ({ f, name: cfb.FullPaths[i].replace(/^Root Entry\//, '') }))
    .filter(({ f, name }: any) => f.type === 2 && f.content?.length && !/(^|\/)(__MACOSX|\.)/.test(name))
    .map(({ f, name }: any) => ({ name, data: Buffer.from(f.content) }));
}

function zipExtract(buf: Buffer, depth: number, allowAsync: true): Promise<Extraction>;
function zipExtract(buf: Buffer, depth: number, allowAsync: false): Extraction;
function zipExtract(buf: Buffer, depth: number, allowAsync: boolean): Extraction | Promise<Extraction> {
  if (depth > 1) throw new ProcessingFailed('ZIP archives nested more than one level are not processed.', '2 階層以上入れ子になった ZIP は処理しません。');
  let entries: { name: string; data: Buffer }[];
  try {
    entries = zipEntries(buf);
  } catch (e) {
    throw new ProcessingFailed(`The ZIP archive could not be opened: ${(e as Error).message}`, `ZIP を開けませんでした：${(e as Error).message}`);
  }
  if (!entries.length) throw new ProcessingFailed('The ZIP archive is empty.', 'ZIP が空です。');
  const notes: Extraction['notes'] = [];
  const grids: Grid[] = [];
  const collect = (name: string, r: Extraction) => grids.push(...r.grids.map((g) => ({ name: g.name ? `${name} › ${g.name}` : name, rows: g.rows })));
  const skip = (name: string, e: unknown) => {
    const err = e as UnsupportedFormat | ProcessingFailed;
    notes.push({ en: `${name}: skipped — ${err.en ?? (e as Error).message}`, ja: `${name}：スキップ — ${err.ja ?? (e as Error).message}` });
  };
  const done = (): Extraction => {
    if (!grids.length) throw new ProcessingFailed(`No entry in the ZIP archive could be processed. ${notes.map((n) => n.en).join(' ')}`, `ZIP 内に処理できるファイルがありません。${notes.map((n) => n.ja).join(' ')}`);
    return { format: 'zip', grids, notes };
  };
  if (!allowAsync) {
    for (const { name, data } of entries) {
      try {
        collect(name, extractSync(name, data, depth + 1));
      } catch (e) {
        skip(name, e);
      }
    }
    return done();
  }
  return (async () => {
    for (const { name, data } of entries) {
      try {
        collect(name, await extract(name, data, depth + 1));
      } catch (e) {
        skip(name, e);
      }
    }
    return done();
  })();
}
