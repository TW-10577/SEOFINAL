// Shared arithmetic and formatting for the rules. The rule conditions themselves live in rules.yaml (see expr.ts).
import type { MeasurementStatus } from '@seo/shared';
import type { LText } from '../i18n.ts';

export interface Change {
  previous: number;
  current: number;
  abs: number;
  /** Percent; null when previous is 0. */
  rate: number | null;
}

/** Absolute Change = Current − Previous; Percentage Change = (Current − Previous) / Previous × 100. */
export function change(previous: number, current: number): Change {
  return { previous, current, abs: current - previous, rate: previous === 0 ? null : ((current - previous) / previous) * 100 };
}

/** CVR = CV / Sessions × 100; CTR = Clicks / Impressions × 100. */
export const ratio = (num: number, den: number): number | null => (den === 0 ? null : (num / den) * 100);

export interface Judgment {
  status: MeasurementStatus;
  result: LText;
  reason: LText;
}

/** NOT_EVALUABLE in words; the specific reason (missing data, period …) follows it. */
export const NOT_EVALUABLE_REASON: LText = {
  en: 'The rule could not be evaluated because the required data or a valid comparison period is unavailable. No OK/NG conclusion was made.',
  ja: '必要なデータまたは有効な比較期間がないため、このルールを評価できませんでした。OK／NG の判定は行っていません。',
};

/**
 * The OK / NG result in plain words, from the measured change and the rule's threshold: the direction and size of
 * the week-on-week change, whether it stays within the threshold, and whether an anomaly was created. No formulas,
 * variable names or test-data notes (the test-data notice is shown on its own).
 */
export function explainResult(r: { status: MeasurementStatus; metric: string; rate: number | null; threshold: number | null; unit: string | null }): LText | null {
  if ((r.status !== 'OK' && r.status !== 'NG') || r.rate == null) return null;
  const subject = r.metric === 'sessions' ? { en: 'Total sessions', ja: '合計セッション' } : r.metric === 'cvr' ? { en: 'CVR', ja: 'CVR' } : { en: r.metric, ja: r.metric };
  const size = `${Math.abs(r.rate).toFixed(2)}%`;
  const limit = r.threshold == null ? null : `±${r.threshold}${r.unit === 'percent' ? '%' : r.unit === 'percentage_points' ? ' pt' : ''}`;
  const limitEn = limit ? `the configured ${limit} threshold` : 'the configured threshold';
  const limitJa = limit ? `設定されたしきい値 ${limit} ` : '設定されたしきい値';
  const up = r.rate > 0;
  const moved = Math.abs(r.rate) >= 0.005;
  if (r.status === 'OK')
    return {
      en: `${subject.en} ${moved ? `${up ? 'increased' : 'decreased'} by ${size}` : 'did not change'} compared with the previous week. This change is within ${limitEn}, so the rule did not detect a significant change. No anomaly was created for this rule.`,
      ja: `${subject.ja}は前週比で${moved ? ` ${size} ${up ? '増加' : '減少'}しました` : '変化していません'}。この変化は${limitJa}の範囲内のため、有意な変化は検出されませんでした。このルールでは異常は作成されていません。`,
    };
  return {
    en: `${subject.en} ${up ? 'increased' : 'decreased'} by ${size} compared with the previous week, exceeding ${limitEn}. An anomaly was detected and requires investigation.`,
    ja: `${subject.ja}は前週比で ${size} ${up ? '増加' : '減少'}し、${limitJa}を超えました。異常が検出されたため、調査が必要です。`,
  };
}

export const fmtPct = (v: number | null | undefined, digits = 2) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`);
export const fmtPt = (v: number, digits = 3) => `${v > 0 ? '+' : ''}${v.toFixed(digits)} pt`;
export const fmtNum = (v: number | null | undefined, digits = 0) =>
  v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
