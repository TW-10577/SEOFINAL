// Upload formats beyond CSV / Excel: detection from contents, table extraction, and the
// Unsupported / Processing failed outcomes.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as XLSX from 'xlsx';
import { Document, Packer, Paragraph, Table, TableCell, TableRow } from 'docx';
import { importUploads } from '../src/import/index.ts';
import { config, freshDb } from './helpers.ts';

// A small Search Console query tab, in the client's Japanese headers and in English.
const JA = [
  ['上位のクエリ', 'クリック数', '表示回数', 'CTR', '掲載順位'],
  ['ドスパラ', '608963', '809792', '75.2%', '1.04'],
  ['ガレリア', '78973', '169781', '46.51%', '1.6'],
];
const EN = [
  ['Top queries', 'Clicks', 'Impressions', 'CTR', 'Position'],
  ['dospara', '608963', '809792', '75.2%', '1.04'],
  ['galleria', '78973', '169781', '46.51%', '1.6'],
];
const records = (rows: string[][]) => rows.slice(1).map((r) => Object.fromEntries(rows[0]!.map((h, i) => [h, r[i]])));

// No source is given: GA4 / Search Console is detected from the contents, as in the dashboard.
async function upload(fileName: string, data: Buffer | string) {
  const [u] = await importUploads((await freshDb()), config(), [{ fileName, buffer: Buffer.isBuffer(data) ? data : Buffer.from(data) }], {});
  return u!;
}

function assertQueries(u: Awaited<ReturnType<typeof upload>>, format: string) {
  assert.equal(u.importStatus, 'imported', JSON.stringify(u.issues));
  assert.equal(u.fileType, format);
  assert.equal(u.structure, 'gsc-query');
  assert.equal(u.validRowCount, 2);
}

function workbook(bookType: XLSX.BookType): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(JA), 'クエリ');
  return XLSX.write(wb, { type: 'buffer', bookType }) as Buffer;
}

/** Minimal valid PDF with each cell drawn as text at its column position. */
function pdf(rows: string[][]): Buffer {
  const ops = rows.flatMap((r, ri) => r.map((c, ci) => `BT /F1 10 Tf ${40 + ci * 110} ${780 - ri * 20} Td (${c.replace(/[()\\]/g, '\\$&')}) Tj ET`)).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(ops)} >>\nstream\n${ops}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function zip(entries: Record<string, Buffer | string>): Buffer {
  const cfb = XLSX.CFB.utils.cfb_new();
  for (const [name, data] of Object.entries(entries)) XLSX.CFB.utils.cfb_add(cfb, name, Buffer.isBuffer(data) ? data : Buffer.from(data));
  return XLSX.CFB.write(cfb, { type: 'buffer', fileType: 'zip' }) as Buffer;
}

const csv = (rows: string[][], sep = ',') => rows.map((r) => r.join(sep)).join('\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);

describe('supported formats are detected from contents and imported', () => {
  test('CSV', async () => assertQueries(await upload('q.csv', csv(JA)), 'csv'));
  test('TSV', async () => assertQueries(await upload('q.tsv', csv(JA, '\t')), 'tsv'));
  test('TXT with semicolons', async () => assertQueries(await upload('q.txt', csv(JA, ';')), 'txt'));
  test('TXT with pipes', async () => assertQueries(await upload('q.txt', csv(JA, '|')), 'txt'));
  test('TXT with columns aligned by spaces', async () => assertQueries(await upload('q.txt', JA.map((r) => r.join('    ')).join('\n')), 'txt'));
  test('XLSX', async () => assertQueries(await upload('q.xlsx', workbook('xlsx')), 'xlsx'));
  test('XLS (Excel 97-2003)', async () => assertQueries(await upload('q.xls', workbook('biff8')), 'xls'));
  test('ODS', async () => assertQueries(await upload('q.ods', workbook('ods')), 'ods'));
  test('JSON array of objects', async () => assertQueries(await upload('q.json', JSON.stringify(records(JA))), 'json'));
  test('JSON with the records nested in an object', async () => assertQueries(await upload('q.json', JSON.stringify({ export: { rows: records(JA) } })), 'json'));
  test('JSON array of arrays', async () => assertQueries(await upload('q.json', JSON.stringify(JA)), 'json'));
  test('XML repeated elements', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><export>${records(JA).map((r) => `<row>${Object.entries(r).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</row>`).join('')}</export>`;
    assertQueries(await upload('q.xml', xml), 'xml');
  });
  test('HTML table', async () => {
    const html = `<!doctype html><html><body><h1>GSC</h1><table>${JA.map((r, i) => `<tr>${r.map((c) => (i ? `<td>${c}</td>` : `<th>${c}</th>`)).join('')}</tr>`).join('')}</table></body></html>`;
    assertQueries(await upload('q.html', html), 'html');
  });
  test('Word (.docx) table', async () => {
    const doc = new Document({ sections: [{ children: [new Paragraph('GSC export'), new Table({ rows: JA.map((r) => new TableRow({ children: r.map((c) => new TableCell({ children: [new Paragraph(c)] })) })) })] }] });
    assertQueries(await upload('q.docx', await Packer.toBuffer(doc)), 'docx');
  });
  test('PDF table (rows rebuilt from text positions)', async () => assertQueries(await upload('q.pdf', pdf(EN)), 'pdf'));
  test('ZIP of Search Console tabs: every entry is processed, unreadable entries are skipped with a warning', async () => {
    const daily = [['日付', 'クリック数', '表示回数', 'CTR', '掲載順位'], ['2026-09-01', '100', '1000', '10%', '5'], ['2026-09-02', '120', '1100', '10.91%', '5.1']];
    const u = await upload('gsc-export.zip', zip({ 'クエリ.csv': csv(JA), 'チャート.csv': csv(daily), 'logo.png': PNG }));
    assert.equal(u.importStatus, 'imported');
    assert.equal(u.fileType, 'zip');
    assert.equal(u.structure, 'gsc-query, gsc-date');
    assert.deepEqual(u.period, { start: '2026-09-01', end: '2026-09-02' });
    assert.ok(u.issues.some((i) => i.code === 'entry-skipped' && i.message.includes('logo.png')));
  });
  test('a format is detected even with the wrong extension', async () => assertQueries(await upload('export.dat', JSON.stringify(records(JA))), 'json'));
});

describe('Unsupported — the file format cannot be read', () => {
  test('image', async () => {
    const u = await upload('chart.png', PNG);
    assert.equal(u.importStatus, 'unsupported');
    assert.equal(u.validationStatus, 'invalid');
    assert.equal(u.issues[0]!.code, 'unsupported-format');
    assert.match(u.issues[0]!.message, /PNG images contain no readable table data/);
  });
  test('legacy Word .doc, with advice', async () => {
    const cfb = XLSX.CFB.utils.cfb_new();
    XLSX.CFB.utils.cfb_add(cfb, 'WordDocument', Buffer.alloc(600, 1));
    const u = await upload('old.doc', XLSX.CFB.write(cfb, { type: 'buffer' }) as Buffer);
    assert.equal(u.importStatus, 'unsupported');
    assert.match(u.issues[0]!.message, /Save the document as \.docx/);
  });
  test('gzip', async () => assert.equal((await upload('data.csv.gz', Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0]))).importStatus, 'unsupported'));
  test('the reason is available in Japanese', async () => {
    const u = await upload('chart.png', PNG);
    assert.match(JSON.parse(u.issues[0]!.message).ja, /画像には読み取れる表データがありません/);
  });
});

describe('Processing failed — readable format, no usable data', () => {
  test('invalid JSON', async () => {
    const u = await upload('bad.json', '{"rows": [1, 2');
    assert.equal(u.importStatus, 'failed');
    assert.equal(u.issues[0]!.code, 'processing-failed');
    assert.match(u.issues[0]!.message, /Invalid JSON/);
  });
  test('JSON without a list of records', async () => assert.match((await upload('cfg.json', '{"a": 1}')).issues[0]!.message, /no list of records/));
  test('HTML without a table', async () => assert.match((await upload('page.html', '<html><body><p>hello</p></body></html>')).issues[0]!.message, /no <table>/));
  test('corrupt PDF', async () => {
    const u = await upload('broken.pdf', '%PDF-1.4\nnot really a pdf');
    assert.equal(u.importStatus, 'failed');
    assert.match(u.issues[0]!.message, /Processing failed/);
  });
  test('a readable table that is not a GA4 / Search Console export', async () => {
    const u = await upload('sales.json', JSON.stringify([{ product: 'PC', price: 100 }, { product: 'GPU', price: 50 }]));
    assert.equal(u.importStatus, 'failed');
    assert.equal(u.fileType, 'json');
    assert.equal(u.source, null);
    assert.equal(u.issues[0]!.code, 'unknown-source');
  });
  test('empty file', async () => assert.equal((await upload('empty.csv', '')).importStatus, 'failed'));
});

describe('PostgreSQL schema', () => {
  test("a new database starts at the current schema; 'rejected' is no longer an import status", async () => {
    const db = await freshDb();
    assert.equal(await db.value('SELECT version FROM schema_info'), 5);
    const id = await db.insert(
      `INSERT INTO uploads (file_name, source, file_type, uploaded_at, validation_status, import_status, schema_version) VALUES ('ok.csv', 'GSC', 'csv', '2026-10-01', 'valid', 'imported', 5)`,
    );
    await assert.rejects(() => db.run(`UPDATE uploads SET import_status = 'rejected' WHERE id = ?`, id), /check constraint/);
  });
});
