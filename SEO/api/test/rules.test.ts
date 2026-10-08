// rules.yaml (GA4_Rule_01 Sessions, GA4_Rule_02 CVR) through the full measurement engine:
// every evaluation / source_analysis / pattern_analysis branch, with the cause, countermeasure and team it defines.
import assert from 'node:assert/strict';
import type { DB } from '../src/db.ts';
import { describe, test } from 'node:test';
import { localize } from '../src/i18n.ts';
import { evalCondition, evalNumber } from '../src/measure/expr.ts';
import { runMeasurements } from '../src/measure/engine.ts';
import { getMeasurementDetail, listMeasurements } from '../src/measure/read.ts';
import { importFiles } from '../src/import/index.ts';
import { config, freshDb, ga4Csv, importGa4, type WeekValues } from './helpers.ts';

const R1 = 'GA4_R01';
const R2 = 'GA4_R02';

const week = (total: [number, number], organic: [number, number], advertising: [number, number]): WeekValues => ({ total, organic, advertising });

async function measure(prev: WeekValues, cur: WeekValues, cfg = config(), gsc?: (db: DB) => unknown) {
  const db = (await freshDb());
  (await importGa4(db, cfg, ga4Csv(prev, cur)));
  await gsc?.(db);
  const runId = (await runMeasurements(db, cfg));
  const ms = (await listMeasurements(db, cfg, runId));
  const detail = async (ruleId: string) => localize((await getMeasurementDetail(db, cfg, ms.find((m) => m.ruleId === ruleId)!.id))!, 'en');
  return { r1: (await detail(R1)), r2: (await detail(R2)) };
}

/** Sessions only: CV kept proportional so rule ② stays quiet. */
const sessions = (total: number, organic: number, advertising: number) => week([total, total / 10], [organic, organic / 10], [advertising, advertising / 10]);

describe('rules.yaml is loaded as written', () => {
  test('two GA4 rules with their thresholds and required GA4 columns', () => {
    const cfg = config();
    assert.deepEqual(cfg.rules.map((r) => [r.id, r.metric, r.thresholdValue, r.thresholdUnit]), [
      [R1, 'sessions', 3.9, 'percent'],
      [R2, 'cvr', 0.7, 'percent'],
    ]);
    assert.equal(cfg.segments.organic.value, '通販（全体） オーガニックサーチ');
    assert.deepEqual(cfg.investigations.map((x) => [x.id, x.trigger.ruleId, x.checks.length, x.priority.length]), [['GSC_R01', R1, 4, 6]]);
    assert.equal(cfg.segments.advertising.value, '通販（全体） ペイド系合算');
    assert.deepEqual(cfg.specs[R2]!.fields.map((f) => [f.key, f.segment, f.sourceMetric, f.metric]), [
      ['sessions', '通販（全体）', 'セッション', 'sessions'],
      ['purchases', '通販（全体）', 'e コマース購入数', 'ecommerce_purchases'],
    ]);
  });

  test('expressions: AND, abs(), unknown values never decide', () => {
    assert.equal(evalCondition('abs(x) < 3.9', { x: -3.8 }), true);
    assert.equal(evalCondition('x <= -3.9', { x: -3.9000000000000004 }), true);
    assert.equal(evalCondition('a < 0 AND b >= 0', { a: -1, b: 0 }), true);
    assert.equal(evalCondition('a < 0 AND b >= 0', { a: -1 }), null);
    assert.equal(evalNumber('((c - p) / p) * 100', { c: 5, p: 0 }), null);
  });
});

describe('GA4_Rule_01 Traffic Acquisition — Sessions', () => {
  test('|WoW| < 3.9% → OK, no anomaly', async () => {
    const { r1 } = (await measure(sessions(1000, 500, 100), sessions(962, 480, 100)));
    assert.equal(r1.measurement.status, 'OK');
    assert.equal(r1.anomaly, null);
  });

  test('exactly −3.9% → NG', async () => {
    const { r1 } = (await measure(sessions(1000, 500, 100), sessions(961, 480, 100)));
    assert.equal(r1.measurement.status, 'NG');
  });

  test('increase ≥ 3.9% → NG improvement, primary contributor = larger positive change', async () => {
    const { r1 } = (await measure(sessions(1000, 500, 100), sessions(1050, 520, 130)));
    assert.equal(r1.measurement.status, 'NG');
    assert.equal(r1.cause!.branch, 'traffic_increase');
    // rules.yaml gives only the cause type: the cause reads as the type and the primary contributor.
    assert.equal(r1.cause!.causeText, 'Traffic increase — primary contributor: Advertising traffic (+210 sessions).');
    assert.match(r1.countermeasures[0]!.actionText, /^Review the traffic source with the larger increase/);
    assert.equal(r1.countermeasures[0]!.targetType, 'traffic_source', 'the contributor is the target');
    assert.equal(r1.countermeasures[0]!.responsibleTeam, null);
  });

  test('organic ↓, advertising not ↓ → organic decrease, SEO team', async () => {
    const { r1 } = (await measure(sessions(1000, 500, 100), sessions(950, 450, 110)));
    assert.equal(r1.cause!.branch, 'organic_traffic_decrease');
    assert.equal(r1.countermeasures[0]!.responsibleTeam, 'SEO team');
    assert.equal(r1.countermeasures[0]!.targetType, 'traffic_source');
    assert.match(r1.countermeasures[0]!.reason, /Organic traffic decreased compared with the previous week/);
  });

  test('advertising ↓, organic not ↓ → advertising decrease, Advertising team', async () => {
    const { r1 } = (await measure(sessions(1000, 500, 100), sessions(950, 510, 60)));
    assert.equal(r1.cause!.branch, 'advertising_traffic_decrease');
    assert.equal(r1.countermeasures[0]!.responsibleTeam, 'Advertising team');
  });

  test('both ↓, organic decrease larger → organic primary', async () => {
    const { r1 } = (await measure(sessions(1000, 500, 100), sessions(940, 440, 80)));
    assert.equal(r1.cause!.branch, 'both_traffic_sources_decreased:organic_primary');
    assert.match(r1.countermeasures[0]!.actionText, /^Investigate Organic traffic using GSC/);
    assert.equal(r1.countermeasures[0]!.responsibleTeam, 'SEO team');
  });

  test('both ↓, advertising decrease larger → advertising primary', async () => {
    const { r1 } = (await measure(sessions(1000, 500, 100), sessions(950, 490, 60)));
    assert.equal(r1.cause!.branch, 'both_traffic_sources_decreased:advertising_primary');
    assert.equal(r1.countermeasures[0]!.responsibleTeam, 'Advertising team');
  });

  test('both ↓ by the same amount → both equal, SEO and Advertising', async () => {
    const { r1 } = (await measure(sessions(1000, 500, 100), sessions(950, 470, 70)));
    assert.equal(r1.cause!.branch, 'both_traffic_sources_decreased:equal_contribution');
    assert.equal(r1.countermeasures[0]!.responsibleTeam, 'SEO and Advertising team');
  });

  test('total ↓ but neither source ↓ → NG without a rules.yaml cause; nothing proposed', async () => {
    const { r1 } = (await measure(sessions(1000, 500, 100), sessions(950, 500, 100)));
    assert.equal(r1.measurement.status, 'NG');
    assert.equal(r1.cause!.branch, 'undetermined');
    assert.equal(r1.countermeasures.length, 0);
  });

  test('previous week 0 → NOT_EVALUABLE (division by zero)', async () => {
    const { r1 } = (await measure(sessions(0, 0, 0), sessions(950, 500, 100)));
    assert.equal(r1.measurement.status, 'NOT_EVALUABLE');
  });
});

describe('GA4_Rule_02 Purchase Efficiency — CVR', () => {
  const cvr = (s: number, cv: number) => week([s, cv], [s / 2, cv / 2], [s / 10, cv / 10]);

  test('|CVR WoW| < 0.7% → OK', async () => {
    const { r2 } = (await measure(cvr(10000, 1000), cvr(10000, 1005)));
    assert.equal(r2.measurement.status, 'OK');
  });

  test('CVR ↑ ≥ 0.7% → NG improvement', async () => {
    const { r2 } = (await measure(cvr(10000, 1000), cvr(10000, 1010)));
    assert.equal(r2.measurement.status, 'NG');
    assert.equal(r2.cause!.branch, 'conversion_improvement');
  });

  test('sessions ↑, purchases flat → traffic quality issue', async () => {
    const { r2 } = (await measure(cvr(10000, 1000), cvr(11000, 1000)));
    assert.equal(r2.cause!.branch, 'traffic_quality_issue');
    assert.equal(r2.countermeasures[0]!.responsibleTeam, 'SEO and Advertising team');
  });

  test('sessions flat, purchases ↓ → conversion side issue, Ecommerce', async () => {
    const { r2 } = (await measure(cvr(10000, 1000), cvr(10000, 900)));
    assert.equal(r2.cause!.branch, 'conversion_side_issue');
    assert.equal(r2.countermeasures[0]!.responsibleTeam, 'Ecommerce team');
  });

  test('sessions and purchases ↑, sessions faster → traffic growth outpaced conversion growth', async () => {
    const { r2 } = (await measure(cvr(10000, 1000), cvr(12000, 1100)));
    assert.equal(r2.cause!.branch, 'traffic_growth_outpaced_purchase_growth');
  });
});

describe('GSC_R01 Organic Traffic Decrease Investigation', () => {
  const W1 = { start: '2026-09-10', end: '2026-09-16' };
  const W2 = { start: '2026-09-17', end: '2026-09-23' };
  const gscCsv = (head: string, rows: [string, number, number, number][]) =>
    Buffer.from([`${head},クリック数,表示回数,CTR,掲載順位`, ...rows.map(([k, c, i, p]) => `${k},${c},${i},${((c / i) * 100).toFixed(2)}%,${p}`)].join('\n'));
  const week = (db: DB, head: string, period: typeof W1, rows: [string, number, number, number][]) =>
    importFiles(db, config(), [{ fileName: `${head}-${period.start}.csv`, buffer: gscCsv(head, rows) }], { period });
  const organicDown = [sessions(1000, 500, 100), sessions(950, 450, 110)] as const;

  test('query clicks ↓ + position worse → ranking deterioration (high), ranking_drop countermeasure', async () => {
    const { r1 } = (await measure(...organicDown, config(), async (db) => {
      (await week(db, '上位のクエリ', W1, [['gaming pc', 300, 3000, 3], ['dospara', 600, 1000, 1]]));
      (await week(db, '上位のクエリ', W2, [['gaming pc', 200, 3000, 4.5], ['dospara', 590, 1000, 1]]));
    }));
    const inv = r1.cause!.analysis!.investigation!;
    assert.equal(inv.matched, 'queries_with_click_decrease AND position_drop');
    assert.equal(inv.cause, 'Possible ranking deterioration for affected queries.');
    assert.equal(inv.countermeasureKey, 'ranking_drop');
    assert.equal(inv.confidence, 'high');
    assert.deepEqual(inv.affectedQueries, ['gaming pc', 'dospara']);
    assert.match(r1.countermeasures[1]!.actionText, /^Review affected queries and pages\./);
    assert.equal(r1.countermeasures[1]!.responsibleTeam, 'SEO team');
  });

  test('query impressions ↓ (position same) → visibility decrease, impression_drop', async () => {
    const { r1 } = (await measure(...organicDown, config(), async (db) => {
      (await week(db, '上位のクエリ', W1, [['gaming pc', 300, 3000, 3]]));
      (await week(db, '上位のクエリ', W2, [['gaming pc', 250, 2500, 3]]));
    }));
    const inv = r1.cause!.analysis!.investigation!;
    assert.equal(inv.matched, 'queries_with_impression_decrease');
    assert.equal(inv.countermeasureKey, 'impression_drop');
    assert.equal(inv.confidence, 'medium');
  });

  test('decrease concentrated on one device → device_specific_drop', async () => {
    const { r1 } = (await measure(...organicDown, config(), async (db) => {
      (await week(db, 'デバイス', W1, [['モバイル', 600, 3000, 3], ['PC', 300, 1000, 2]]));
      (await week(db, 'デバイス', W2, [['モバイル', 500, 3000, 3], ['PC', 295, 1000, 2]]));
    }));
    const inv = r1.cause!.analysis!.investigation!;
    assert.equal(inv.matched, 'affected_device');
    assert.equal(inv.affectedDevice, 'モバイル');
    assert.equal(inv.countermeasureKey, 'device_specific_drop');
  });

  test('no GSC data for the measured weeks → fallback, insufficient_data, no_clear_cause', async () => {
    const { r1 } = (await measure(...organicDown));
    const inv = r1.cause!.analysis!.investigation!;
    assert.equal(inv.matched, null);
    assert.equal(inv.cause, 'No single cause can be determined from the available GSC data. Further investigation is required.');
    assert.equal(inv.confidence, 'insufficient_data');
    assert.equal(inv.countermeasureKey, 'no_clear_cause');
    assert.ok(inv.checks.every((c) => !c.available));
  });

  test('3-month snapshot (not the measured weeks) is never compared', async () => {
    const { r1 } = (await measure(...organicDown, config(), async (db) => {
      (await week(db, '上位のクエリ', { start: '2026-06-16', end: '2026-09-15' }, [['gaming pc', 300, 3000, 3]]));
    }));
    assert.equal(r1.cause!.analysis!.investigation!.confidence, 'insufficient_data');
  });

  test('trigger: runs when both decreased (advertising primary) — organic still decreased', async () => {
    const { r1 } = (await measure(sessions(1000, 500, 100), sessions(950, 490, 60)));
    assert.equal(r1.cause!.branch, 'both_traffic_sources_decreased:advertising_primary');
    assert.ok(r1.cause!.analysis!.investigation);
  });

  test('trigger: not run when organic did not decrease', async () => {
    const { r1 } = (await measure(sessions(1000, 500, 100), sessions(950, 510, 60)));
    assert.equal(r1.cause!.branch, 'advertising_traffic_decrease');
    assert.equal(r1.cause!.analysis, null);
    assert.equal(r1.countermeasures.length, 1);
  });
});
