import type { Comparison, FlatBand, Priority, SourceKind } from './types.ts'

// Output of SuggestCause: a cause hypothesis and the countermeasure that answers it.
export interface Suggestion {
  hypothesis: string
  supportingEvidence: string
  rule: string
  ruleConfirmed: boolean
  description: string
  ownerTeam: string
  priority: Priority
}

export function formatChange(c: Pick<Comparison, 'kind' | 'absoluteChange' | 'changePercentage'>): string {
  const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '±')
  if (c.kind === 'relative') {
    const p = c.changePercentage ?? 0
    return `${sign(p)}${Math.abs(p).toFixed(1)}%`
  }
  const unit = c.kind === 'points' ? ' pt' : ' rank'
  return `${sign(c.absoluteChange)}${Math.abs(c.absoluteChange).toFixed(2)}${unit}`
}

// GSC data used as supporting evidence for ① when organic sessions fall (measurement sheet rows 2–4).
export interface GscContext {
  comparisons: Comparison[] | null // GSC daily chart for the same two weeks; null when no upload covers them
  note?: string // why the daily chart could not be used
  queries?: { rows: { key: string; clicks: number }[]; totalClicks: number }
  pages?: { rows: { key: string; clicks: number }[]; totalClicks: number }
}

// What each worsening GSC metric means for an organic drop, as in the measurement sheet.
const GSC_REASONS: Record<string, string> = {
  position: 'ranking dropped',
  impressions: 'fewer searches',
  ctr: 'title/snippet problem',
}

function gscEvidence(gsc: GscContext | undefined): { evidence: string; reasons: string[] } {
  if (!gsc) return { evidence: '', reasons: [] }
  const parts: string[] = []
  const reasons: string[] = []
  if (gsc.comparisons?.length) {
    const changes = gsc.comparisons.map((x) => {
      // Only a change that meets its GSC judgment condition counts as a reason; small moves are listed as context.
      const reason = x.significant && isWorse(x) ? GSC_REASONS[x.metricKey] : undefined
      if (reason) reasons.push(reason)
      return `${x.label} ${formatChange(x)}${reason ? ` (${reason})` : ''}`
    })
    parts.push(`GSC same weeks: ${changes.join(', ')}${reasons.length ? '' : '; no GSC metric met its condition'}.`)
  } else if (gsc.note) {
    parts.push(`GSC: ${gsc.note}`)
  }
  const top = (label: string, t: GscContext['queries']) =>
    t?.rows.length && t.totalClicks > 0
      ? `${label}: ${t.rows.map((r) => `${r.key} ${((r.clicks / t.totalClicks) * 100).toFixed(1)}%`).join(', ')} of export clicks (period total, no WoW).`
      : null
  for (const line of [top('Top queries', gsc.queries), top('Top pages', gsc.pages)]) if (line) parts.push(line)
  return { evidence: parts.length ? ` ${parts.join(' ')}` : '', reasons }
}

const fmtInt = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(Math.round(n)).toLocaleString('en-US')}`
const pct = (c: Comparison | undefined) => (c ? formatChange({ kind: 'relative', absoluteChange: c.absoluteChange, changePercentage: c.changePercentage }) : 'n/a')

// A change is "worse" when it should worry the team: lower values, except position where higher is worse.
const isWorse = (c: Comparison) => (c.kind === 'rank' ? c.absoluteChange > 0 : c.absoluteChange < 0)

function priorityOf(c: Comparison): Priority {
  if (!isWorse(c) || !c.threshold) return 'Low'
  const measured = c.threshold.kind === 'relative' ? Math.abs(c.changePercentage ?? 0) : Math.abs(c.absoluteChange)
  return measured >= c.threshold.value * 2 ? 'High' : 'Medium'
}

type Movement = 'up' | 'flat' | 'down'

function movement(c: Comparison | undefined, band: FlatBand): Movement | null {
  if (!c || c.changePercentage === null) return null
  const size = band.unit === 'relative' ? c.changePercentage : c.absoluteChange
  return Math.abs(size) < band.value ? 'flat' : size > 0 ? 'up' : 'down'
}

function sessionsRule(c: Comparison, all: Comparison[], gsc?: GscContext): Suggestion {
  const organic = all.find((x) => x.metricKey === 'organicSessions')
  const paid = all.find((x) => x.metricKey === 'paidSessions')
  const o = organic?.absoluteChange ?? 0
  const p = paid?.absoluteChange ?? 0
  const base = {
    priority: priorityOf(c),
    rule: 'SEO.txt ① 集客状況',
    ruleConfirmed: true,
    supportingEvidence: `Sessions ${formatChange(c)}; organic ${fmtInt(o)}, paid ${fmtInt(p)} sessions week over week.`,
  }

  if (!organic && !paid) {
    return {
      ...base,
      hypothesis: 'The export has no organic or paid segment, so the channel behind the change cannot be identified.',
      description: 'Re-export GA4 with オーガニックサーチ and ペイド系 segments to identify the driving channel.',
      ownerTeam: 'SEO team',
    }
  }

  if (c.absoluteChange < 0) {
    const main = o < 0 && p < 0 ? (o <= p ? 'organic' : 'paid') : o < 0 ? 'organic' : p < 0 ? 'paid' : null
    if (main === 'organic') {
      const { evidence, reasons } = gscEvidence(gsc)
      return {
        ...base,
        supportingEvidence: base.supportingEvidence + evidence,
        hypothesis: reasons.length
          ? `The decline is mainly organic search; Search Console points to: ${reasons.join(', ')}.`
          : 'The decline is mainly organic search.',
        description: 'Feed back to the SEO team: check organic landing pages and Search Console clicks and position for the same week.',
        ownerTeam: 'SEO team',
      }
    }
    if (main === 'paid') {
      return {
        ...base,
        hypothesis: 'The decline is mainly paid traffic.',
        description: 'Feed back to the ads team: check paid campaign budget, delivery and bids for the week.',
        ownerTeam: 'Ads team',
      }
    }
    return {
      ...base,
      rule: 'SEO.txt ① 集客状況 (no matching case)',
      hypothesis: 'Neither organic nor paid sessions fell, a case SEO.txt ① does not cover.',
      description: 'Review manually: check direct and other channels.',
      ownerTeam: 'SEO team',
    }
  }

  return {
    ...base,
    rule: 'SEO.txt ① 集客状況 (no matching case)',
    hypothesis: 'Sessions increased; SEO.txt ① only describes decreases.',
    description: 'Review manually and record what drove the increase.',
    ownerTeam: 'SEO team',
  }
}

// SEO.txt ②: セッション増＋CV横ばい/減 → 流入の質 / セッション横ばい＋CVR減 → 商品・価格・ページ / CVR・セッションとも増 → 改善要因
function cvrRule(c: Comparison, all: Comparison[], bands: Record<string, FlatBand>): Suggestion {
  const sessions = all.find((x) => x.metricKey === 'sessions')
  const purchases = all.find((x) => x.metricKey === 'purchases')
  const s = movement(sessions, bands.sessions)
  const cv = movement(purchases, bands.purchases)
  const cvrUp = c.absoluteChange > 0
  const base = {
    priority: priorityOf(c),
    rule: 'SEO.txt ② 購入効率',
    ruleConfirmed: true,
    ownerTeam: 'SEO team',
    supportingEvidence:
      `CVR ${formatChange(c)}; sessions ${pct(sessions)} (${s ?? 'n/a'}); purchases ${pct(purchases)} (${cv ?? 'n/a'}). ` +
      `Flat band: sessions ±${bands.sessions.value}, purchases ±${bands.purchases.value} (unconfirmed).`,
  }

  if (s === 'up' && (cv === 'flat' || cv === 'down')) {
    return {
      ...base,
      hypothesis: 'Sessions grew but purchases stayed flat or fell: the added traffic may be lower quality.',
      description: 'Check the quality of the added traffic: which channels and landing pages brought the new sessions.',
    }
  }
  if (s === 'flat' && !cvrUp) {
    return {
      ...base,
      hypothesis: 'Traffic was flat but CVR fell: the cause is likely on the product, price or page side.',
      description: 'Check the product side: line-up, prices, stock and page problems on key product pages.',
    }
  }
  if (s === 'up' && cvrUp) {
    return {
      ...base,
      hypothesis: 'CVR and sessions both rose: something improved.',
      description: 'Identify the improvement factor (price, page change, sale) and whether it can be repeated.',
    }
  }
  return {
    ...base,
    rule: 'SEO.txt ② 購入効率 (no matching case)',
    hypothesis: `This combination (sessions ${s ?? 'n/a'}, purchases ${cv ?? 'n/a'}, CVR ${cvrUp ? 'up' : 'down'}) is not covered by SEO.txt ②.`,
    description: 'Review manually.',
  }
}

const HEURISTIC = { rule: 'Heuristic (not yet agreed with the SEO team)', ruleConfirmed: false, ownerTeam: 'SEO team' }

function gscRule(c: Comparison, all: Comparison[]): Suggestion {
  const position = all.find((x) => x.metricKey === 'position')
  const impressions = all.find((x) => x.metricKey === 'impressions')
  const ctr = all.find((x) => x.metricKey === 'ctr')
  const rankingMoved = position?.significant ?? false
  const evidence = [impressions, ctr, position]
    .filter((x): x is Comparison => !!x)
    .map((x) => `${x.label} ${formatChange(x)}${x.significant ? ' (significant)' : ''}`)
    .join('; ')
  const base = { ...HEURISTIC, priority: priorityOf(c), supportingEvidence: `${c.label} ${formatChange(c)}. ${evidence}.` }

  if (!isWorse(c)) {
    return {
      ...base,
      hypothesis: `${c.label} improved.`,
      description: 'Identify what drove the improvement and whether it can be applied to other pages.',
    }
  }

  switch (c.metricKey) {
    case 'ctr':
      return rankingMoved
        ? { ...base, hypothesis: 'CTR fell together with a ranking drop.', description: 'Address the ranking drop first; see the average position anomaly.' }
        : {
            ...base,
            hypothesis: 'CTR fell while average position held, so the search result itself attracts fewer clicks.',
            description: 'Review titles, meta descriptions and product rich results on the top pages.',
          }
    case 'position':
      return {
        ...base,
        hypothesis: 'Average position worsened.',
        description: 'Compare top queries and pages with the previous export; check recent site changes and Google updates.',
      }
    case 'impressions':
      return rankingMoved
        ? { ...base, hypothesis: 'Impressions fell together with a ranking drop.', description: 'Address the ranking drop first; see the average position anomaly.' }
        : {
            ...base,
            hypothesis: 'Impressions fell while position held, which suggests lower search demand.',
            description: 'Check seasonality and the sale calendar before changing pages.',
          }
    default: {
      const drivers = [
        impressions?.significant && isWorse(impressions) ? 'impressions' : null,
        ctr?.significant && isWorse(ctr) ? 'CTR' : null,
        rankingMoved && position && isWorse(position) ? 'position' : null,
      ].filter(Boolean)
      return {
        ...base,
        hypothesis: drivers.length
          ? `Clicks fell, together with a significant change in ${drivers.join(', ')}.`
          : 'Clicks fell without a significant change in impressions, CTR or position.',
        description: 'Follow the related anomaly for the driver; if none, check which pages lost clicks.',
      }
    }
  }
}

export function suggest(
  source: SourceKind,
  c: Comparison,
  all: Comparison[],
  bands: Record<string, FlatBand>,
  gsc?: GscContext,
): Suggestion {
  if (source === 'ga4-daily' && c.metricKey === 'sessions') return sessionsRule(c, all, gsc)
  if (source === 'ga4-daily' && c.metricKey === 'cvr') return cvrRule(c, all, bands)
  return gscRule(c, all)
}
