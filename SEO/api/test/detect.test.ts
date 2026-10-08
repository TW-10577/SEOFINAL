// Upload → detect GA4 / GSC from the contents → apply that source's rules → analyse → result.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createApp } from '../src/app.ts';
import { detectSource } from '../src/import/detect.ts';
import { localize } from '../src/i18n.ts';
import { GA4_DIR, GSC_DIR, clientFiles, config, freshDb, ontology } from './helpers.ts';

const grid = (rows: string[][]) => ({ name: '', rows });

describe('source detection from contents (not the file name)', () => {
  test('GA4 Explorations layout → GA4 by layout', () => {
    const d = detectSource(grid([['セグメント', '通販（全体）'], ['日付', 'セッション'], ['20260901', '10']]));
    assert.deepEqual([d.source, d.method], ['GA4', 'layout']);
  });
  test('Search Console layout → GSC by layout', () => {
    const d = detectSource(grid([['上位のクエリ', 'クリック数', '表示回数', 'CTR', '掲載順位']]));
    assert.deepEqual([d.source, d.method], ['GSC', 'layout']);
  });
  test('GA4 fields only (sessions, users, conversions) → GA4 by fields', () => {
    const d = detectSource(grid([['date', 'sessions', 'activeUsers', 'conversions']]));
    assert.deepEqual([d.source, d.method], ['GA4', 'fields']);
    assert.deepEqual(d.signals, ['sessions', 'activeUsers', 'conversions']);
  });
  test('GSC fields only (clicks, impressions, CTR) → GSC by fields', () => {
    const d = detectSource(grid([['keyword', 'clicks', 'impressions', 'CTR']]));
    assert.deepEqual([d.source, d.method], ['GSC', 'fields']);
  });
  test('no clear evidence → Unknown', () => {
    assert.equal(detectSource(grid([['name', 'value'], ['a', '1']])).source, null);
    assert.equal(detectSource(grid([['sessions', 'clicks']])).source, null, 'one field each is not confident');
  });
});

describe('API: detect → apply rules → analyse', () => {
  async function post(app: ReturnType<typeof createApp>, files: { fileName: string; buffer: Buffer }[], name = 'data.csv') {
    const form = new FormData();
    for (const f of files) form.append('files', new File([new Uint8Array(f.buffer)], name === 'keep' ? f.fileName : name));
    const res = await app.request('/api/uploads', { method: 'POST', body: form });
    return (await res.json()) as any;
  }

  // The client's GA4 file marks 09-16–09-23 as fake: these API tests run in test-data mode to reach a judgment.
  const testMode = () => config((c) => (c.dataPolicy.evaluateSyntheticData = true));

  test('a GA4 file named data.csv is detected as GA4 and judged by GA4 rules ① ②', async () => {
    const app = createApp((await freshDb()), testMode(), ontology());
    const ga4 = clientFiles(GA4_DIR).find((f) => f.fileName.startsWith('Two Weeks'))!;
    const r = await post(app, [ga4]);
    const a = localize(r.analysis.uploads[0], 'en');
    assert.equal(r.uploads[0].source, 'GA4');
    assert.equal(a.detectedBy, 'layout');
    assert.deepEqual(a.appliedRules.map((x: any) => [x.ruleId, x.role]), [['GA4_R01', 'judgment'], ['GA4_R02', 'judgment']]);
    assert.deepEqual(a.results.map((x: any) => x.status), ['NG', 'NG']);
    assert.ok(a.validation.includes('Required column: Sessions'), 'English names the client column in English');
  });

  test('a GSC file named data.csv is detected as GSC: supporting evidence for rule ①, never judged by GA4 rules', async () => {
    const app = createApp((await freshDb()), config(), ontology());
    const query = clientFiles(GSC_DIR).find((f) => f.fileName === 'クエリ.csv')!;
    const r = await post(app, [query]);
    const a = localize(r.analysis.uploads[0], 'en');
    assert.equal(r.uploads[0].source, 'GSC');
    assert.deepEqual(a.appliedRules.map((x: any) => [x.ruleId, x.role]), [['GA4_R01', 'supporting_evidence']]);
    assert.equal(a.results.length, 0);
    assert.match(a.note, /No GA4 data has been uploaded yet/);
  });

  test('GSC after GA4: used as evidence for the rule ① anomaly', async () => {
    const app = createApp((await freshDb()), testMode(), ontology());
    await post(app, clientFiles(GA4_DIR), 'keep');
    const r = await post(app, clientFiles(GSC_DIR), 'keep');
    const query = localize(r.analysis.uploads.find((u: any) => u.fileName === 'クエリ.csv'), 'en');
    assert.equal(query.results[0].status, 'NG');
    assert.match(query.note, /Used by the GSC investigation for anomaly #\d+ \(GA4_R01 NG with organic sessions decreasing\)/);
  });

  test('Unknown source → the user selects GSC → analysed with GSC rules', async () => {
    const app = createApp((await freshDb()), config(), ontology());
    // Search Console data whose first column is not a recognised dimension: fields alone are not enough here.
    const csv = 'item,clicks\nドスパラ,608963';
    const r = await post(app, [{ fileName: 'x.csv', buffer: Buffer.from(csv) }]);
    assert.equal(r.uploads[0].source, null);
    assert.equal(r.uploads[0].issues[0].code, 'unknown-source');
    assert.match(localize(r.analysis.uploads[0], 'en').note, /Source: Unknown/);
    const chosen = (await (await app.request(`/api/uploads/${r.uploads[0].id}/source`, { method: 'POST', body: '{"source":"GSC"}', headers: { 'content-type': 'application/json' } })).json()) as any;
    const u = chosen.uploads[0];
    assert.equal(u.source, 'GSC');
    assert.equal(u.metadata.detection.method, 'user');
    // The GSC parser is applied (not GA4); this table is still not a Search Console layout, and says so.
    assert.equal(u.issues[0].code, 'unsupported-layout');
    assert.equal((await app.request(`/api/uploads/${r.uploads[0].id}`)).status, 404, 'the unknown upload was replaced');
  });

  test('a selection that contradicts the contents is refused', async () => {
    const app = createApp((await freshDb()), config(), ontology());
    const form = new FormData();
    form.set('source', 'GA4');
    form.append('files', new File([new Uint8Array(clientFiles(GSC_DIR).find((f) => f.fileName === "クエリ.csv")!.buffer)], 'q.csv'));
    const r = (await (await app.request('/api/uploads', { method: 'POST', body: form })).json()) as any;
    assert.equal(r.uploads[0].issues[0].code, 'source-mismatch');
  });

  test('an imported upload cannot be re-sourced', async () => {
    const app = createApp((await freshDb()), config(), ontology());
    const r = await post(app, [clientFiles(GA4_DIR)[0]!], 'keep');
    const res = await app.request(`/api/uploads/${r.uploads[0].id}/source`, { method: 'POST', body: '{"source":"GSC"}', headers: { 'content-type': 'application/json' } });
    assert.equal(res.status, 409);
  });
});
