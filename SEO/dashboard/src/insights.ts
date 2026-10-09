import type { ComparisonRow, MeasurementStatus } from '@seo/shared';
import { fmtDiff, fmtRate, fmtValue } from './format.ts';
import { dataLabel, t } from './i18n.ts';

// Business insights of the GA4 report: a short, evidence-based reading of the selected week-on-week comparison.
// Everything is derived from the comparison rows, the rules.yaml rules (M1 / M2 thresholds and cause branches) and the
// stored M1 / M2 results. Two exact identities make the evidence:
//   purchases = sessions × CVR / 100      → the purchase change splits into a traffic part and an efficiency part
//   total CVR = Σ (session share × CVR) → the CVR change splits into a traffic-mix part and a within-source part
// Confidence comes from whether these independent signals agree, never from a fixed score. Several explanations are
// ranked internally but only the strongest is shown, always as a hypothesis: the SEO team confirms causes on the
// Measurements page.

export type Dir = 'up' | 'down' | 'flat';
export type Confidence = 'High' | 'Medium' | 'Low';

export interface RuleInfo {
  code: string;
  subject: string;
  metric: string;
  thresholdValue: number | null;
  thresholdUnit: string;
  source: string;
  whatToCheckNext: string;
}

export interface Fact {
  label: string;
  metric: string;
  previous: number;
  current: number;
  abs: number;
  rate: number;
  /** The rules.yaml rule that judges this figure (M1 / M2) with its result; null for a figure no rule judges. */
  rule: { code: string; value: number | null; unit: 'percent' | 'percentage_points' | null; result: MeasurementStatus } | null;
}

export interface Hypothesis {
  id: string;
  title: string;
  confidence: Confidence;
  /** Concise evidence for the main finding (at most three lines). */
  evidence: string[];
  /** The single most important next check. */
  action: string;
  /** Data that would be needed to go further, most relevant first. */
  missing: string[];
}

export interface Analysis {
  kind: 'ga4' | 'none';
  /** One sentence: what changed, against M1 / M2. */
  finding: string;
  /** Sessions, purchases and CVR. */
  facts: Fact[];
  /** The strongest hypothesis; null when no figure moved beyond its threshold. */
  lead: Hypothesis | null;
  /** The data does not single out one explanation (or the signals conflict): the cause cannot be confirmed yet. */
  inconclusive: boolean;
  /** At most three evidence lines: the lead's, or the M1 / M2 figures when there is no lead. */
  evidence: string[];
  /** What the uploaded data lacks for a deeper analysis (e.g. no traffic-source breakdown). */
  limitations: string[];
}

export interface InsightInput {
  rows: ComparisonRow[];
  rules: RuleInfo[];
  segments: { total: string; organic: string; advertising: string; all: string[] } | null;
  purchasesMetric: string;
  /** Search Console daily data covers the compared weeks. */
  gscAvailable: boolean;
  /** Stored M1 / M2 results by rule code: they take precedence over the threshold check made here. */
  results?: Record<string, MeasurementStatus>;
}

/** One traffic source (or the unattributed remainder) between the two weeks. */
interface Contribution {
  name: string;
  /** Share of the total CVR change that comes from conversion within this source (percentage points). */
  within: number;
  dSessions: number;
  cvrRate: number;
  sessRate: number;
  purRate: number;
}

const RANK: Record<Confidence, number> = { High: 3, Medium: 2, Low: 1 };
const ln = (a: number, b: number) => Math.log(b / a);
const pct = (v: number) => `${Math.abs(v).toFixed(2)}%`;
const share = (v: number) => `${Math.round(v * 100)}%`;

/** Channel part of a segment key ("通販（全体） オーガニックサーチ" → "Organic Search"). */
export function sourceName(key: string, total: string): string {
  const own = key.startsWith(total) ? key.slice(total.length).trim() : '';
  if (own) return dataLabel(own);
  const shown = dataLabel(key);
  return shown.includes(' – ') ? shown.split(' – ').slice(1).join(' – ') : shown;
}

/** rules.yaml what_to_check_next branches ("cond AND cond → label (team) · …") whose conditions all hold. */
export function matchedBranches(text: string, vars: Record<string, number | null | undefined>): { label: string; team: string | null }[] {
  const out: { label: string; team: string | null }[] = [];
  for (const branch of text.split(' · ')) {
    const parts = branch.split('→').map((x) => x.trim());
    if (parts.length < 2 || !parts[0]) continue;
    const ok = parts[0].split(/\s+AND\s+/).every((cond) => {
      const m = /^(\w+)\s*(>=|<=|>|<|==)\s*(-?\d+(?:\.\d+)?)$/.exec(cond.trim());
      if (!m) return false;
      const v = vars[m[1]!];
      if (v === null || v === undefined) return false;
      const n = Number(m[3]);
      return m[2] === '>=' ? v >= n : m[2] === '<=' ? v <= n : m[2] === '>' ? v > n : m[2] === '<' ? v < n : v === n;
    });
    if (!ok) continue;
    const label = parts[1]!;
    const team = /\(([^)]+)\)\s*$/.exec(label)?.[1] ?? null;
    out.push({ label, team });
  }
  return out;
}

export function analyze(input: InsightInput): Analysis {
  return analyzeGa4(input) ?? empty();
}

function empty(): Analysis {
  return { kind: 'none', finding: '', facts: [], lead: null, inconclusive: true, evidence: [], limitations: [] };
}

const usable = (r: ComparisonRow | undefined): r is ComparisonRow & { previous: number; current: number } =>
  !!r && r.previous !== null && r.current !== null && r.previous > 0;

/** The rule's result for this figure: the stored M1 / M2 result, else the threshold check (the same one the engine makes). */
function judge(rule: RuleInfo | undefined, abs: number, rate: number, stored: MeasurementStatus | undefined): Fact['rule'] {
  if (!rule) return null;
  const unit = rule.thresholdUnit === 'percent' || rule.thresholdUnit === 'percentage_points' ? rule.thresholdUnit : null;
  const value = unit && rule.thresholdValue !== null ? rule.thresholdValue : null;
  const result: MeasurementStatus = stored ?? (value === null ? 'NOT_EVALUABLE' : Math.abs(unit === 'percent' ? rate : abs) >= value ? 'NG' : 'OK');
  return { code: rule.code, value, unit, result };
}

function fact(label: string, r: ComparisonRow & { previous: number; current: number }, rule?: RuleInfo, results?: Record<string, MeasurementStatus>): Fact {
  const rate = r.changeRate ?? ((r.current - r.previous) / r.previous) * 100;
  const abs = r.absoluteChange ?? r.current - r.previous;
  return { label, metric: r.metric, previous: r.previous, current: r.current, abs, rate, rule: judge(rule, abs, rate, rule ? results?.[rule.code] : undefined) };
}

/** Beyond the rule's threshold = a real move; inside it = stable. Without a usable result, the sign decides. */
const dirOf = (f: Fact): Dir => {
  const sign: Dir = f.rate > 0 ? 'up' : f.rate < 0 ? 'down' : 'flat';
  return f.rule && f.rule.result !== 'NOT_EVALUABLE' ? (f.rule.result === 'NG' ? sign : 'flat') : sign;
};

// ---------------------------------------------------------------- wording

/** "±3.9%" or "±0.7 pt": the threshold with its unit. */
const limit = (r: NonNullable<Fact['rule']>) => (r.unit === 'percentage_points' ? `±${r.value} pt` : `±${r.value}%`);
const judged = (f: Fact) => (f.rule && f.rule.value !== null ? f.rule : null);
const unchanged = (f: Fact) => Math.abs(f.rate) < 0.005;

/** "Sessions decreased by 3.03%, remaining within the configured ±3.9% M1 threshold." */
function sessionsLine(f: Fact): string {
  if (unchanged(f)) return t('Sessions did not change.');
  const r = judged(f);
  const vars = { pct: pct(f.rate), th: r ? limit(r) : '', code: r?.code ?? '' };
  const up = f.rate > 0;
  if (r?.result === 'OK') return t(up ? 'Sessions increased by {pct}, remaining within the configured {th} {code} threshold.' : 'Sessions decreased by {pct}, remaining within the configured {th} {code} threshold.', vars);
  if (r?.result === 'NG') return t(up ? 'Sessions increased by {pct}, beyond the configured {th} {code} threshold.' : 'Sessions decreased by {pct}, beyond the configured {th} {code} threshold.', vars);
  return t(up ? 'Sessions increased by {pct}.' : 'Sessions decreased by {pct}.', vars);
}

/** "Overall CVR improved from 0.877% to 0.892% (+1.68% relative)." */
function cvrLine(f: Fact): string {
  const r = judged(f);
  const vars = { from: fmtValue('cvr', f.previous), to: fmtValue('cvr', f.current), rate: fmtRate(f.rate), th: r ? limit(r) : '', code: r?.code ?? '' };
  if (unchanged(f)) return t('Overall CVR did not change ({to}).', vars);
  if (r?.result === 'OK') return t('Overall CVR stayed within the configured {th} {code} threshold ({from} → {to}, {rate} relative).', vars);
  return t(f.rate > 0 ? 'Overall CVR improved from {from} to {to} ({rate} relative).' : 'Overall CVR declined from {from} to {to} ({rate} relative).', vars);
}

/** "Other / unattributed CVR improved by 90.30%, while its sessions changed by only −0.26%." */
function sourceLine(c: Contribution, sessions: Fact): string {
  const limitValue = judged(sessions)?.value;
  const small = limitValue != null ? Math.abs(c.sessRate) < limitValue : Math.abs(c.sessRate) < Math.abs(c.cvrRate) / 10;
  const vars = { name: c.name, cvr: pct(c.cvrRate), sess: fmtRate(c.sessRate) };
  if (c.cvrRate > 0) return t(small ? '{name} CVR improved by {cvr}, while its sessions changed by only {sess}.' : '{name} CVR improved by {cvr}, while its sessions changed by {sess}.', vars);
  return t(small ? '{name} CVR declined by {cvr}, while its sessions changed by only {sess}.' : '{name} CVR declined by {cvr}, while its sessions changed by {sess}.', vars);
}

type State = 'none' | 'ne' | 'ok' | 'ng';
const stateOf = (f: Fact): State => (!f.rule ? 'none' : f.rule.result === 'NOT_EVALUABLE' ? 'ne' : f.rule.result === 'NG' ? 'ng' : 'ok');

const TRAFFIC: Record<'up' | 'down', Record<State, string>> = {
  up: {
    none: 'Traffic increased by {pct}',
    ne: 'Traffic increased, but {code} could not be evaluated',
    ok: 'Traffic increased slightly but remained within the {code} threshold',
    ng: 'Traffic increased beyond the {code} threshold',
  },
  down: {
    none: 'Traffic decreased by {pct}',
    ne: 'Traffic decreased, but {code} could not be evaluated',
    ok: 'Traffic decreased slightly but remained within the {code} threshold',
    ng: 'Traffic decreased beyond the {code} threshold',
  },
};
const CONVERSION: Record<'up' | 'down', Record<State, string>> = {
  up: {
    none: 'conversion rate improved by {pct}',
    ne: 'conversion rate improved, but {code} could not be evaluated',
    ok: 'conversion rate improved slightly but remained within the {code} threshold',
    ng: 'conversion rate improved beyond the {code} threshold',
  },
  down: {
    none: 'conversion rate declined by {pct}',
    ne: 'conversion rate declined, but {code} could not be evaluated',
    ok: 'conversion rate declined slightly but remained within the {code} threshold',
    ng: 'conversion rate declined beyond the {code} threshold',
  },
};

/** One sentence from the M1 (traffic) and M2 (conversion rate) results, e.g. "Traffic decreased slightly but remained within the M1 threshold, while conversion rate improved beyond the M2 threshold." */
function findingGa4(s: Fact, c: Fact): string {
  const [sState, cState] = [stateOf(s), stateOf(c)];
  const [m1, m2] = [s.rule?.code ?? 'M1', c.rule?.code ?? 'M2'];
  if (sState === 'ne' && cState === 'ne') return t('Traffic and conversion rate could not be evaluated against {m1} and {m2}.', { m1, m2 });
  if (sState === 'ok' && cState === 'ok') return t('No significant change: traffic and conversion rate both stayed within their thresholds ({m1}, {m2}).', { m1, m2 });
  const clause = (f: Fact, table: typeof TRAFFIC, none: string) =>
    unchanged(f) ? t(none) : t(table[f.rate > 0 ? 'up' : 'down'][stateOf(f)], { pct: pct(f.rate), code: f.rule?.code ?? '' });
  return t('{a}, while {b}.', { a: clause(s, TRAFFIC, 'Traffic was unchanged'), b: clause(c, CONVERSION, 'conversion rate was unchanged') });
}

// ---------------------------------------------------------------- GA4

function analyzeGa4(input: InsightInput): Analysis | null {
  const seg = input.segments;
  if (!seg) return null;
  const row = (key: string, metric: string) => input.rows.find((r) => r.source === 'GA4' && r.subjectKey === key && r.metric === metric);
  const S = row(seg.total, 'sessions');
  const P = row(seg.total, input.purchasesMetric);
  const C = row(seg.total, 'cvr');
  if (!usable(S) || !usable(P) || !usable(C) || P.current <= 0) return null;

  const ruleOf = (metric: string) => input.rules.find((r) => r.source === 'GA4' && r.subject === 'total' && r.metric === metric);
  const fS = fact(t('Sessions'), S, ruleOf('sessions'), input.results);
  const fP = fact(t('Purchases'), P);
  const fC = fact(t('Conversion rate (CVR)'), C, ruleOf('cvr'), input.results);
  const dS = dirOf(fS);
  const dC = dirOf(fC);
  /** The CVR threshold, used as the reference for "a real move" inside one source. */
  const cvrLimit = judged(fC)?.value ?? 0;

  // Purchases = sessions × CVR: log changes add up exactly, so each part's share of the purchase change is exact.
  const lS = ln(S.previous, S.current);
  const lC = ln(C.previous, C.current);
  const effShare = Math.abs(lS) + Math.abs(lC) > 0 ? Math.abs(lC) / (Math.abs(lS) + Math.abs(lC)) : null;

  // Traffic sources (and the unattributed remainder) for the mix / within-source split of the CVR change.
  type SourceTotals = { name: string; sessions: [number, number]; purchases: [number, number]; cvr: [number, number] };
  const sources: SourceTotals[] = [];
  for (const key of seg.all.filter((k) => k !== seg.total)) {
    const s = row(key, 'sessions');
    const p = row(key, input.purchasesMetric);
    if (!usable(s) || !p || p.previous === null || p.current === null) continue;
    sources.push({ name: sourceName(key, seg.total), sessions: [s.previous, s.current], purchases: [p.previous, p.current], cvr: [(p.previous / s.previous) * 100, s.current ? (p.current / s.current) * 100 : 0] });
  }
  const sum = (i: 0 | 1, k: 'sessions' | 'purchases') => sources.reduce((a, x) => a + x[k][i], 0);
  const rest = { s: [S.previous - sum(0, 'sessions'), S.current - sum(1, 'sessions')], p: [P.previous - sum(0, 'purchases'), P.current - sum(1, 'purchases')] };
  const partitionOk = sources.length > 0 && rest.s[0]! >= 0 && rest.s[1]! >= 0 && rest.p[0]! >= 0 && rest.p[1]! >= 0;
  const limitations: string[] = [];
  if (partitionOk && rest.s[0]! > 0 && rest.s[1]! > 0)
    sources.push({ name: t('Other / unattributed'), sessions: [rest.s[0]!, rest.s[1]!], purchases: [rest.p[0]!, rest.p[1]!], cvr: [(rest.p[0]! / rest.s[0]!) * 100, (rest.p[1]! / rest.s[1]!) * 100] });
  if (sources.length && !partitionOk) limitations.push(t('The traffic sources overlap or exceed the site total, so the traffic-mix analysis is not possible.'));
  if (!sources.length) limitations.push(t('No traffic-source breakdown is available, so effects cannot be traced to a source.'));

  let mix = 0;
  let within = 0;
  const contrib: Contribution[] = [];
  if (partitionOk) {
    for (const x of sources) {
      const w0 = x.sessions[0] / S.previous;
      const w1 = x.sessions[1] / S.current;
      mix += (w1 - w0) * x.cvr[0];
      within += w1 * (x.cvr[1] - x.cvr[0]);
      contrib.push({
        name: x.name,
        within: w1 * (x.cvr[1] - x.cvr[0]),
        dSessions: x.sessions[1] - x.sessions[0],
        cvrRate: ((x.cvr[1] - x.cvr[0]) / x.cvr[0]) * 100,
        sessRate: ((x.sessions[1] - x.sessions[0]) / x.sessions[0]) * 100,
        purRate: x.purchases[0] ? ((x.purchases[1] - x.purchases[0]) / x.purchases[0]) * 100 : 0,
      });
    }
  }
  const dCvr = C.current - C.previous;
  const vars: Record<string, number | null | undefined> = {
    sessions_wow_percent: fS.rate,
    total_sessions_wow_percent: fS.rate,
    purchases_wow_percent: fP.rate,
    cvr_wow_percent: fC.rate,
    organic_sessions_wow_percent: row(seg.organic, 'sessions')?.changeRate,
    advertising_sessions_wow_percent: row(seg.advertising, 'sessions')?.changeRate,
  };
  const ruleMappings = input.rules.filter((r) => r.source === 'GA4').flatMap((r) => matchedBranches(r.whatToCheckNext, vars).map((m) => ({ code: r.code, ...m })));

  const missingFunnel = t('Funnel-step metrics (product views, add-to-cart, checkout) are not in the uploaded GA4 export.');
  const missingLanding = t('Landing-page-level data is not available in the uploaded GA4 export.');
  const missingGsc = input.gscAvailable ? null : t('No Search Console daily data covers these weeks, so organic visibility (clicks, impressions, position) cannot be checked.');
  const sessions = sessionsLine(fS);
  const conversion = cvrLine(fC);

  const hyps: Hypothesis[] = [];
  const efficiencyMoved = dC !== 'flat';

  // A. Conversion efficiency changed within the traffic sources (funnel side), not because of more / less traffic.
  if (efficiencyMoved) {
    const volumeNotDriver = dS === 'flat' || (dS === 'up') !== (dC === 'up');
    const core = [true, volumeNotDriver, ...(effShare !== null ? [effShare >= 0.5] : [])];
    const extra: boolean[] = [];
    let agreeing = 0;
    if (contrib.length) {
      extra.push(Math.sign(within) === Math.sign(dCvr) && Math.abs(within) > Math.abs(mix));
      agreeing = contrib.filter((c) => Math.sign(c.cvrRate) === Math.sign(fC.rate)).length;
      extra.push(agreeing > contrib.length / 2);
      if (agreeing < contrib.length) extra.push(false); // a source moved the other way
    }
    const confidence: Confidence = !core.every(Boolean) ? 'Low' : extra.length && extra.every(Boolean) ? 'High' : 'Medium';
    hyps.push({
      id: 'efficiency',
      title: dC === 'down' ? t('Purchase conversion efficiency declined') : t('Purchase conversion efficiency improved'),
      confidence,
      evidence: [
        conversion,
        sessions,
        ...(contrib.length ? [t(dC === 'down' ? 'CVR declined in {n} of {m} traffic sources.' : 'CVR improved in {n} of {m} traffic sources.', { n: agreeing, m: contrib.length })] : []),
      ],
      action: dC === 'down'
        ? t('Compare landing-page engagement and product-page views for the two weeks.')
        : t('Identify which pages or funnel steps improved, using a GA4 funnel exploration for both weeks.'),
      missing: [missingFunnel, missingLanding],
    });
  }

  // B. The CVR change is concentrated in one traffic source (e.g. Organic Search or Paid).
  if (efficiencyMoved && contrib.length) {
    const sameSign = contrib.filter((c) => Math.sign(c.within) === Math.sign(dCvr));
    const totalSame = sameSign.reduce((a, c) => a + Math.abs(c.within), 0);
    const top = [...sameSign].sort((a, b) => Math.abs(b.within) - Math.abs(a.within))[0];
    if (top && totalSame > 0) {
      const concentrated = Math.abs(top.within) / totalSame >= 0.6;
      const realMove = Math.abs(top.cvrRate) >= cvrLimit;
      const pattern = top.sessRate > 0 && top.purRate < 0 && top.cvrRate < 0;
      const confidence: Confidence = concentrated && realMove ? (pattern || dC === 'up' ? 'Medium' : 'Low') : 'Low';
      const isOrganic = /organic|オーガニック/i.test(top.name);
      const isPaid = /paid|ペイド|広告/i.test(top.name);
      hyps.push({
        id: `source:${top.name}`,
        title: dC === 'down' ? t('CVR decline is concentrated in {name}', { name: top.name }) : t('CVR improvement is concentrated in {name}', { name: top.name }),
        confidence,
        evidence: [conversion, sessions, ...(Number.isFinite(top.cvrRate) ? [sourceLine(top, fS)] : [])],
        action: isOrganic
          ? t('Compare organic landing pages and their conversion for the two weeks.')
          : isPaid
            ? t('Review campaign traffic, targeting and landing pages for the two weeks.')
            : t('Compare landing pages and the purchase funnel for {name} traffic across both weeks.', { name: top.name }),
        missing: [missingLanding, ...(isOrganic && missingGsc ? [missingGsc] : [])],
      });
    }
  }

  // When one source holds most of the change, the site-wide funnel framing is the less specific explanation.
  if (hyps.some((h) => h.id.startsWith('source:') && h.confidence !== 'Low')) {
    const site = hyps.find((h) => h.id === 'efficiency');
    if (site) site.confidence = 'Low';
  }

  // C. Traffic mix shifted toward sources that convert worse (or better).
  if (efficiencyMoved && contrib.length) {
    const ok = Math.sign(mix) === Math.sign(dCvr) && Math.abs(mix) > Math.abs(within);
    hyps.push({
      id: 'mix',
      title: t('Traffic shifted toward sources with a different conversion rate'),
      confidence: ok ? 'Medium' : 'Low',
      evidence: [conversion, ok ? t('Shifts in traffic mix account for most of the CVR change.') : t('Shifts in traffic mix explain little of the CVR change.'), sessions],
      action: t('Compare session share by traffic source for the two weeks.'),
      missing: [],
    });
  }

  // D. Traffic volume changed (acquisition), with conversion efficiency holding.
  if (dS !== 'flat') {
    const top = [...contrib].filter((c) => Math.sign(c.dSessions) === Math.sign(fS.abs)).sort((a, b) => Math.abs(b.dSessions) - Math.abs(a.dSessions))[0];
    const topShare = top && fS.abs ? Math.abs(top.dSessions) / Math.abs(fS.abs) : null;
    const core = [true, dC === 'flat', ...(effShare !== null ? [effShare < 0.5] : [])];
    const specific = !!top && topShare !== null && topShare >= 0.6;
    const confidence: Confidence = !core.every(Boolean) ? 'Low' : specific ? 'High' : 'Medium';
    const isOrganic = !!top && /organic|オーガニック/i.test(top.name);
    const isPaid = !!top && /paid|ペイド|広告/i.test(top.name);
    hyps.push({
      id: 'volume',
      title: fS.rate < 0 ? t('Traffic acquisition volume declined') : t('Traffic acquisition volume increased'),
      confidence,
      evidence: [sessions, conversion, ...(top && topShare !== null ? [t('{name} accounts for {share} of the session change ({abs}).', { name: top.name, share: share(topShare), abs: fmtDiff('sessions', top.dSessions) })] : [])],
      action: isOrganic
        ? t('Check organic visibility for the two weeks in Search Console: clicks, impressions, average position (GSC_R01).')
        : isPaid
          ? t('Check campaign delivery for the two weeks: impressions, clicks, budget caps, paused campaigns. Do not change spend until the cause is established.')
          : t('Break the session change down by traffic source and landing page for the two weeks.'),
      missing: isOrganic && missingGsc ? [missingGsc] : isPaid ? [t('Campaign-level data (impressions, clicks, spend) is not in the uploaded data.')] : [],
    });
  }

  // E. The rules.yaml mapping for this pattern, tested against the source split (e.g. "traffic quality issue").
  for (const m of ruleMappings.filter((x) => /quality/i.test(x.label))) {
    // A traffic-quality problem should sit in the sources that brought more visits.
    const down = contrib.filter((c) => c.cvrRate < 0);
    const withGrowth = down.filter((c) => c.sessRate > 0);
    const ok = down.length > 0 && withGrowth.length === down.length;
    hyps.push({
      id: `rule:${m.code}`,
      title: t('Traffic quality issue (rules.yaml {code} mapping)', { code: m.code }),
      confidence: contrib.length ? (ok ? 'Medium' : 'Low') : 'Low',
      evidence: [
        ...(contrib.length ? [t('CVR fell in {n} source(s); {k} of them had more sessions ({list}).', { n: down.length, k: withGrowth.length, list: down.slice(0, 2).map((c) => `${c.name} ${fmtRate(c.sessRate)}`).join(', ') || '—' })] : []),
        conversion,
        sessions,
      ],
      action: t('Compare engagement and conversion of new vs returning visitors by source for the two weeks.'),
      missing: [t('Engagement metrics for new visitors (bounce, engagement time) are not in the uploaded data.')],
    });
  }

  hyps.sort((a, b) => RANK[b.confidence] - RANK[a.confidence] || order(a.id) - order(b.id));
  // Where the change sits (site-wide / one source / mix / volume) are competing explanations; the rules.yaml mapping
  // explains why within them. Several competing ones equally supported, or none above Low: the cause is not established.
  const competing = hyps.filter((h) => !h.id.startsWith('rule:'));
  const inconclusive = !competing.length || competing[0]!.confidence === 'Low' || (competing.length > 1 && competing[1]!.confidence === competing[0]!.confidence && competing[0]!.confidence !== 'High');
  const conflicting = (dS === 'up' && dC === 'down' && fP.rate > 0) || (dS === 'down' && dC === 'up' && fP.rate < 0);
  const lead = (inconclusive ? competing : hyps)[0] ?? null;

  return {
    kind: 'ga4',
    finding: findingGa4(fS, fC),
    facts: [fS, fP, fC],
    lead,
    inconclusive: inconclusive || conflicting,
    evidence: (lead ? lead.evidence : [sessions, conversion]).slice(0, 3),
    limitations,
  };
}

function order(id: string) {
  return id.startsWith('source:') ? 0 : id === 'efficiency' ? 1 : id === 'volume' ? 2 : id === 'mix' ? 3 : 4;
}
