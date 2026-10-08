// GSC is supporting evidence for rule ① only when organic traffic decreases (SEO.txt).
import assert from 'node:assert/strict';
import type { DB } from '../src/db.ts';
import { describe, test } from 'node:test';
import { importFiles } from '../src/import/index.ts';
import { localize } from '../src/i18n.ts';
import { runMeasurements } from '../src/measure/engine.ts';
import { getMeasurementDetail, listAnomalies, listMeasurements } from '../src/measure/read.ts';
import { GSC_DIR, clientFiles, config, freshDb, ga4Csv, gscDailyCsv, importGa4, type WeekValues } from './helpers.ts';

const prev: WeekValues = { total: [1000, 10], organic: [500, 5], advertising: [100, 1] };
const organicDown: WeekValues = { total: [900, 10], organic: [400, 5], advertising: [100, 1] };

async function setup(current: WeekValues) {
  const db = (await freshDb());
  const cfg = config();
  (await importGa4(db, cfg, ga4Csv(prev, current)));
  (await importFiles(db, cfg, clientFiles(GSC_DIR), { source: 'GSC' }));
  return { db, cfg };
}

async function rule1(db: DB, cfg: ReturnType<typeof config>, runId: number) {
  return localize((await getMeasurementDetail(db, cfg, (await listMeasurements(db, cfg, runId)).find((m) => m.ruleId === 'GA4_R01')!.id))!, 'en');
}

describe('GSC supporting evidence for rule ① (M1 NG + organic ↓): date chart + snapshots', () => {
  test('snapshots from the client files: pages, queries, devices, countries — no dates, no OK / NG', async () => {
    const { db, cfg } = (await setup(organicDown));
    const g = (await rule1(db, cfg, (await runMeasurements(db, cfg)))).cause!.analysis!.gscEvidence!;
    // Pages: share of site clicks reproduces SEO.txt (top page 19.6%, /gamepc 7.1%).
    assert.deepEqual(g.pages.top.slice(0, 2).map((r) => [r.key, r.share]), [['https://www.dospara.co.jp/', 19.6], ['https://www.dospara.co.jp/gamepc', 7.1]]);
    assert.equal(g.pages.bottom.length, 5, 'lowest pages too');
    assert.match(g.pages.note!, /no dates.*1,000 rows/);
    // Queries: brand share ≈ 66% (provisional term list, flagged).
    assert.equal(g.queries.top[0]!.key, 'ドスパラ');
    assert.equal(g.queries.top[0]!.classification, 'brand');
    assert.equal(g.queries.brandShare, 65.9);
    assert.ok(g.queries.brandCaveat);
    // Devices: distribution that sums to 100%.
    assert.deepEqual(g.devices.top.map((r) => r.key).sort(), ['PC', 'タブレット', 'モバイル'].sort());
    assert.ok(Math.abs(g.devices.top.reduce((a, r) => a + r.share!, 0) - 100) < 0.5);
    // Countries: Japan first, the rest folded into Other.
    assert.equal(g.countries.top[0]!.key, '日本');
    assert.ok(g.countries.other, 'other countries summed');
    assert.match(g.note, /not a separate measurement/);
  });

  test('date chart not covering the measured weeks → reference only; cause not determined; no countermeasure', async () => {
    const { db, cfg } = (await setup(organicDown));
    const d = (await rule1(db, cfg, (await runMeasurements(db, cfg))));
    const chart = d.cause!.analysis!.gscEvidence!.dateChart;
    assert.equal(chart.available, false);
    assert.match(chart.reason!, /covers 2026-06-16 – 2026-09-15, not the measured weeks/);
    assert.equal(chart.reference, true, 'latest chart weeks shown for reference');
    assert.equal(d.cause!.analysis!.case, 'undetermined');
    assert.equal(d.countermeasures.length, 2, 'the rules.yaml branch countermeasure + the GSC_R01 countermeasure');
    assert.equal(d.cause!.analysis!.investigation!.confidence, 'insufficient_data', 'no weekly GSC exports, chart not covering the weeks');
    assert.ok(d.cause!.analysis!.missing.some((m) => /GSC Chart by Date .* does not cover these weeks/.test(m)));
  });

  test('date chart covering the weeks: clicks ↓, impressions ↓, CTR same, position worse → organic search performance decreased', async () => {
    const db = (await freshDb());
    const cfg = config();
    (await importGa4(db, cfg, ga4Csv(prev, organicDown)));
    // The example: clicks 100,000 → 90,000, impressions 2,000,000 → 1,800,000, CTR 5.0% → 5.0%, position 5.5 → 6.2 (per week).
    const day = (c: number, i: number, p: number) => Array.from({ length: 7 }, () => [c / 7, i / 7, p] as [number, number, number]);
    (await importFiles(db, cfg, [{ fileName: 'chart.csv', buffer: gscDailyCsv('2026-09-10', [...day(100000, 2000000, 5.5), ...day(90000, 1800000, 6.2)]) }], { source: 'GSC' }));
    const d = (await rule1(db, cfg, (await runMeasurements(db, cfg))));
    const chart = d.cause!.analysis!.gscEvidence!.dateChart;
    assert.equal(chart.available, true);
    assert.deepEqual(chart.metrics.map((m) => [m.metric, m.direction]), [['clicks', 'down'], ['impressions', 'down'], ['ctr', 'same'], ['position', 'worse']]);
    assert.equal(chart.metrics[0]!.changeRate, -10);
    assert.match(chart.summary!, /^Organic search performance decreased/);
    assert.deepEqual(chart.indications, ['ranking', 'search_demand']);
    assert.equal(chart.indicationText, 'Possible indication: ranking / search demand.');
    assert.equal(d.cause!.analysis!.case, 'search_decline');
    assert.equal(d.cause!.analysis!.title, 'Organic Sessions decreased while Advertising Sessions did not decrease.');
    assert.equal(d.cause!.confidence, 'High');
    assert.equal(d.cause!.reviewStatus, 'NotReviewed');
    assert.deepEqual(d.countermeasures.map((k) => [k.actionText, k.status]), [
      ['Investigate the Organic traffic decrease using GSC. Identify affected queries and pages and check impressions, clicks, CTR, and position.', 'Proposed'],
      // GSC_R01 needs query / page / device exports for the two weeks; the chart alone matches no priority condition.
      ['Do not assign a definitive cause. Report the observed performance changes and recommend further investigation.', 'Proposed'],
    ]);
    assert.equal(d.cause!.analysis!.investigation!.signals.position_drop, true);
  });

  test('organic not decreasing → GSC is not used', async () => {
    const { db, cfg } = (await setup({ total: [900, 10], organic: [500, 5], advertising: [0, 1] }));
    const d = (await rule1(db, cfg, (await runMeasurements(db, cfg))));
    assert.equal(d.cause?.branch, 'advertising_traffic_decrease');
    assert.equal(d.cause!.analysis, null, 'GSC only when organic decreased');
    assert.equal(d.countermeasures[0]!.responsibleTeam, 'Advertising team');
  });

  test('rule ② never has GSC evidence', async () => {
    const { db, cfg } = (await setup(organicDown));
    const runId = (await runMeasurements(db, cfg));
    const m2 = (await listMeasurements(db, cfg, runId)).find((m) => m.ruleId === 'GA4_R02')!;
    assert.equal((await getMeasurementDetail(db, cfg, m2.id))!.cause?.analysis ?? null, null);
    assert.equal((await listMeasurements(db, cfg, runId)).length, 2, 'GSC is never a measurement row');
  });

  test('GSC alone never produces a measurement result or anomaly', async () => {
    const db = (await freshDb());
    const cfg = config();
    (await importFiles(db, cfg, clientFiles(GSC_DIR), { source: 'GSC' }));
    const runId = (await runMeasurements(db, cfg));
    assert.ok((await listMeasurements(db, cfg, runId)).every((m) => m.status === 'NOT_EVALUABLE'));
    assert.equal((await listAnomalies(db)).length, 0);
  });

  test('GSC data without a time dimension is flagged as having no WoW', async () => {
    const db = (await freshDb());
    const [u] = (await importFiles(db, config(), clientFiles(GSC_DIR).filter((f) => f.fileName === 'クエリ.csv'), { source: 'GSC' }));
    assert.ok(u!.issues.some((i) => i.code === 'no-wow'));
    assert.ok(u!.issues.some((i) => i.code === 'no-period'), 'period unknown without the daily chart or an entered period');
  });
});
