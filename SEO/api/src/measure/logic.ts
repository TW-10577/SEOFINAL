// Pure rule logic for the client judgment criteria (SEO.txt ① and ②). No database access.
import type { MeasurementStatus, RuleConfig } from '@seo/shared';
import { dec, tx, type LText } from '../i18n.ts';

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

// Floating-point slack so that exactly ±3.9% counts as "3.9% or more".
const EPS = 1e-9;

export interface Judgment {
  status: MeasurementStatus;
  result: LText;
  reason: LText;
}

const NOT_EVALUABLE = tx('Not evaluable', '評価不可');

export const fmtPct = (v: number | null | undefined, digits = 2) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`);
export const fmtPt = (v: number, digits = 3) => `${v > 0 ? '+' : ''}${v.toFixed(digits)} pt`;
export const fmtNum = (v: number | null | undefined, digits = 0) =>
  v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const signed = (v: number, digits = 0) => `${v > 0 ? '+' : ''}${fmtNum(v, digits)}`;

/**
 * Compares a change with the rule threshold ("±X or more WoW" → both directions, inclusive).
 * Never returns OK when the comparison cannot be made.
 */
export function judge(rule: RuleConfig, c: Change): Judgment {
  const t = rule.thresholdValue;
  if (t === null)
    return { status: 'NOT_EVALUABLE', result: NOT_EVALUABLE, reason: tx('No threshold value is configured for this rule.', 'このルールには閾値が設定されていません。') };
  if (rule.thresholdUnit === 'unresolved') {
    const rel = c.rate === null ? tx('not computable (previous value is 0)', '計算不可（前期の値が 0）') : tx(fmtPct(c.rate));
    const note = dec(rule.thresholdNote);
    return {
      status: 'NOT_EVALUABLE',
      result: NOT_EVALUABLE,
      reason: tx(
        `Threshold ±${t} is configured but its unit is not confirmed by the client (relative % or percentage points). ` +
          `Computed for reference: relative change ${rel.en}, difference ${fmtPt(c.abs)}. ${note.en}`.trim(),
        `閾値 ±${t} は設定済みですが、単位（相対 % かパーセントポイントか）がクライアント未確認です。` +
          `参考値：相対変化 ${rel.ja}、差 ${fmtPt(c.abs)}。${note.ja}`,
      ),
    };
  }
  if (rule.thresholdUnit === 'percent') {
    if (c.rate === null)
      return {
        status: 'NOT_EVALUABLE',
        result: NOT_EVALUABLE,
        reason: tx('Previous-period value is 0, so the change rate cannot be calculated (division by zero).', '前期の値が 0 のため変化率を計算できません（ゼロ除算）。'),
      };
    const hit = Math.abs(c.rate) + EPS >= t;
    return {
      status: hit ? 'NG' : 'OK',
      result: tx(`${fmtPct(c.rate)} ${hit ? '≥' : '<'} ±${t}%`),
      reason: hit
        ? tx(`Change of ${fmtPct(c.rate)} meets the ±${t}% WoW criterion — significant change.`, `変化 ${fmtPct(c.rate)} は前週比 ±${t}% の基準に該当 — 有意な変化です。`)
        : tx(`Change of ${fmtPct(c.rate)} is within ±${t}% WoW — not significant.`, `変化 ${fmtPct(c.rate)} は前週比 ±${t}% の範囲内 — 有意ではありません。`),
    };
  }
  const hit = Math.abs(c.abs) + EPS >= t;
  return {
    status: hit ? 'NG' : 'OK',
    result: tx(`${fmtPt(c.abs)} ${hit ? '≥' : '<'} ±${t} pt`),
    reason: hit
      ? tx(`Difference of ${fmtPt(c.abs)} meets the ±${t} percentage-point criterion — significant change.`, `差 ${fmtPt(c.abs)} は ±${t} ポイントの基準に該当 — 有意な変化です。`)
      : tx(`Difference of ${fmtPt(c.abs)} is within ±${t} percentage points — not significant.`, `差 ${fmtPt(c.abs)} は ±${t} ポイントの範囲内 — 有意ではありません。`),
  };
}

// ---------------------------------------------------------------------------------------------
// Rule ① — What to Check Next
//   organic ↓ → feedback to SEO team; advertising ↓ → feedback to advertising team;
//   both ↓ → the one with the larger contribution to the decrease is the primary cause.
// ---------------------------------------------------------------------------------------------

export type Channel = 'organic' | 'advertising';

export interface Rule1FollowUp {
  branch: 'organic' | 'advertising' | 'both' | 'none' | 'missing-data';
  /** Channels that decreased, primary first. */
  decreased: Channel[];
  primary: Channel | null;
  /** Share of the total-sessions decrease, percent. Null when total sessions did not decrease. */
  contribution: Record<Channel, number | null>;
  missing: Channel[];
}

export function rule1FollowUp(total: Change, organic: Change | null, advertising: Change | null): Rule1FollowUp {
  const channels: Record<Channel, Change | null> = { organic, advertising };
  const missing = (Object.keys(channels) as Channel[]).filter((k) => !channels[k]);
  // Only a channel that decreased contributes to a decrease.
  const share = (c: Change | null) => (c && c.abs < 0 && total.abs < 0 ? (c.abs / total.abs) * 100 : null);
  const contribution = { organic: share(organic), advertising: share(advertising) };
  if (missing.length) {
    // A follow-up can still be stated for a channel that is present and decreased, but not "both".
    const present = (Object.keys(channels) as Channel[]).filter((k) => channels[k] && channels[k]!.abs < 0);
    return { branch: 'missing-data', decreased: present, primary: null, contribution, missing };
  }
  const decreased = (['organic', 'advertising'] as Channel[]).filter((k) => channels[k]!.abs < 0);
  if (decreased.length === 0) return { branch: 'none', decreased, primary: null, contribution, missing };
  if (decreased.length === 1) return { branch: decreased[0]!, decreased, primary: decreased[0]!, contribution, missing };
  // Both decreased: larger contribution = larger absolute decrease in sessions.
  const o = organic!.abs;
  const a = advertising!.abs;
  const primary: Channel | null = o === a ? null : o < a ? 'organic' : 'advertising';
  const order: Channel[] = primary === 'advertising' ? ['advertising', 'organic'] : ['organic', 'advertising'];
  return { branch: 'both', decreased: order, primary, contribution, missing };
}

export function describeChannelChange(label: LText, c: Change, contribution: number | null): LText {
  const share = contribution === null ? tx('') : tx(`, ${contribution.toFixed(1)}% of the decrease in total sessions`, `（全体セッション減少の ${contribution.toFixed(1)}%）`);
  return tx(`${label.en} sessions ${signed(c.abs)} (${fmtPct(c.rate)})${share.en}`, `${label.ja}のセッション ${signed(c.abs)}（${fmtPct(c.rate)}）${share.ja}`);
}

// ---------------------------------------------------------------------------------------------
// Rule ② — What to Check Next
//   Sessions increase + CV flat/decreases → check the quality of traffic
//   Sessions flat + CVR decreases        → check products, pricing, and pages
//   CVR and sessions both increase       → identify the factors contributing to the improvement
// "Flat" is not defined by the client: flatBand null → branch undetermined.
// ---------------------------------------------------------------------------------------------

export type Movement = 'increase' | 'flat' | 'decrease' | 'unknown';

export function classify(c: Change, flatBand: number): Movement {
  if (c.rate === null) return 'unknown';
  if (c.rate > flatBand) return 'increase';
  if (c.rate < -flatBand) return 'decrease';
  return 'flat';
}

export interface Rule2FollowUp {
  branch: 'traffic_quality' | 'product_price_page' | 'improvement' | 'none' | 'undetermined';
  sessions: Movement;
  cv: Movement;
  cvr: Movement;
  explanation: LText;
}

const MOVE_JA: Record<Movement, string> = { increase: '増加', flat: '横ばい', decrease: '減少', unknown: '不明' };

export function rule2FollowUp(sessions: Change, cv: Change, cvr: Change, flatBand: number | null | undefined): Rule2FollowUp {
  // CVR already moved by the threshold (NG), so its direction is its sign.
  const cvrMove: Movement = cvr.abs > 0 ? 'increase' : cvr.abs < 0 ? 'decrease' : 'flat';
  const facts = tx(
    `Sessions ${fmtPct(sessions.rate)}, CV ${fmtPct(cv.rate)}, CVR ${fmtPct(cvr.rate)} (${fmtPt(cvr.abs)})`,
    `セッション ${fmtPct(sessions.rate)}、CV ${fmtPct(cv.rate)}、CVR ${fmtPct(cvr.rate)}（${fmtPt(cvr.abs)}）`,
  );
  if (flatBand == null)
    return {
      branch: 'undetermined',
      sessions: 'unknown',
      cv: 'unknown',
      cvr: cvrMove,
      explanation: tx(
        `${facts.en}. The client rule does not define "flat", so the What to Check Next branch cannot be determined.`,
        `${facts.ja}。クライアントルールに「横ばい」の定義がないため、「次に確認すること」の分岐を判定できません。`,
      ),
    };
  const s = classify(sessions, flatBand);
  const v = classify(cv, flatBand);

  let branch: Rule2FollowUp['branch'] = 'none';
  if (s === 'increase' && (v === 'flat' || v === 'decrease')) branch = 'traffic_quality';
  else if (s === 'flat' && cvrMove === 'decrease') branch = 'product_price_page';
  else if (s === 'increase' && cvrMove === 'increase') branch = 'improvement';
  const en = `${facts.en}: sessions ${s}, CV ${v}, CVR ${cvrMove} (flat = within ±${flatBand}%).`;
  const ja = `${facts.ja}：セッション${MOVE_JA[s]}、CV ${MOVE_JA[v]}、CVR ${MOVE_JA[cvrMove]}（横ばい = ±${flatBand}% 以内）。`;
  const explanation =
    branch === 'none'
      ? tx(`${en} No Rule ② branch covers this combination.`, `${ja}ルール②にこの組み合わせの分岐はありません。`)
      : tx(en, ja);
  return { branch, sessions: s, cv: v, cvr: cvrMove, explanation };
}
