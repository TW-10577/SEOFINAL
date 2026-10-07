// Client rules ① and ② (SEO.txt) through the full measurement engine.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { localize } from '../src/i18n.ts';
import { runMeasurements } from '../src/measure/engine.ts';
import { getMeasurementDetail, listMeasurements } from '../src/measure/read.ts';
import { change, judge, rule2FollowUp } from '../src/measure/logic.ts';
import { config, freshDb, ga4Csv, importGa4, rule, type WeekValues } from './helpers.ts';

const week = (total: [number, number], organic: [number, number], advertising: [number, number]): WeekValues => ({ total, organic, advertising });

function measure(prev: WeekValues, cur: WeekValues, cfg = config()) {
  const db = freshDb();
  importGa4(db, cfg, ga4Csv(prev, cur));
  const runId = runMeasurements(db, cfg);
  const ms = listMeasurements(db, cfg, runId);
  const detail = (ruleId: string) => localize(getMeasurementDetail(db, cfg, ms.find((m) => m.ruleId === ruleId)!.id)!, 'en');
  return { db, runId, ms, r1: detail('GA4-R1'), r2: detail('GA4-R2') };
}

describe('Rule ① Traffic Acquisition — Sessions ±3.9% WoW', () => {
  test('change below ±3.9% → OK, no anomaly', () => {
    const { r1 } = measure(week([1000, 10], [500, 5], [100, 1]), week([962, 10], [480, 5], [100, 1]));
    assert.equal(r1.measurement.status, 'OK');
    assert.ok(Math.abs(r1.measurement.changeRate! - -3.8) < 1e-9);
    assert.equal(r1.anomaly, null);
    assert.equal(r1.cause, null);
  });

  test('change exactly −3.9% → NG (criterion is "3.9% or more")', () => {
    const { r1 } = measure(week([1000, 10], [500, 5], [100, 1]), week([961, 10], [461, 5], [100, 1]));
    assert.equal(r1.measurement.status, 'NG');
    assert.equal(r1.anomaly?.state, 'Detected');
  });

  test('increase beyond +3.9% → NG as well (±)', () => {
    const { r1 } = measure(week([1000, 10], [500, 5], [100, 1]), week([1100, 10], [600, 5], [100, 1]));
    assert.equal(r1.measurement.status, 'NG');
    assert.ok(r1.anomaly);
    // Neither channel decreased → no client follow-up, no countermeasure.
    assert.equal(r1.cause?.branch, 'none');
    assert.equal(r1.countermeasures.length, 0);
  });

  test('organic traffic decrease → feedback to the SEO team', () => {
    const { r1 } = measure(week([1000, 10], [500, 5], [100, 1]), week([900, 10], [400, 5], [100, 1]));
    assert.equal(r1.cause?.branch, 'organic');
    assert.equal(r1.countermeasures.length, 1);
    assert.equal(r1.countermeasures[0]!.actionText, 'Provide feedback to the SEO team.');
    assert.equal(r1.countermeasures[0]!.responsibleTeam, 'SEO team');
    assert.equal(r1.countermeasures[0]!.status, 'Proposed');
  });

  test('advertising traffic decrease → feedback to the advertising team', () => {
    const { r1 } = measure(week([1000, 10], [500, 5], [100, 1]), week([950, 10], [500, 5], [50, 1]));
    assert.equal(r1.cause?.branch, 'advertising');
    assert.deepEqual(r1.countermeasures.map((k) => k.actionText), ['Provide feedback to the advertising team.']);
    // No GSC evidence: GSC supports rule ① only when organic decreases.
    assert.ok(!r1.cause!.supportingEvidence.tables.some((t) => t.title.startsWith('GSC')));
  });

  test('both decrease → larger contribution is the primary cause (organic)', () => {
    const { r1 } = measure(week([1000, 10], [500, 5], [100, 1]), week([900, 10], [430, 5], [70, 1]));
    assert.equal(r1.cause?.branch, 'both-organic-primary');
    assert.match(r1.cause!.causeText, /organic traffic has the larger contribution/);
    assert.equal(r1.countermeasures[0]!.actionText, 'Provide feedback to the SEO team.');
    assert.match(r1.countermeasures[0]!.reason, /primary cause/);
    assert.match(r1.countermeasures[1]!.reason, /secondary/);
  });

  test('both decrease → larger contribution is the primary cause (advertising)', () => {
    const { r1 } = measure(week([1000, 10], [500, 5], [100, 1]), week([900, 10], [480, 5], [20, 1]));
    assert.equal(r1.cause?.branch, 'both-advertising-primary');
    assert.equal(r1.countermeasures[0]!.actionText, 'Provide feedback to the advertising team.');
    const shares = r1.evidence.tables[0]!.rows.map((r) => r[6]);
    assert.deepEqual(shares, ['—', '20.0%', '80.0%']);
  });

  test('cause is never confirmed by the system', () => {
    const { r1 } = measure(week([1000, 10], [500, 5], [100, 1]), week([900, 10], [400, 5], [100, 1]));
    assert.equal(r1.cause?.reviewStatus, 'NotReviewed');
  });
});

describe('Rule ② Purchase Efficiency — CVR ±0.7% WoW', () => {
  test('threshold unit not confirmed → NOT_EVALUABLE with both readings, no anomaly', () => {
    const { r2 } = measure(week([1000, 10], [500, 5], [100, 1]), week([1000, 8], [500, 5], [100, 1]));
    assert.equal(r2.measurement.status, 'NOT_EVALUABLE');
    assert.match(r2.measurement.reason, /unit is not confirmed/);
    assert.match(r2.measurement.reason, /relative change -20\.00%/);
    assert.equal(r2.anomaly, null);
  });

  const relative = config((c) => (rule(c, 'GA4-R2').thresholdUnit = 'percent'));
  const points = config((c) => (rule(c, 'GA4-R2').thresholdUnit = 'percentage_points'));

  test('relative unit: change below 0.7% → OK', () => {
    // CVR 1.000% → 0.995% = −0.5% relative
    const { r2 } = measure(week([10000, 100], [500, 5], [100, 1]), week([10000, 99.5], [500, 5], [100, 1]), relative);
    assert.equal(r2.measurement.status, 'OK');
  });

  test('relative unit: change at / beyond 0.7% → NG + anomaly', () => {
    const at = measure(week([10000, 1000], [500, 5], [100, 1]), week([10000, 993], [500, 5], [100, 1]), relative).r2;
    assert.equal(at.measurement.status, 'NG');
    const beyond = measure(week([10000, 100], [500, 5], [100, 1]), week([10000, 90], [500, 5], [100, 1]), relative).r2;
    assert.equal(beyond.measurement.status, 'NG');
    assert.equal(beyond.anomaly?.state, 'Detected');
  });

  test('percentage-point unit: −0.1 pt → OK; −0.7 pt → NG', () => {
    assert.equal(measure(week([1000, 10], [500, 5], [100, 1]), week([1000, 9], [500, 5], [100, 1]), points).r2.measurement.status, 'OK');
    assert.equal(measure(week([1000, 10], [500, 5], [100, 1]), week([1000, 3], [500, 5], [100, 1]), points).r2.measurement.status, 'NG');
  });

  test('"flat" not defined → branch undetermined, no countermeasure', () => {
    const { r2 } = measure(week([1000, 10], [500, 5], [100, 1]), week([1000, 8], [500, 5], [100, 1]), relative);
    assert.equal(r2.measurement.status, 'NG');
    assert.equal(r2.cause?.branch, 'undetermined');
    assert.equal(r2.countermeasures.length, 0);
  });

  const banded = config((c) => {
    rule(c, 'GA4-R2').thresholdUnit = 'percent';
    rule(c, 'GA4-R2').flatBandPercent = 1;
  });

  test('sessions increase + CV flat/decrease → check the quality of traffic', () => {
    const { r2 } = measure(week([1000, 10], [500, 5], [100, 1]), week([1200, 10], [500, 5], [100, 1]), banded);
    assert.equal(r2.cause?.branch, 'traffic_quality');
    assert.equal(r2.countermeasures[0]!.actionText, 'Check the quality of traffic.');
  });

  test('sessions flat + CVR decrease → check products, pricing, and pages', () => {
    const { r2 } = measure(week([1000, 10], [500, 5], [100, 1]), week([1005, 8], [500, 5], [100, 1]), banded);
    assert.equal(r2.cause?.branch, 'product_price_page');
    assert.equal(r2.countermeasures[0]!.actionText, 'Check products, pricing, and pages.');
  });

  test('CVR and sessions both increase → identify the improvement factors', () => {
    const { r2 } = measure(week([1000, 10], [500, 5], [100, 1]), week([1200, 15], [500, 5], [100, 1]), banded);
    assert.equal(r2.cause?.branch, 'improvement');
    assert.equal(r2.countermeasures[0]!.actionText, 'Identify the factors contributing to the improvement.');
  });

  test('combination not covered by the client rule → no branch, no countermeasure', () => {
    // Sessions down and CVR down (the case in the client dummy data).
    const { r2 } = measure(week([1000, 10], [500, 5], [100, 1]), week([900, 8], [500, 5], [100, 1]), banded);
    assert.equal(r2.cause?.branch, 'none');
    assert.equal(r2.countermeasures.length, 0);
  });

  test('pure branch logic: unknown band never picks a branch', () => {
    const f = rule2FollowUp(change(1000, 1200), change(10, 10), change(1, 0.83), null);
    assert.equal(f.branch, 'undetermined');
  });
});

describe('NOT_EVALUABLE — never an incorrect OK', () => {
  test('missing threshold', () => {
    const cfg = config((c) => (rule(c, 'GA4-R1').thresholdValue = null));
    const { r1 } = measure(week([1000, 10], [500, 5], [100, 1]), week([500, 10], [250, 5], [100, 1]), cfg);
    assert.equal(r1.measurement.status, 'NOT_EVALUABLE');
    assert.match(r1.measurement.reason, /No threshold/);
  });

  test('missing previous period', () => {
    const db = freshDb();
    const cfg = config();
    importGa4(db, cfg, ga4Csv(week([1000, 10], [500, 5], [100, 1]), week([500, 10], [250, 5], [100, 1])));
    const runId = runMeasurements(db, cfg, { currentEnd: '2026-09-16' }); // previous week = 09-03..09-09: no data
    const m = listMeasurements(db, cfg, runId);
    assert.ok(m.every((x) => x.status === 'NOT_EVALUABLE'));
    assert.match(localize(m[0]!, 'en').reason, /previous period missing/);
  });

  test('missing current period', () => {
    const db = freshDb();
    const cfg = config();
    importGa4(db, cfg, ga4Csv(week([1000, 10], [500, 5], [100, 1]), week([500, 10], [250, 5], [100, 1])));
    const runId = runMeasurements(db, cfg, { currentEnd: '2026-09-30' });
    assert.match(localize(listMeasurements(db, cfg, runId)[0]!, 'en').reason, /current period missing/);
  });

  test('missing required metric (no CV column) → rule ② not evaluable', () => {
    const cfg = config((c) => (c.metricNames.cv.value = ['トランザクション']));
    const { r2 } = measure(week([1000, 10], [500, 5], [100, 1]), week([500, 10], [250, 5], [100, 1]), cfg);
    assert.equal(r2.measurement.status, 'NOT_EVALUABLE');
    assert.match(r2.measurement.reason, /No CV/);
  });

  test('division by zero (previous sessions 0)', () => {
    const r = judge(rule(config(), 'GA4-R1'), change(0, 100));
    assert.equal(r.status, 'NOT_EVALUABLE');
    assert.match(r.reason.en, /division by zero/);
  });

  test('no GA4 data at all', () => {
    const db = freshDb();
    const cfg = config();
    const runId = runMeasurements(db, cfg);
    assert.ok(listMeasurements(db, cfg, runId).every((m) => m.status === 'NOT_EVALUABLE'));
  });
});
