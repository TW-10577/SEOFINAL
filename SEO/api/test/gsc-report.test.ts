// Workflow separation: GA4 M1/M2 measurements + GA4 report, and the standalone GSC data view + GSC Performance Report.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createApp } from '../src/app.ts';
import { generateGscReport, gscOverview } from '../src/gsc-report.ts';
import { importFiles } from '../src/import/index.ts';
import { runMeasurements } from '../src/measure/engine.ts';
import { getMeasurementDetail, listAnomalies, listMeasurements } from '../src/measure/read.ts';
import { generateReport, renderText } from '../src/report.ts';
import { localize } from '../src/i18n.ts';
import { config, freshDb, ga4Csv, gscDailyCsv, importGa4, ontology, type WeekValues } from './helpers.ts';

const prev: WeekValues = { total: [1000, 10], organic: [500, 5], advertising: [100, 1] };
const organicDown: WeekValues = { total: [900, 10], organic: [400, 5], advertising: [100, 1] };

const table = (head: string, rows: [string, number, number, string, number][]) =>
  Buffer.from([`${head},クリック数,表示回数,CTR,掲載順位`, ...rows.map(([k, c, i, ctr, p]) => `${k},${c},${i},${ctr},${p}`)].join('\n'));
const queries = table('上位のクエリ', [['gaming pc', 500, 20000, '2.5%', 4.2], ['brand', 900, 3000, '30%', 1.1], ['laptop', 50, 90000, '0.06%', 9.5]]);
const pages = table('上位のページ', [['https://x.jp/', 700, 30000, '2.3%', 3], ['https://x.jp/a', 300, 40000, '0.8%', 6]]);
const devices = table('デバイス', [['モバイル', 800, 60000, '1.3%', 5], ['PC', 600, 50000, '1.2%', 4]]);
const flat = (n: number, c: number, i = 1000, p = 5) => Array.from({ length: n }, () => [c, i, p] as [number, number, number]);

async function post(app: ReturnType<typeof createApp>, path: string, body: unknown = {}) {
  return (await (await app.request(`/api${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })).json()) as any;
}

describe('GSC workflow: data view + GSC Performance Report, without GA4 measurements', () => {
  test('dated chart + snapshot exports → overview, report with comparison; no M1/M2, anomalies, causes or countermeasures', async () => {
    const db = await freshDb();
    const cfg = config();
    await importFiles(db, cfg, [
      { fileName: 'chart.csv', buffer: gscDailyCsv('2026-09-10', [...flat(7, 100, 1000, 5), ...flat(7, 70, 1000, 6)]) },
      { fileName: 'q.csv', buffer: queries }, { fileName: 'p.csv', buffer: pages }, { fileName: 'd.csv', buffer: devices },
    ], { source: 'GSC' });
    const ov = await gscOverview(db, cfg);
    assert.deepEqual(ov.daily.range, { start: '2026-09-10', end: '2026-09-23' });
    assert.equal(ov.daily.totals.clicks, 1190);
    assert.equal(ov.daily.totals.impressions, 14000);
    assert.ok(ov.snapshots.query.available && ov.snapshots.page.available && ov.snapshots.device.available);
    assert.equal(ov.snapshots.country.available, false);
    assert.equal(ov.snapshots.appearance.available, false);
    // Two complete weeks → a comparison; the values come from the data.
    assert.equal(ov.daily.comparison!.rows[0]!.previous, 700);
    assert.equal(ov.daily.comparison!.rows[0]!.current, 490);
    assert.equal(ov.daily.comparison!.rows[0]!.changeRate, -30);

    const r = await generateGscReport(db, cfg, 'en', renderText);
    assert.equal(r.source, 'GSC');
    assert.match(r.content, /GSC PERFORMANCE REPORT/);
    assert.match(r.content, /Period comparison: 2026-09-17 – 2026-09-23 vs 2026-09-10 – 2026-09-16/);
    assert.match(r.content, /Snapshot: whole period/);
    assert.match(r.content, /Search appearance data is not available/);
    assert.match(r.content, /High-impression queries with a CTR below 2%: laptop/);
    // Nothing from the GA4 judgment workflow leaks in.
    assert.doesNotMatch(r.content, /M1|M2|NOT EVALUABLE|Countermeasure|Sessions|CVR|hypothes/i);
    assert.equal((await listAnomalies(db)).length, 0);
    // GSC alone → no GA4 measurement is OK / NG.
    const runId = await runMeasurements(db, cfg);
    assert.ok((await listMeasurements(db, cfg, runId)).every((m) => m.status === 'NOT_EVALUABLE'));
  });

  test('files without dates → snapshots only, no weekly comparison, limitations stated', async () => {
    const db = await freshDb();
    const cfg = config();
    await importFiles(db, cfg, [{ fileName: 'q.csv', buffer: queries }, { fileName: 'd.csv', buffer: devices }], { source: 'GSC' });
    const ov = await gscOverview(db, cfg);
    assert.equal(ov.daily.available, false);
    assert.equal(ov.daily.comparison, null);
    assert.ok(ov.warnings.some((w) => w.code === 'no-wow'), 'import warning: no weekly comparison');
    const r = await generateGscReport(db, cfg, 'en', renderText);
    assert.match(r.content, /No dated chart.*no daily trend and no period comparison/);
    assert.match(r.content, /whole-period totals without dates/);
    assert.match(r.content, /Whole-period snapshot with no dates; it is not a daily trend/);
    assert.match(r.content, /cannot show weekly changes/);
    assert.doesNotMatch(r.content, /Period comparison/);
  });

  test('a single week of dated data → no period comparison', async () => {
    const db = await freshDb();
    const cfg = config();
    await importFiles(db, cfg, [{ fileName: 'chart.csv', buffer: gscDailyCsv('2026-09-10', flat(7, 100)) }], { source: 'GSC' });
    const ov = await gscOverview(db, cfg);
    assert.equal(ov.daily.comparison, null);
    assert.match((await generateGscReport(db, cfg, 'en', renderText)).content, /does not hold two complete 7-day periods/);
  });

  test('HTTP: /reports/gsc works with no measurement run; empty database explains itself', async () => {
    const db = await freshDb();
    const cfg = config();
    const app = createApp(db, cfg, ontology());
    const empty = await post(app, '/reports/gsc');
    assert.match(empty.content, /No Search Console data has been uploaded/);
    await importFiles(db, cfg, [{ fileName: 'd.csv', buffer: devices }], { source: 'GSC' });
    const r = await post(app, '/reports/gsc');
    assert.equal(r.source, 'GSC');
    const ov = (await (await app.request('/api/data/gsc-overview')).json()) as any;
    assert.equal(ov.snapshots.device.available, true);
    const dl = await app.request('/api/reports/gsc/download');
    assert.match(dl.headers.get('content-disposition')!, /LOGOS_GSC_Performance_Report/);
    // Records stay stored after generating (reports are generated views of persistent data).
    assert.equal((await gscOverview(db, cfg)).uploads.length, 1);
  });
});

describe('GA4 workflow: M1 / M2 → GA4 report with GSC supporting evidence', () => {
  async function setup(current: WeekValues, gsc?: Buffer) {
    const db = await freshDb();
    const cfg = config();
    await importGa4(db, cfg, ga4Csv(prev, current));
    if (gsc) await importFiles(db, cfg, [{ fileName: 'chart.csv', buffer: gsc }], { source: 'GSC' });
    return { db, cfg };
  }

  test('GA4 upload → M1/M2 → report built from the stored results (two rows only, no GSC rows)', async () => {
    const { db, cfg } = await setup(organicDown);
    const runId = await runMeasurements(db, cfg);
    const ms = await listMeasurements(db, cfg, runId);
    assert.deepEqual(ms.map((m) => m.ruleId), ['GA4_R01', 'GA4_R02']);
    assert.equal(ms[0]!.status, 'NG'); // sessions 1000 → 900 = -10% beyond ±3.9%
    const content = (await generateReport(db, cfg, runId, 'en')).content;
    assert.match(content, /Measurement Summary/i);
    assert.match(content, /NG/);
  });

  test('M1 NG + organic ↓ + dated GSC chart for the same weeks → evidence; weekly values from the file', async () => {
    const { db, cfg } = await setup(organicDown, gscDailyCsv('2026-09-10', [...flat(7, 100, 1000, 5), ...flat(7, 70, 1000, 6)]));
    const runId = await runMeasurements(db, cfg);
    const m1 = ms(await listMeasurements(db, cfg, runId));
    const g = localize((await getMeasurementDetail(db, cfg, m1.id))!, 'en').cause!.analysis!.gscEvidence!;
    assert.equal(g.dateChart.available, true);
    assert.equal(g.dateChart.metrics[0]!.changeRate, -30);
    const content = (await generateReport(db, cfg, runId, 'en')).content;
    assert.match(content, /Chart by Date \(same weeks\)/);
  });

  test('M1 NG + organic ↓ but GSC dates do not align → limitation, snapshots labelled as period totals, no causal claim', async () => {
    const { db, cfg } = await setup(organicDown, gscDailyCsv('2026-06-01', [...flat(14, 100)]));
    await importFiles(db, cfg, [{ fileName: 'q.csv', buffer: queries }], { source: 'GSC' });
    const runId = await runMeasurements(db, cfg);
    const d = localize((await getMeasurementDetail(db, cfg, ms(await listMeasurements(db, cfg, runId)).id))!, 'en');
    const g = d.cause!.analysis!.gscEvidence!;
    assert.equal(g.dateChart.available, false);
    assert.match(g.dateChart.reason!, /not the measured weeks/);
    assert.equal(d.cause!.analysis!.case, 'undetermined');
    assert.equal(d.cause!.reviewStatus, 'NotReviewed');
    const content = (await generateReport(db, cfg, runId, 'en')).content;
    assert.match(content, /snapshot, whole period/);
    assert.match(content, /Cause not conclusively determined/);
  });

  test('M1 NG + organic ↓ and no GSC upload → evidence is unavailable, not invented', async () => {
    const { db, cfg } = await setup(organicDown);
    const runId = await runMeasurements(db, cfg);
    const d = localize((await getMeasurementDetail(db, cfg, ms(await listMeasurements(db, cfg, runId)).id))!, 'en');
    assert.notEqual(d.cause?.analysis?.gscEvidence?.dateChart.available, true);
  });

  test('incomplete GA4 period → NOT EVALUABLE', async () => {
    const db = await freshDb();
    const cfg = config();
    // Only 5 days: no complete current + previous week.
    const csv = ga4Csv(prev, organicDown).toString('utf8').split('\n');
    const kept = [...csv.slice(0, 8), ...csv.slice(8).filter((l) => /^2026091[0-4]/.test(l))];
    await importGa4(db, cfg, Buffer.from(kept.join('\n')));
    const runId = await runMeasurements(db, cfg);
    assert.ok((await listMeasurements(db, cfg, runId)).every((m) => m.status === 'NOT_EVALUABLE'));
    assert.match((await generateReport(db, cfg, runId, 'en')).content, /NOT EVALUABLE/);
  });
});

const ms = (list: { ruleId: string; id: number }[]) => list.find((m) => m.ruleId === 'GA4_R01')!;
