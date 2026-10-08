// Analysis periods are detected from the uploaded data: no manual dates.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { importFiles } from '../src/import/index.ts';
import { runMeasurements } from '../src/measure/engine.ts';
import { getRun } from '../src/measure/read.ts';
import { comparison } from '../src/data.ts';
import { detectPeriods } from '../src/periods.ts';
import { GA4_DIR, GSC_DIR, clientFiles, config, freshDb, ga4Csv, gscDailyCsv, importGa4 } from './helpers.ts';

const W = { total: [1000, 10], organic: [500, 5], advertising: [100, 1] } as const;

describe('valid week-on-week periods', () => {
  test('test data left out (opt-out): real data 09-10–09-15 only (09-16–09-23 marked fake) → no valid period', async () => {
    const db = (await freshDb());
    const realOnly = config((c) => (c.dataPolicy.evaluateSyntheticData = false));
    (await importFiles(db, realOnly, clientFiles(GA4_DIR), {}));
    const p = (await detectPeriods(db, realOnly, 'GA4'));
    assert.deepEqual(p.range, { start: '2026-09-10', end: '2026-09-15' });
    assert.deepEqual(p.periods, []);
  });

  test('client GA4 file by default (uploaded data used, test dates labelled) → exactly one period: 09-17–09-23 vs 09-10–09-16', async () => {
    const db = (await freshDb());
    const cfg = config();
    (await importFiles(db, cfg, clientFiles(GA4_DIR), {}));
    const p = (await detectPeriods(db, cfg, 'GA4'));
    assert.deepEqual(p.range, { start: '2026-09-10', end: '2026-09-23' });
    assert.deepEqual(p.periods, [{ current: { start: '2026-09-17', end: '2026-09-23' }, previous: { start: '2026-09-10', end: '2026-09-16' } }]);
  });

  test('client GSC daily chart (92 days) → 12 non-overlapping weekly periods, newest first', async () => {
    const db = (await freshDb());
    (await importFiles(db, config(), clientFiles(GSC_DIR), {}));
    const p = (await detectPeriods(db, config(), 'GSC'));
    assert.equal(p.periods.length, 12);
    assert.equal(p.periods[0]!.current.end, '2026-09-15');
    assert.equal(p.periods[1]!.current.end, '2026-09-08');
  });

  test('a missing day makes the periods that include it invalid', async () => {
    const db = (await freshDb());
    const rows = Array.from({ length: 21 }, () => [100, 1000, 5] as [number, number, number]);
    (await importFiles(db, config(), [{ fileName: 'd.csv', buffer: gscDailyCsv('2026-09-01', rows) }], {}));
    assert.equal((await detectPeriods(db, config(), 'GSC')).periods.length, 2, '21 days → periods ending 09-21 and 09-14');
    const db2 = (await freshDb());
    const gap = [...rows.slice(0, 15), ...rows.slice(16)]; // drop 09-16
    const csv = gscDailyCsv('2026-09-01', rows).toString().split('\n').filter((l) => !l.startsWith('2026-09-16')).join('\n');
    (await importFiles(db2, config(), [{ fileName: 'd.csv', buffer: Buffer.from(csv) }], {}));
    assert.equal(gap.length, 20);
    assert.deepEqual((await detectPeriods(db2, config(), 'GSC')).periods.map((p) => p.current.end), ['2026-09-14'], 'the period ending 09-21 contains the missing 09-16; 09-01–09-14 is still complete');
  });

  test('less than 14 days → no valid period', async () => {
    const db = (await freshDb());
    (await importFiles(db, config(), [{ fileName: 'd.csv', buffer: gscDailyCsv('2026-09-01', Array.from({ length: 10 }, () => [1, 10, 5])) }], {}));
    const p = (await detectPeriods(db, config(), 'GSC'));
    assert.equal(p.periods.length, 0);
    assert.deepEqual(p.range, { start: '2026-09-01', end: '2026-09-10' });
  });
});

describe('analysis uses the detected period by default', () => {
  test('measurement run without dates measures the newest valid GA4 period', async () => {
    const db = (await freshDb());
    const cfg = config();
    (await importGa4(db, cfg, ga4Csv(W as any, W as any)));
    const run = (await getRun(db, (await runMeasurements(db, cfg))))!;
    assert.deepEqual(run.current, { start: '2026-09-17', end: '2026-09-23' });
  });

  test('Data page comparison: each source uses its own newest valid period', async () => {
    const db = (await freshDb());
    const cfg = config((c) => (c.dataPolicy.evaluateSyntheticData = false)); // real days only (opt-out)
    (await importFiles(db, cfg, clientFiles(GA4_DIR), {}));
    (await importFiles(db, cfg, clientFiles(GSC_DIR), {}));
    const c = (await comparison(db, cfg));
    assert.equal(c.periods.GA4, null, 'only 6 real GA4 days (fake dates excluded): no complete period, so no made-up comparison');
    assert.ok(!c.rows.some((r) => r.source === 'GA4'));
    const test = (await comparison(db, { ...cfg, dataPolicy: { evaluateSyntheticData: true } }));
    assert.equal(test.periods.GA4!.current.end, '2026-09-23', 'with test data: the file\'s two weeks');
    assert.match(test.rows.find((r) => r.source === 'GA4' && r.metric === 'sessions' && r.subjectType === 'site')!.note!, /Test data/);
    assert.equal(c.periods.GSC!.current.end, '2026-09-15');
    const older = (await comparison(db, cfg, { gscEnd: '2026-09-08' }));
    assert.equal(older.periods.GSC!.current.end, '2026-09-08');
    assert.equal(older.periods.GA4, null, 'choosing a GSC period does not move GA4');
  });
});
