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

export const fmtPct = (v: number | null | undefined, digits = 2) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`);
export const fmtPt = (v: number, digits = 3) => `${v > 0 ? '+' : ''}${v.toFixed(digits)} pt`;
export const fmtNum = (v: number | null | undefined, digits = 0) =>
  v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
