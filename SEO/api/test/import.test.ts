// Receive SEO Data / Check and Standardize Data, on the client files and on invalid input.
import assert from 'node:assert/strict';
import type { DB } from '../src/db.ts';
import { describe, test } from 'node:test';
import * as XLSX from 'xlsx';
import { importFiles } from '../src/import/index.ts';
import { GA4_DIR, GSC_DIR, clientFiles, config, freshDb } from './helpers.ts';

const one = async (fileName: string, text: string | Buffer, source: 'GA4' | 'GSC' = 'GSC', db?: DB) =>
  (await importFiles(db ?? (await freshDb()), config(), [{ fileName, buffer: Buffer.isBuffer(text) ? text : Buffer.from(text) }], { source }))[0]!;

describe('client files', () => {
  test('GA4 two-week export: 14 daily rows, totals row kept, synthetic-data note surfaced', async () => {
    const db = (await freshDb());
    const uploads = (await importFiles(db, config(), clientFiles(GA4_DIR), { source: 'GA4' }));
    const u = uploads.find((x) => x.fileName.startsWith('Two Weeks'))!;
    assert.equal(u.importStatus, 'imported');
    assert.equal(u.rowCount, 14);
    assert.deepEqual(u.period, { start: '2026-09-10', end: '2026-09-23' });
    assert.ok(u.issues.some((i: { code: string }) => i.code === 'synthetic-data'));
    assert.ok(!u.issues.some((i) => i.code === 'totals-mismatch'), 'daily rows reconcile with the 総計 row');
    const raw = await db.all(`SELECT status, COUNT(*) n FROM raw_records WHERE upload_id = ? GROUP BY status`, u.id);
    assert.deepEqual(raw, [{ status: 'total', n: 1 }, { status: 'valid', n: 14 }]);
    // Columns identified by header text, not position.
    const organic = (await db.value(`SELECT metric_value FROM imported_data WHERE upload_id = ? AND segment = '通販（全体） オーガニックサーチ' AND metric_name = 'sessions' AND data_date = '2026-09-10'`, u.id));
    assert.equal(organic, 50653);
  });

  test('GA4 export without a date column: period from the export header, trailing 総計 tag recognised', async () => {
    const u = (await importFiles((await freshDb()), config(), clientFiles(GA4_DIR), { source: 'GA4' })).find((x) => x.fileName.startsWith('download'))!;
    assert.equal(u.rowCount, 1);
    assert.deepEqual(u.period, { start: '2026-09-12', end: '2026-09-13' });
  });

  test('GSC tabs detected from contents; undated tabs take the daily chart period from the same batch', async () => {
    const uploads = (await importFiles((await freshDb()), config(), clientFiles(GSC_DIR), { source: 'GSC' }));
    const by = Object.fromEntries(uploads.map((u) => [u.structure, u]));
    assert.deepEqual(Object.keys(by).sort(), ['gsc-appearance', 'gsc-country', 'gsc-date', 'gsc-device', 'gsc-filter', 'gsc-page', 'gsc-query']);
    assert.equal(by['gsc-date']!.rowCount, 92);
    assert.deepEqual(by['gsc-query']!.period, { start: '2026-06-16', end: '2026-09-15' });
    assert.match(by['gsc-query']!.periodNote!, /daily chart/);
    assert.ok(by['gsc-query']!.issues.some((i: { code: string; message: string }) => i.code === 'row-cap'));
    assert.deepEqual((by['gsc-filter']!.metadata['gsc-filter'] as any).filters, { 検索タイプ: 'ウェブ', 日付: '過去 3 か月間' });
  });

  test('duplicate record in client data is flagged, not silently merged (国.csv ドミニカ)', async () => {
    const u = (await importFiles((await freshDb()), config(), clientFiles(GSC_DIR), { source: 'GSC' })).find((x) => x.structure === 'gsc-country')!;
    assert.equal(u.rowCount - u.validRowCount, 1);
    assert.ok(u.issues.some((i) => i.code === 'duplicate' && i.message.includes('ドミニカ')));
  });
});

describe('invalid imported data', () => {
  test('a .pdf name with non-PDF contents is detected by contents, not the extension', async () => {
    const u = (await one('report.pdf', 'x'));
    assert.equal(u.importStatus, 'failed');
    assert.equal(u.issues[0]!.code, 'processing-failed');
  });

  test('empty file → rejected', async () => {
    assert.equal((await one('a.csv', '')).issues[0]!.code, 'empty');
  });

  test('unrecognised structure → rejected', async () => {
    const u = (await importFiles((await freshDb()), config(), [{ fileName: 'a.csv', buffer: Buffer.from('foo,bar\n1,2') }], {}))[0]!;
    assert.equal(u.source, null);
    assert.equal(u.issues[0]!.code, 'unknown-source');
  });

  test('source mismatch → rejected', async () => {
    assert.equal((await one('a.csv', '上位のクエリ,クリック数,表示回数\nx,1,2', 'GA4')).issues[0]!.code, 'source-mismatch');
  });

  test('missing required column → rejected', async () => {
    const u = (await one('a.csv', '上位のクエリ,クリック数\nx,1'));
    assert.equal(u.importStatus, 'failed');
    assert.equal(u.issues[0]!.code, 'missing-column');
  });

  test('invalid date, invalid number, invalid URL, duplicate → rows kept but never valid', async () => {
    const db = (await freshDb());
    const daily = (await one('d.csv', '日付,クリック数,表示回数,CTR,掲載順位\n2026-02-30,1,10,10%,3\n2026-03-01,abc,10,10%,3\n2026-03-02,1,10,10%,3\n2026-03-02,1,10,10%,3', 'GSC', db));
    assert.equal(daily.importStatus, 'imported');
    assert.equal(daily.validationStatus, 'valid_with_warnings');
    assert.equal(daily.validRowCount, 1);
    const statuses = (await db.values('SELECT status FROM raw_records WHERE upload_id = ? ORDER BY row_number', daily.id));
    assert.deepEqual(statuses, ['invalid', 'invalid', 'valid', 'duplicate']);
    const valid = (await db.value('SELECT COUNT(*) FROM imported_data WHERE upload_id = ? AND is_valid = 1', daily.id));
    assert.equal(valid, 4); // only the 4 metrics of 2026-03-02 (first occurrence)

    const pages = (await one('p.csv', '上位のページ,クリック数,表示回数,CTR,掲載順位\nnot a url,1,10,10%,3\nhttps://x.jp/a,1,10,10%,3', 'GSC', db));
    assert.equal(pages.validRowCount, 1);
    assert.ok(pages.issues.some((i) => i.message.includes('Invalid URL')));
  });

  test('GA4 missing value and negative number are invalid', async () => {
    const csv = ['セグメント,A,A', '日付,セッション,e コマース購入数', '20260901,,5', '20260902,-3,5', '20260903,10,5'].join('\n');
    const u = (await one('g.csv', csv, 'GA4'));
    assert.equal(u.validRowCount, 1);
    assert.ok(u.issues.some((i) => i.message.includes('missing value')));
    assert.ok(u.issues.some((i) => i.message.includes('negative value')));
  });

  test('CTR inconsistent with clicks / impressions → warning', async () => {
    const u = (await one('q.csv', '上位のクエリ,クリック数,表示回数,CTR,掲載順位\nx,1,10,50%,3'));
    assert.ok(u.issues.some((i) => i.code === 'ctr-mismatch'));
  });
});

describe('formats', () => {
  test('Shift_JIS CSV is decoded', async () => {
    const sjis = new Uint8Array([0x93, 0xfa, 0x95, 0x74]); // 日付
    const rest = Buffer.from(',clicks,impressions\n2026-01-01,1,10\n');
    const u = (await one('s.csv', Buffer.concat([Buffer.from(sjis), rest])));
    assert.equal(u.structure, 'gsc-date');
    assert.equal(u.validRowCount, 1);
  });

  test('Excel workbook: each sheet detected separately', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['日付', 'クリック数', '表示回数', 'CTR', '掲載順位'], ['2026-01-01', 1, 10, '10%', 3]]), 'チャート');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['上位のクエリ', 'クリック数', '表示回数', 'CTR', '掲載順位'], ['ドスパラ', 5, 10, '50%', 1]]), 'クエリ');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const u = (await one('gsc.xlsx', buf));
    assert.equal(u.fileType, 'xlsx');
    assert.equal(u.structure, 'gsc-date, gsc-query');
    assert.equal(u.validRowCount, 2);
  });
});
