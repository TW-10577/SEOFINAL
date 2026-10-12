import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { explainResult, NOT_EVALUABLE_REASON } from '../src/measure/logic.ts';

// The result shown on the Measurements page: plain words, no formulas, variable names or test-data notes.
describe('result explanation', () => {
  test('OK: direction, size and threshold; no anomaly', () => {
    const r = explainResult({ status: 'OK', metric: 'sessions', rate: -3.0314, threshold: 3.9, unit: 'percent' })!;
    assert.equal(r.en, 'Total sessions decreased by 3.03% compared with the previous week. This change is within the configured ±3.9% threshold, so the rule did not detect a significant change. No anomaly was created for this rule.');
    assert.match(r.ja, /^合計セッションは前週比で 3\.03% 減少しました。この変化は設定されたしきい値 ±3\.9% の範囲内/);
    assert.match(explainResult({ status: 'OK', metric: 'cvr', rate: 0.4, threshold: 0.7, unit: 'percent' })!.en, /^CVR increased by 0\.40% .* within the configured ±0\.7% threshold/);
    assert.match(explainResult({ status: 'OK', metric: 'sessions', rate: 0, threshold: 3.9, unit: 'percent' })!.en, /^Total sessions did not change compared with the previous week\./);
  });

  test('NG: increase or decrease as measured, never always a decline', () => {
    const up = explainResult({ status: 'NG', metric: 'cvr', rate: 1.68, threshold: 0.7, unit: 'percent' })!;
    assert.equal(up.en, 'CVR increased by 1.68% compared with the previous week, exceeding the configured ±0.7% threshold. An anomaly was detected and requires investigation.');
    assert.match(up.ja, /^CVRは前週比で 1\.68% 増加し、設定されたしきい値 ±0\.7% を超えました。/);
    assert.match(explainResult({ status: 'NG', metric: 'sessions', rate: -4.42, threshold: 3.9, unit: 'percent' })!.en, /^Total sessions decreased by 4\.42% /);
  });

  test('no condition expressions or variable names', () => {
    for (const status of ['OK', 'NG'] as const) {
      const r = explainResult({ status, metric: 'sessions', rate: status === 'OK' ? 1 : 5, threshold: 3.9, unit: 'percent' })!;
      assert.doesNotMatch(r.en, /abs\(|_wow_percent|Condition|<|>=|not a business result/);
    }
  });

  test('NOT_EVALUABLE: no OK / NG explanation; the standard sentence is used instead', () => {
    assert.equal(explainResult({ status: 'NOT_EVALUABLE', metric: 'sessions', rate: null, threshold: 3.9, unit: 'percent' }), null);
    assert.equal(explainResult({ status: 'OK', metric: 'sessions', rate: null, threshold: 3.9, unit: 'percent' }), null);
    assert.match(NOT_EVALUABLE_REASON.en, /could not be evaluated .* No OK\/NG conclusion was made\.$/);
  });
});
