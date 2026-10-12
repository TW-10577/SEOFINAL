// Active import context: Data, Measurements and Report follow the selected upload(s) and their own period.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createApp } from '../src/app.ts';
import { ga4Overview } from '../src/data.ts';
import { detectPeriods, withScope } from '../src/periods.ts';
import { config, freshDb, ga4Csv, importGa4, ontology } from './helpers.ts';

const flat = { total: [1000, 10], organic: [500, 5], advertising: [100, 1] } as const;
const down = { total: [940, 9], organic: [440, 4], advertising: [100, 1] } as const;

/** Two GA4 files: July (organic down) and September (flat). */
async function twoFiles() {
  const db = (await freshDb());
  const cfg = config();
  (await importGa4(db, cfg, ga4Csv(flat as any, down as any, '2026-07-01'), 'july.csv'));
  (await importGa4(db, cfg, ga4Csv(flat as any, flat as any, '2026-09-10'), 'september.csv'));
  const id = async (name: string) => (await db.value('SELECT id FROM uploads WHERE file_name = ?', name)) as number;
  return { db, cfg, july: (await id('july.csv')), september: (await id('september.csv')) };
}

describe('active import context', () => {
  test('periods come from the selected file, not the latest data', async () => {
    const { db, cfg, july } = (await twoFiles());
    assert.deepEqual((await detectPeriods(db, cfg, 'GA4')).periods[0]!.current, { start: '2026-09-17', end: '2026-09-23' }, 'all data: newest week');
    const scoped = (await detectPeriods(db, (await withScope(db, cfg, [july])), 'GA4'));
    assert.deepEqual(scoped.range, { start: '2026-07-01', end: '2026-07-14' });
    assert.deepEqual(scoped.periods.map((p) => p.current.end), ['2026-07-14']);
  });

  test('several files with different ranges: every file offers its own week', async () => {
    const { db, cfg, july, september } = (await twoFiles());
    const p = (await detectPeriods(db, (await withScope(db, cfg, [july, september])), 'GA4'));
    assert.deepEqual(p.periods.map((x) => x.current.end), ['2026-09-23', '2026-07-14']);
  });

  test('Data overview of the context uses only that file', async () => {
    const { db, cfg, july } = (await twoFiles());
    const o = (await ga4Overview(db, (await withScope(db, cfg, [july]))));
    assert.deepEqual(o.uploads.map((u) => u.fileName), ['july.csv']);
    assert.deepEqual(o.period, { start: '2026-07-01', end: '2026-07-14' });
    assert.equal(o.kpis.sessions, 7 * 1000 + 7 * 940);
  });

  test('a run for the context measures that file only and records its scope', async () => {
    const { db, cfg, july } = (await twoFiles());
    const app = createApp(db, cfg, ontology());
    const post = async (body: object) =>
      (await (await app.request('/api/measurements/run', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })).json()) as any;
    const res = await post({ uploadIds: [july], currentEnd: '2026-07-14', includeTestData: true });
    assert.deepEqual(res.run.current, { start: '2026-07-08', end: '2026-07-14' });
    assert.deepEqual(res.run.scope, { uploadIds: [july], files: ['july.csv'], includeTestData: true });
    assert.deepEqual(res.measurements.map((m: any) => m.status), ['NG', 'NG'], 'July data: sessions -6%');
    // Same context again: replaces the untouched run instead of adding another.
    await post({ uploadIds: [july], currentEnd: '2026-07-14', includeTestData: true });
    const runs = (await (await app.request('/api/measurement-runs')).json()) as any[];
    assert.equal(runs.filter((r) => r.current.end === '2026-07-14' && r.scope.uploadIds.join() === String(july)).length, 1);
  });

  test('upload: the new file is measured on its own week right away (not the latest week of other data)', async () => {
    const db = (await freshDb());
    const cfg = config();
    (await importGa4(db, cfg, ga4Csv(flat as any, flat as any, '2026-09-10'), 'september.csv'));
    const app = createApp(db, cfg, ontology());
    const form = new FormData();
    form.append('files', new File([new Uint8Array(ga4Csv(flat as any, down as any, '2026-07-01'))], 'july.csv'));
    const up = (await (await app.request('/api/uploads', { method: 'POST', body: form })).json()) as any;
    const run = ((await (await app.request('/api/measurement-runs')).json()) as any[]).find((r) => r.id === up.analysis.runId);
    assert.deepEqual(run.current, { start: '2026-07-08', end: '2026-07-14' });
    assert.deepEqual(run.scope.files, ['july.csv']);
  });

  test('API ?uploadIds scopes the Data endpoints', async () => {
    const { db, cfg, july } = (await twoFiles());
    const app = createApp(db, cfg, ontology());
    const get = async (p: string) => (await (await app.request(p)).json()) as any;
    const periods = await get(`/api/periods?uploadIds=${july}&includeTestData=1`);
    assert.equal(periods.GA4.periods[0].current.end, '2026-07-14');
    const trends = await get(`/api/data/trends?source=GA4&metric=sessions&uploadIds=${july}`);
    assert.ok(trends.every((s: any) => s.points.every((p: any) => p.date <= '2026-07-14')));
    const data = await get(`/api/data?uploadIds=${july}&limit=1000`);
    assert.ok(data.rows.length > 0 && data.rows.every((r: any) => r.uploadId === july));
  });
});

describe('runs without data', () => {
  test('no GA4 upload: Run measurements is refused and no run with empty dates is made', async () => {
    const db = (await freshDb());
    const app = createApp(db, config(), ontology());
    const res = await app.request('/api/measurements/run', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    assert.equal(res.status, 409);
    assert.match(((await res.json()) as any).error, /No GA4 data has been uploaded/);
    assert.equal(await db.value('SELECT COUNT(*) FROM measurement_runs'), 0);
  });

  test('deleting the last upload also removes runs left without data', async () => {
    const { db, cfg, july, september } = (await twoFiles());
    const app = createApp(db, cfg, ontology());
    const post = (body: object) => app.request('/api/measurements/run', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    assert.equal((await post({})).status, 201);
    // A run of a week the data does not cover: every rule NOT_EVALUABLE, no value used.
    assert.equal((await post({ currentEnd: '2026-12-31' })).status, 201);
    assert.equal(await db.value('SELECT COUNT(*) FROM measurement_runs'), 2);
    assert.equal((await app.request(`/api/uploads/${july}`, { method: 'DELETE' })).status, 200);
    assert.equal(await db.value('SELECT COUNT(*) FROM measurement_runs'), 2, 'September data is left: its runs stay');
    const last = (await (await app.request(`/api/uploads/${september}`, { method: 'DELETE' })).json()) as any;
    assert.equal(last.rerunId, null);
    assert.equal(await db.value('SELECT COUNT(*) FROM measurement_runs'), 0, 'no run with dates but no data is left');
    assert.equal(((await (await app.request('/api/measurement-runs')).json()) as unknown[]).length, 0);
  });
});
