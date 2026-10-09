// Rows of one Search Console file for the formatted Excel report: every valid row and column; GA4 is refused.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createApp } from '../src/app.ts';
import { importFiles } from '../src/import/index.ts';
import { config, freshDb, ga4Csv, importGa4, ontology } from './helpers.ts';

const pages = ['上位のページ,クリック数,表示回数,CTR,掲載順位', ...Array.from({ length: 25 }, (_, i) => `https://x.jp/p${i},${100 - i},${1000 + i},10%,${(i + 1).toFixed(2)}`), 'not a url,1,10,10%,3'].join('\n');

async function setup() {
  const db = await freshDb();
  const cfg = config();
  const [u] = await importFiles(db, cfg, [{ fileName: 'ページ.csv', buffer: Buffer.from(pages) }], { source: 'GSC' });
  return { db, cfg, app: createApp(db, cfg, ontology()), id: u!.id };
}

describe('GSC report data', () => {
  test('all valid rows (not a top 10), all columns in file order, numbers as numbers', async () => {
    const { app, id } = await setup();
    const res = await app.request(`/api/uploads/${id}/export?table=gsc-page`);
    assert.equal(res.status, 200);
    const d = (await res.json()) as any;
    assert.equal(d.fileName, 'ページ.csv');
    assert.deepEqual(d.columns, ['上位のページ', 'クリック数', '表示回数', 'CTR', '掲載順位']);
    assert.equal(d.rows.length, 25, 'the invalid URL row is left out');
    assert.deepEqual(d.rows[0], ['https://x.jp/p0', 100, 1000, '10%', 1]);
  });

  test('filter: only rows whose dimension contains it (case-insensitive); no match → 404', async () => {
    const { app, id } = await setup();
    const d = (await (await app.request(`/api/uploads/${id}/export?table=gsc-page&search=${encodeURIComponent('X.JP/P1')}`)).json()) as any;
    assert.deepEqual(d.rows.map((r: any) => r[0]), ['p1', ...Array.from({ length: 10 }, (_, i) => `p1${i}`)].map((p) => `https://x.jp/${p}`));
    assert.equal((await app.request(`/api/uploads/${id}/export?table=gsc-page&search=nothing`)).status, 404);
  });

  test('GA4 upload or unknown table is refused', async () => {
    const { db, cfg, app, id } = await setup();
    const flat = { total: [1000, 10], organic: [500, 5], advertising: [100, 1] };
    await importGa4(db, cfg, ga4Csv(flat as any, flat as any, '2026-09-10'), 'ga4.csv');
    const ga4 = (await db.value('SELECT id FROM uploads WHERE file_name = ?', 'ga4.csv')) as number;
    assert.equal((await app.request(`/api/uploads/${ga4}/export?table=gsc-page`)).status, 400);
    assert.equal((await app.request(`/api/uploads/${id}/export?table=gsc-query`)).status, 404);
  });
});
