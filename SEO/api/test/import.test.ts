// Receive SEO Data / Check and Standardize Data, on the client files and on invalid input.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as XLSX from 'xlsx';
import { importFiles } from '../src/import/index.ts';
import { GA4_DIR, GSC_DIR, clientFiles, config, freshDb } from './helpers.ts';

const one = (fileName: string, text: string | Buffer, source: 'GA4' | 'GSC' = 'GSC', db = freshDb()) =>
  importFiles(db, config(), [{ fileName, buffer: Buffer.isBuffer(text) ? text : Buffer.from(text) }], { source })[0]!;

describe('client files', () => {
  test('GA4 two-week export: 14 daily rows, totals row kept, synthetic-data note surfaced', () => {
    const db = freshDb();
    const uploads = importFiles(db, config(), clientFiles(GA4_DIR), { source: 'GA4' });
    const u = uploads.find((x) => x.fileName.startsWith('Two Weeks'))!;
    assert.equal(u.importStatus, 'imported');
    assert.equal(u.rowCount, 14);
    assert.deepEqual(u.period, { start: '2026-09-10', end: '2026-09-23' });
    assert.ok(u.issues.some((i: { code: string }) => i.code === 'synthetic-data'));
    assert.ok(!u.issues.some((i) => i.code === 'totals-mismatch'), 'daily rows reconcile with the 総計 row');
    const raw = db.prepare(`SELECT status, COUNT(*) n FROM raw_records WHERE upload_id = ? GROUP BY status`).all(u.id);
    assert.deepEqual(raw, [{ status: 'total', n: 1 }, { status: 'valid', n: 14 }]);
    // Columns identified by header text, not position.
    const organic = db.prepare(`SELECT metric_value FROM imported_data WHERE upload_id = ? AND segment = '通販（全体） オーガニックサーチ' AND metric_name = 'sessions' AND data_date = '2026-09-10'`).pluck().get(u.id);
    assert.equal(organic, 50653);
  });

  test('GA4 export without a date column: period from the export header, trailing 総計 tag recognised', () => {
    const u = importFiles(freshDb(), config(), clientFiles(GA4_DIR), { source: 'GA4' }).find((x) => x.fileName.startsWith('download'))!;
    assert.equal(u.rowCount, 1);
    assert.deepEqual(u.period, { start: '2026-09-12', end: '2026-09-13' });
  });

  test('GSC tabs detected from contents; undated tabs take the daily chart period from the same batch', () => {
    const uploads = importFiles(freshDb(), config(), clientFiles(GSC_DIR), { source: 'GSC' });
    const by = Object.fromEntries(uploads.map((u) => [u.structure, u]));
    assert.deepEqual(Object.keys(by).sort(), ['gsc-appearance', 'gsc-country', 'gsc-date', 'gsc-device', 'gsc-filter', 'gsc-page', 'gsc-query']);
    assert.equal(by['gsc-date']!.rowCount, 92);
    assert.deepEqual(by['gsc-query']!.period, { start: '2026-06-16', end: '2026-09-15' });
    assert.match(by['gsc-query']!.periodNote!, /daily chart/);
    assert.ok(by['gsc-query']!.issues.some((i: { code: string; message: string }) => i.code === 'row-cap'));
    assert.deepEqual((by['gsc-filter']!.metadata['gsc-filter'] as any).filters, { 検索タイプ: 'ウェブ', 日付: '過去 3 か月間' });
  });

  test('duplicate record in client data is flagged, not silently merged (国.csv ドミニカ)', () => {
    const u = importFiles(freshDb(), config(), clientFiles(GSC_DIR), { source: 'GSC' }).find((x) => x.structure === 'gsc-country')!;
    assert.equal(u.rowCount - u.validRowCount, 1);
    assert.ok(u.issues.some((i) => i.code === 'duplicate' && i.message.includes('ドミニカ')));
  });
});

describe('invalid imported data', () => {
  test('unsupported file type → rejected', () => {
    const u = one('report.pdf', 'x');
    assert.equal(u.importStatus, 'rejected');
    assert.equal(u.issues[0]!.code, 'unsupported-type');
  });

  test('empty file → rejected', () => {
    assert.equal(one('a.csv', '').issues[0]!.code, 'empty');
  });

  test('unrecognised structure → rejected', () => {
    assert.equal(one('a.csv', 'foo,bar\n1,2').issues[0]!.code, 'unknown-structure');
  });

  test('source mismatch → rejected', () => {
    assert.equal(one('a.csv', '上位のクエリ,クリック数,表示回数\nx,1,2', 'GA4').issues[0]!.code, 'source-mismatch');
  });

  test('missing required column → rejected', () => {
    const u = one('a.csv', '上位のクエリ,クリック数\nx,1');
    assert.equal(u.importStatus, 'rejected');
    assert.equal(u.issues[0]!.code, 'missing-column');
  });

  test('invalid date, invalid number, invalid URL, duplicate → rows kept but never valid', () => {
    const db = freshDb();
    const daily = one('d.csv', '日付,クリック数,表示回数,CTR,掲載順位\n2026-02-30,1,10,10%,3\n2026-03-01,abc,10,10%,3\n2026-03-02,1,10,10%,3\n2026-03-02,1,10,10%,3', 'GSC', db);
    assert.equal(daily.importStatus, 'imported');
    assert.equal(daily.validationStatus, 'valid_with_warnings');
    assert.equal(daily.validRowCount, 1);
    const statuses = db.prepare('SELECT status FROM raw_records WHERE upload_id = ? ORDER BY row_number').pluck().all(daily.id);
    assert.deepEqual(statuses, ['invalid', 'invalid', 'valid', 'duplicate']);
    const valid = db.prepare('SELECT COUNT(*) FROM imported_data WHERE upload_id = ? AND is_valid = 1').pluck().get(daily.id);
    assert.equal(valid, 4); // only the 4 metrics of 2026-03-02 (first occurrence)

    const pages = one('p.csv', '上位のページ,クリック数,表示回数,CTR,掲載順位\nnot a url,1,10,10%,3\nhttps://x.jp/a,1,10,10%,3', 'GSC', db);
    assert.equal(pages.validRowCount, 1);
    assert.ok(pages.issues.some((i) => i.message.includes('Invalid URL')));
  });

  test('GA4 missing value and negative number are invalid', () => {
    const csv = ['セグメント,A,A', '日付,セッション,e コマース購入数', '20260901,,5', '20260902,-3,5', '20260903,10,5'].join('\n');
    const u = one('g.csv', csv, 'GA4');
    assert.equal(u.validRowCount, 1);
    assert.ok(u.issues.some((i) => i.message.includes('missing value')));
    assert.ok(u.issues.some((i) => i.message.includes('negative value')));
  });

  test('CTR inconsistent with clicks / impressions → warning', () => {
    const u = one('q.csv', '上位のクエリ,クリック数,表示回数,CTR,掲載順位\nx,1,10,50%,3');
    assert.ok(u.issues.some((i) => i.code === 'ctr-mismatch'));
  });
});

describe('formats', () => {
  test('Shift_JIS CSV is decoded', () => {
    const sjis = new Uint8Array([0x93, 0xfa, 0x95, 0x74]); // 日付
    const rest = Buffer.from(',clicks,impressions\n2026-01-01,1,10\n');
    const u = one('s.csv', Buffer.concat([Buffer.from(sjis), rest]));
    assert.equal(u.structure, 'gsc-date');
    assert.equal(u.validRowCount, 1);
  });

  test('Excel workbook: each sheet detected separately', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['日付', 'クリック数', '表示回数', 'CTR', '掲載順位'], ['2026-01-01', 1, 10, '10%', 3]]), 'チャート');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['上位のクエリ', 'クリック数', '表示回数', 'CTR', '掲載順位'], ['ドスパラ', 5, 10, '50%', 1]]), 'クエリ');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const u = one('gsc.xlsx', buf);
    assert.equal(u.fileType, 'xlsx');
    assert.equal(u.structure, 'gsc-date, gsc-query');
    assert.equal(u.validRowCount, 2);
  });
});
