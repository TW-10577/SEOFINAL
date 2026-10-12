import type { ComparisonRow } from '@seo/shared';
import { fmtDiff, fmtRate, fmtValue } from './format.ts';
import { dataLabel, t } from './i18n.ts';

// Evidence-based week-on-week insights. Everything is derived from the comparison rows of the selected period and the
// rules.yaml rules (thresholds and cause branches). Two exact identities make the evidence:
//   purchases = sessions × CVR / 100      → the purchase change splits into a traffic part and an efficiency part
//   total CVR = Σ (session share × CVR) → the CVR change splits into a traffic-mix part and a within-source part
// Confidence comes from whether these independent signals agree, never from a fixed score. Nothing is a confirmed
// root cause: the SEO team confirms causes on the Measurements page.

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
  /** The rules.yaml threshold that judges this figure, and whether the change went beyond it. */
  threshold: { code: string; value: number; exceeded: boolean } | null;
}

export interface SourceFact {
  name: string;
  sessions: [number, number];
  purchases: [number, number];
  cvr: [number, number];
  /** Derived: total minus the listed traffic sources. */
  derived?: boolean;
}

export interface Signal {
  ok: boolean;
  text: string;
}

export interface Hypothesis {
  id: string;
  title: string;
  confidence: Confidence;
  /** Why the confidence is what it is (strength, consistency, completeness). */
  basis: string;
  /** Evidence checked for this hypothesis: ok = supports it, !ok = speaks against it. */
  signals: Signal[];
  missing: string[];
  checks: string[];
  confirm: string;
  reject: string;
  /** Team from a matching rules.yaml branch only. */
  team: string | null;
}

export interface Analysis {
  kind: 'ga4' | 'gsc' | 'none';
  finding: string;
  facts: Fact[];
  sources: SourceFact[];
  /** Ranked, most plausible first. */
  hypotheses: Hypothesis[];
  inconclusive: boolean;
  /** rules.yaml branches whose conditions the figures meet. */
  ruleMappings: { code: string; label: string; team: string | null }[];
  limitations: string[];
}

export interface InsightInput {
  rows: ComparisonRow[];
  rules: RuleInfo[];
  segments: { total: string; organic: string; advertising: string; all: string[] } | null;
  purchasesMetric: string;
  /** Search Console daily data covers the compared weeks. */
  gscAvailable: boolean;
}

const RANK: Record<Confidence, number> = { High: 3, Medium: 2, Low: 1 };
const ln = (a: number, b: number) => Math.log(b / a);
const pct = (v: number) => `${Math.abs(v).toFixed(2)}%`;
const share = (v: number) => `${Math.round(v * 100)}%`;
const pp = (v: number) => fmtDiff('cvr', v);
/** ", beyond the ±3.9% threshold of M1" — or nothing when no rule judges the figure. */
const beyond = (r: RuleInfo | undefined) => (r ? t(', beyond the ±{v}% threshold of {code}', { v: r.thresholdValue!, code: r.code }) : '');

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

export function analyze(input: InputOrNull): Analysis {
  if (!input) return empty();
  const ga4 = analyzeGa4(input);
  if (ga4) return ga4;
  const gsc = analyzeGsc(input);
  return gsc ?? empty();
}
type InputOrNull = InsightInput | null;

function empty(): Analysis {
  return { kind: 'none', finding: '', facts: [], sources: [], hypotheses: [], inconclusive: true, ruleMappings: [], limitations: [] };
}

const usable = (r: ComparisonRow | undefined): r is ComparisonRow & { previous: number; current: number } =>
  !!r && r.previous !== null && r.current !== null && r.previous > 0;

function fact(label: string, r: ComparisonRow & { previous: number; current: number }, rule: RuleInfo | undefined): Fact {
  const rate = r.changeRate ?? ((r.current - r.previous) / r.previous) * 100;
  return {
    label,
    metric: r.metric,
    previous: r.previous,
    current: r.current,
    abs: r.absoluteChange ?? r.current - r.previous,
    rate,
    threshold: rule && rule.thresholdValue !== null ? { code: rule.code, value: rule.thresholdValue, exceeded: Math.abs(rate) >= rule.thresholdValue } : null,
  };
}

/** Beyond the rule's threshold = a real move; inside it = stable. Without a rule, the sign decides. */
const dirOf = (f: Fact): Dir => (f.threshold ? (f.threshold.exceeded ? (f.rate > 0 ? 'up' : 'down') : 'flat') : f.rate > 0 ? 'up' : f.rate < 0 ? 'down' : 'flat');

// ---------------------------------------------------------------- GA4

function analyzeGa4(input: InsightInput): Analysis | null {
  const seg = input.segments;
  if (!seg) return null;
  const row = (key: string, metric: string) => input.rows.find((r) => r.source === 'GA4' && r.subjectKey === key && r.metric === metric);
  const S = row(seg.total, 'sessions');
  const P = row(seg.total, input.purchasesMetric);
  const C = row(seg.total, 'cvr');
  if (!usable(S) || !usable(P) || !usable(C) || P.current <= 0) return null;

  const rule = (metric: string) => input.rules.find((r) => r.source === 'GA4' && r.subject === 'total' && r.metric === metric && r.thresholdUnit === 'percent' && r.thresholdValue !== null);
  const rS = rule('sessions');
  const rC = rule('cvr');
  const fS = fact(t('Sessions'), S, rS);
  const fP = fact(t('Purchases'), P, undefined);
  const fC = fact(t('Conversion rate (CVR)'), C, rC);
  const dS = dirOf(fS);
  const dC = dirOf(fC);

  // Purchases = sessions × CVR: log changes add up exactly, so each part's share of the purchase change is exact.
  const lS = ln(S.previous, S.current);
  const lC = ln(C.previous, C.current);
  const effShare = Math.abs(lS) + Math.abs(lC) > 0 ? Math.abs(lC) / (Math.abs(lS) + Math.abs(lC)) : null;

  // Traffic sources (and the unattributed remainder) for the mix / within-source split of the CVR change.
  const sources: SourceFact[] = [];
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
    sources.push({ name: t('Other / unattributed'), derived: true, sessions: [rest.s[0]!, rest.s[1]!], purchases: [rest.p[0]!, rest.p[1]!], cvr: [(rest.p[0]! / rest.s[0]!) * 100, (rest.p[1]! / rest.s[1]!) * 100] });
  if (sources.length && !partitionOk) limitations.push(t('The traffic sources overlap or exceed the site total, so the traffic-mix analysis is not possible.'));
  if (!sources.length) limitations.push(t('No traffic-source breakdown is available, so effects cannot be traced to a source.'));

  let mix = 0;
  let within = 0;
  const contrib: { name: string; within: number; dSessions: number; cvrRate: number; sessRate: number; purRate: number }[] = [];
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
  const missingLanding = t('Landing-page level data is not in the uploaded GA4 export.');
  const missingGsc = input.gscAvailable ? null : t('No Search Console daily data covers these weeks, so organic visibility (clicks, impressions, position) cannot be checked.');

  const hyps: Hypothesis[] = [];
  const efficiencyMoved = dC !== 'flat';
  const word = dC === 'down' ? t('declined') : t('improved');

  // A. Conversion efficiency changed within the traffic sources (funnel side), not because of more / less traffic.
  if (efficiencyMoved) {
    const core: Signal[] = [];
    core.push({ ok: true, text: t('CVR changed {rate} ({pp}){beyond}.', { rate: fmtRate(fC.rate), pp: pp(fC.abs), beyond: beyond(rC) }) });
    const volumeNotDriver = dS === 'flat' || (dS === 'up') !== (dC === 'up');
    core.push({
      ok: volumeNotDriver,
      text: dS === 'flat'
        ? rS
          ? t('Sessions stayed within the ±{v}% threshold of {code} ({rate}), so traffic volume did not drive the change.', { v: rS.thresholdValue!, code: rS.code, rate: fmtRate(fS.rate) })
          : t('Sessions did not change ({rate}).', { rate: fmtRate(fS.rate) })
        : t('Sessions also moved beyond their threshold ({rate}).', { rate: fmtRate(fS.rate) }),
    });
    if (effShare !== null)
      core.push({ ok: effShare >= 0.5, text: t('Purchases = sessions × CVR: {share} of the purchase change ({rate}) comes from the CVR change, {rest} from traffic volume.', { share: share(effShare), rest: share(1 - effShare), rate: fmtRate(fP.rate) }) });
    const extra: Signal[] = [];
    if (contrib.length) {
      extra.push({
        ok: Math.sign(within) === Math.sign(dCvr) && Math.abs(within) > Math.abs(mix),
        text: t('Of the CVR change ({total}), {within} comes from conversion within the traffic sources and {mix} from a shift in traffic mix.', { total: pp(dCvr), within: pp(within), mix: pp(mix) }),
      });
      const same = contrib.filter((c) => Math.sign(c.cvrRate) === Math.sign(fC.rate));
      const others = contrib.filter((c) => Math.sign(c.cvrRate) !== Math.sign(fC.rate));
      extra.push({
        ok: same.length > contrib.length / 2,
        text: t('CVR {word} in {n} of {m} traffic sources: {list}.', { word, n: same.length, m: contrib.length, list: same.map((c) => `${c.name} ${fmtRate(c.cvrRate)}`).join(', ') || '—' }),
      });
      if (others.length) extra.push({ ok: false, text: t('Exception: {list}.', { list: others.map((c) => `${c.name} CVR ${fmtRate(c.cvrRate)}`).join(', ') }) });
    }
    const signals = [...core, ...extra];
    const coreOk = core.every((x) => x.ok);
    const segmentEvidence = extra;
    const confidence: Confidence = !coreOk ? 'Low' : segmentEvidence.length && segmentEvidence.every((x) => x.ok) ? 'High' : 'Medium';
    const basis =
      confidence === 'High'
        ? t('The threshold result, the purchase split and the traffic-source split all point the same way.')
        : confidence === 'Medium'
          ? segmentEvidence.length
            ? t('The site-level evidence is consistent, but not every traffic source moved the same way, and funnel-step data is unavailable to locate the stage.')
            : t('The site-level evidence is consistent, but no traffic-source breakdown is available to test it further.')
          : t('The site-level signals do not agree, so this explanation is weakly supported.');
    hyps.push({
      id: 'efficiency',
      title: dC === 'down' ? t('Purchase conversion efficiency declined') : t('Purchase conversion efficiency improved'),
      confidence,
      basis,
      signals,
      missing: [missingFunnel, missingLanding],
      checks: dC === 'down'
        ? [t('Compare landing-page engagement and product-page views for the two weeks.'), t('Check add-to-cart rate and checkout completion in a GA4 funnel exploration for both weeks.'), t('Check for on-site changes in the current week: releases, pricing, stock availability, checkout errors.')]
        : [t('Identify which pages or funnel steps improved, using a GA4 funnel exploration for both weeks.'), t('Check for on-site changes in the current week (releases, promotions, pricing) that could explain it.')],
      confirm: t('A drop (or rise) at a specific funnel step that appears across traffic sources.'),
      reject: t('Funnel steps unchanged, or the change limited to a few landing pages or a single source.'),
      team: null,
    });
  }

  // B. The CVR change is concentrated in one traffic source (e.g. Organic Search or Paid).
  if (efficiencyMoved && contrib.length) {
    const sameSign = contrib.filter((c) => Math.sign(c.within) === Math.sign(dCvr));
    const totalSame = sameSign.reduce((a, c) => a + Math.abs(c.within), 0);
    const top = [...sameSign].sort((a, b) => Math.abs(b.within) - Math.abs(a.within))[0];
    if (top && totalSame > 0) {
      const topShare = Math.abs(top.within) / totalSame;
      const pattern = top.sessRate > 0 && top.purRate < 0 && top.cvrRate < 0;
      const concentrated = topShare >= 0.6;
      const signals: Signal[] = [
        { ok: concentrated, text: t('{name} accounts for {share} of the within-source CVR change ({value}).', { name: top.name, share: share(topShare), value: pp(top.within) }) },
        { ok: Math.abs(top.cvrRate) >= (rC?.thresholdValue ?? 0), text: rC ? t('{name} CVR {rate} ({code} threshold ±{v}% used as reference).', { name: top.name, rate: fmtRate(top.cvrRate), code: rC.code, v: rC.thresholdValue! }) : t('{name} CVR {rate}.', { name: top.name, rate: fmtRate(top.cvrRate) }) },
        { ok: pattern || dC === 'up', text: t('{name}: sessions {s}, purchases {p}.', { name: top.name, s: fmtRate(top.sessRate), p: fmtRate(top.purRate) }) },
      ];
      const confidence: Confidence = concentrated && signals[1]!.ok ? (signals[2]!.ok ? 'Medium' : 'Low') : 'Low';
      const isOrganic = /organic|オーガニック/i.test(top.name);
      const isPaid = /paid|ペイド|広告/i.test(top.name);
      hyps.push({
        id: `source:${top.name}`,
        title: dC === 'down' ? t('{name} traffic is converting less efficiently', { name: top.name }) : t('{name} traffic is converting more efficiently', { name: top.name }),
        confidence,
        basis: concentrated
          ? t('Most of the CVR change sits in one traffic source; without landing-page or query data the reason inside that source cannot be established.')
          : t('The CVR change is spread across several sources ({name} has only {share}), so a single-source explanation is weak.', { name: top.name, share: share(topShare) }),
        signals,
        missing: [missingLanding, ...(isOrganic && missingGsc ? [missingGsc] : [])],
        checks: isOrganic
          ? [t('Compare organic landing pages and their conversion for the two weeks.'), t('Check search intent: Search Console queries and pages for both weeks (GSC_R01 needs the two weekly exports).')]
          : isPaid
            ? [t('Review campaign traffic, targeting and landing pages for the two weeks.'), t('Check the purchase funnel for paid sessions. Do not change spend until the cause is established.')]
            : [t('Compare landing pages and the purchase funnel for this source across the two weeks.')],
        confirm: t('The conversion drop appears on specific landing pages or queries of this source.'),
        reject: t('The source’s landing pages convert as before, or the change disappears when segmented further.'),
        team: null,
      });
    }
  }

  // When one source holds most of the change, the site-wide funnel framing is the less specific explanation.
  const concentrated = hyps.find((h) => h.id.startsWith('source:') && h.confidence !== 'Low');
  const site = hyps.find((h) => h.id === 'efficiency');
  if (concentrated && site) {
    site.confidence = 'Low';
    site.basis = t('The change is concentrated in {name}, so a site-wide funnel explanation fits less well.', { name: concentrated.id.slice(7) });
  }

  // C. Traffic mix shifted toward sources that convert worse (or better).
  if (efficiencyMoved && contrib.length) {
    const ok = Math.sign(mix) === Math.sign(dCvr) && Math.abs(mix) > Math.abs(within);
    hyps.push({
      id: 'mix',
      title: t('Traffic shifted toward sources with a different conversion rate'),
      confidence: ok ? 'Medium' : 'Low',
      basis: ok ? t('The mix effect explains most of the CVR change.') : t('The mix effect is smaller than the within-source effect or works in the opposite direction.'),
      signals: [{ ok, text: t('Traffic-mix effect on CVR: {mix} of the total {total}.', { mix: pp(mix), total: pp(dCvr) }) }],
      missing: [],
      checks: [t('Compare session share by traffic source for the two weeks.')],
      confirm: t('Session share moved toward lower-converting sources.'),
      reject: t('Session shares are stable or moved toward higher-converting sources.'),
      team: null,
    });
  }

  // D. Traffic volume changed (acquisition), with conversion efficiency holding.
  if (dS !== 'flat') {
    const top = [...contrib].filter((c) => Math.sign(c.dSessions) === Math.sign(fS.abs)).sort((a, b) => Math.abs(b.dSessions) - Math.abs(a.dSessions))[0];
    const topShare = top && fS.abs ? Math.abs(top.dSessions) / Math.abs(fS.abs) : null;
    const vCore: Signal[] = [
      { ok: true, text: t('Sessions changed {rate} ({abs}){beyond}.', { rate: fmtRate(fS.rate), abs: fmtDiff('sessions', fS.abs), beyond: beyond(rS) }) },
      { ok: dC === 'flat', text: dC === 'flat' ? t('CVR stayed within its threshold ({rate}), so efficiency did not drive the change.', { rate: fmtRate(fC.rate) }) : t('CVR also moved beyond its threshold ({rate}).', { rate: fmtRate(fC.rate) }) },
      ...(effShare !== null ? [{ ok: effShare < 0.5, text: t('{share} of the purchase change ({rate}) comes from traffic volume.', { share: share(1 - effShare), rate: fmtRate(fP.rate) }) }] : []),
    ];
    const vExtra: Signal[] = [
      ...(top && topShare !== null ? [{ ok: topShare >= 0.6, text: t('{name} accounts for {share} of the session change ({abs}).', { name: top.name, share: share(topShare), abs: fmtDiff('sessions', top.dSessions) }) }] : []),
    ];
    const signals = [...vCore, ...vExtra];
    const specific = top && topShare !== null && topShare >= 0.6;
    const confidence: Confidence = !vCore.every((x) => x.ok) ? 'Low' : specific ? 'High' : 'Medium';
    const m1 = ruleMappings.find((m) => m.code === rS?.code);
    const isOrganic = top && /organic|オーガニック/i.test(top.name);
    const isPaid = top && /paid|ペイド|広告/i.test(top.name);
    hyps.push({
      id: 'volume',
      title: fS.rate < 0 ? t('Traffic acquisition volume declined') : t('Traffic acquisition volume increased'),
      confidence,
      basis: confidence === 'High'
        ? t('The volume change is beyond its threshold, conversion held, and one traffic source accounts for most of it.')
        : confidence === 'Medium'
          ? t('The volume change explains the purchase change, but it is spread across sources (or no source breakdown is available).')
          : t('Conversion efficiency also moved, so volume alone does not explain the result.'),
      signals,
      missing: isOrganic && missingGsc ? [missingGsc] : isPaid ? [t('Campaign-level data (impressions, clicks, spend) is not in the uploaded data.')] : [],
      checks: isOrganic
        ? [t('Check organic visibility for the two weeks in Search Console: clicks, impressions, average position (GSC_R01).')]
        : isPaid
          ? [t('Check campaign delivery for the two weeks: impressions, clicks, budget caps, paused campaigns. Do not change spend until the cause is established.')]
          : [t('Break the session change down by traffic source and landing page for the two weeks.')],
      confirm: t('The session change traces to specific queries, pages or campaigns in that source.'),
      reject: t('Sessions moved evenly across sources and pages (e.g. seasonality or a site-wide tracking change).'),
      team: m1?.team ?? null,
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
      basis: !contrib.length
        ? t('The rule pattern matches, but without a source breakdown traffic quality cannot be separated from on-site conversion.')
        : ok
          ? t('CVR fell only in sources whose traffic grew, which fits lower-quality additional traffic.')
          : t('CVR also fell in sources whose traffic did not grow, which an on-site cause explains better than traffic quality.'),
      signals: [
        { ok: true, text: t('{code} branch matched: {label}.', { code: m.code, label: m.label }) },
        ...(contrib.length ? [{ ok, text: t('CVR fell in {n} source(s); {k} of them had more sessions ({list}).', { n: down.length, k: withGrowth.length, list: down.map((c) => `${c.name} ${t('sessions')} ${fmtRate(c.sessRate)}`).join(', ') || '—' }) }] : []),
      ],
      missing: [t('Engagement metrics for new visitors (bounce, engagement time) are not in the uploaded data.')],
      checks: [t('Compare engagement and conversion of new vs returning visitors by source for the two weeks.')],
      confirm: t('The additional visits show lower engagement and conversion than existing traffic.'),
      reject: t('New and existing visits convert alike; the drop is site-wide.'),
      team: m.team,
    });
  }

  hyps.sort((a, b) => RANK[b.confidence] - RANK[a.confidence] || order(a.id) - order(b.id));
  // Where the change sits (site-wide / one source / mix / volume) are competing explanations; the rules.yaml mapping
  // explains why within them. Several competing ones equally supported, or none above Low: inconclusive.
  const competing = hyps.filter((h) => !h.id.startsWith('rule:'));
  const inconclusive = !competing.length || competing[0]!.confidence === 'Low' || (competing.length > 1 && competing[1]!.confidence === competing[0]!.confidence && competing[0]!.confidence !== 'High');
  const conflicting = (dS === 'up' && dC === 'down' && fP.rate > 0) || (dS === 'down' && dC === 'up' && fP.rate < 0);

  return {
    kind: 'ga4',
    finding: findingGa4(dS, dC, fP.rate, conflicting, hyps[0]),
    facts: [fS, fP, fC],
    sources,
    hypotheses: hyps,
    inconclusive: inconclusive || conflicting,
    ruleMappings,
    limitations,
  };
}

function order(id: string) {
  return id.startsWith('source:') ? 0 : id === 'efficiency' ? 1 : id === 'volume' ? 2 : id === 'mix' ? 3 : 4;
}

function findingGa4(s: Dir, c: Dir, purchasesRate: number, conflicting: boolean, top: Hypothesis | undefined): string {
  if (conflicting) return t('Traffic and conversion moved in opposite directions; the evidence does not point to a single cause.');
  const key = `${s}-${c}`;
  const map: Record<string, string> = {
    'flat-down': 'Traffic remained nearly flat while purchase conversion efficiency declined.',
    'flat-up': 'Traffic remained nearly flat while purchase conversion efficiency improved.',
    'flat-flat': 'Traffic and purchase conversion efficiency both stayed within their thresholds.',
    'down-flat': purchasesRate < 0 ? 'Traffic declined while conversion efficiency held, so lower volume accounts for most of the purchase decline.' : 'Traffic declined while conversion efficiency held.',
    'down-down': 'Both traffic and purchase conversion efficiency declined.',
    'down-up': 'Fewer visits, but a higher share of them converted.',
    'up-flat': 'Traffic grew while conversion efficiency held.',
    'up-down': 'Traffic grew, but the additional visits converted less efficiently.',
    'up-up': 'Both traffic and purchase conversion efficiency improved.',
  };
  const base = t(map[key]!);
  return top?.id.startsWith('source:') && top.confidence !== 'Low' ? `${base} ${t('The change is concentrated in {name}.', { name: top.id.slice(7) })}` : base;
}

// ---------------------------------------------------------------- GSC (only Search Console metrics; no purchases or CVR)

function analyzeGsc(input: InsightInput): Analysis | null {
  const row = (metric: string) => input.rows.find((r) => r.source === 'GSC' && r.subjectType === 'site' && r.metric === metric);
  const K = row('clicks');
  const I = row('impressions');
  const T = row('ctr');
  const Pos = row('position');
  if (!usable(K) || !usable(I)) return null;
  const fK = fact(t('Clicks'), K, undefined);
  const fI = fact(t('Impressions'), I, undefined);
  const facts = [fK, fI, ...(usable(T) ? [fact('CTR', T, undefined)] : []), ...(usable(Pos) ? [fact(t('Average position'), Pos, undefined)] : [])];
  // Clicks = impressions × CTR: the click change splits into a visibility part and a CTR part.
  const lI = ln(I.previous, I.current);
  const lT = usable(T) ? ln(T.previous, T.current) : ln(I.current / I.previous, K.current / K.previous);
  const ctrShare = Math.abs(lI) + Math.abs(lT) > 0 ? Math.abs(lT) / (Math.abs(lI) + Math.abs(lT)) : 0;
  const posWorse = usable(Pos) ? Pos.current - Pos.previous : null; // > 0 = lower ranking
  const hyps: Hypothesis[] = [];
  const common = { missing: [t('Query and page changes need the Search Console exports of both weeks (GSC_R01).'), t('Search Console has no OK / NG threshold, so small changes may be normal variation.')], team: null };
  hyps.push({
    id: 'visibility',
    title: posWorse !== null && posWorse > 0 && fI.rate < 0 ? t('Search visibility declined (lower rankings)') : fI.rate < 0 ? t('Search demand or visibility declined') : t('Search visibility increased'),
    confidence: ctrShare < 0.5 && posWorse !== null && Math.sign(posWorse) === -Math.sign(fI.rate) ? 'Medium' : 'Low',
    basis: t('Based on site totals only; query- and page-level evidence is needed to locate the change.'),
    signals: [
      { ok: ctrShare < 0.5, text: t('{share} of the click change comes from impressions, {rest} from CTR.', { share: share(1 - ctrShare), rest: share(ctrShare) }) },
      ...(posWorse !== null ? [{ ok: Math.sign(posWorse) === -Math.sign(fI.rate), text: t('Average position {from} → {to} (lower is better).', { from: Pos!.previous!.toFixed(2), to: Pos!.current!.toFixed(2) }) }] : []),
    ],
    checks: [t('Compare queries and pages by impressions and position for the two weeks (GSC_R01).')],
    confirm: t('Impressions and position changed on specific queries or pages.'),
    reject: t('Impressions changed evenly across queries (seasonal demand).'),
    ...common,
  });
  hyps.push({
    id: 'ctr',
    title: t('Click-through rate from search results changed'),
    confidence: ctrShare >= 0.5 && posWorse !== null && Math.abs(posWorse) < 0.5 ? 'Medium' : 'Low',
    basis: t('Based on site totals only; query- and page-level evidence is needed to locate the change.'),
    signals: [{ ok: ctrShare >= 0.5, text: t('{share} of the click change comes from CTR.', { share: share(ctrShare) }) }],
    checks: [t('Check titles, descriptions and search-result features for the main queries.')],
    confirm: t('CTR changed on queries whose position stayed the same.'),
    reject: t('CTR moved together with position.'),
    ...common,
  });
  hyps.sort((a, b) => RANK[b.confidence] - RANK[a.confidence]);
  return {
    kind: 'gsc',
    finding: t('Search clicks {verb} {rate}: {share} of the change comes from impressions and {rest} from click-through rate.', { verb: fK.rate < 0 ? t('fell') : t('rose'), rate: pct(fK.rate), share: share(1 - ctrShare), rest: share(ctrShare) }),
    facts,
    sources: [],
    hypotheses: hyps,
    inconclusive: hyps[0]!.confidence === 'Low',
    ruleMappings: [],
    limitations: [t('Search Console data has no purchases or CVR; conversion causes cannot be assessed from it.')],
  };
}

/** Value formatting for facts (re-exported for the UI). */
export { fmtValue, fmtDiff, fmtRate };
