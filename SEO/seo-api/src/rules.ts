import type { Comparison, Priority, SourceKind } from './types.ts'

export interface Suggestion {
  possibleCause: string
  description: string
  ownerTeam: string
  priority: Priority
  rule: string
  ruleConfirmed: boolean
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

const fmtInt = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(Math.round(n)).toLocaleString('en-US')}`

// A change is "worse" when it should worry the team: lower values, except position where higher is worse.
const isWorse = (c: Comparison) => (c.kind === 'rank' ? c.absoluteChange > 0 : c.absoluteChange < 0)

function priorityOf(c: Comparison): Priority {
  if (!isWorse(c) || !c.threshold) return 'Low'
  const measured = c.kind === 'relative' ? Math.abs(c.changePercentage ?? 0) : Math.abs(c.absoluteChange)
  return measured >= c.threshold.value * 2 ? 'High' : 'Medium'
}

function sessionsRule(c: Comparison, all: Comparison[]): Suggestion {
  const organic = all.find((x) => x.metricKey === 'organicSessions')
  const paid = all.find((x) => x.metricKey === 'paidSessions')
  const o = organic?.absoluteChange ?? 0
  const p = paid?.absoluteChange ?? 0
  const base = { priority: priorityOf(c), rule: 'SEO.txt ① 集客状況', ruleConfirmed: true }
  const detail = `Organic ${fmtInt(o)}, paid ${fmtInt(p)} sessions week over week.`

  if (!organic && !paid) {
    return {
      ...base,
      possibleCause: 'The export has no organic or paid segment, so the channel behind the change cannot be identified.',
      description: 'Re-export GA4 with オーガニックサーチ and ペイド系 segments to identify the driving channel.',
      ownerTeam: 'SEO team',
    }
  }

  if (c.absoluteChange < 0) {
    const main = o < 0 && p < 0 ? (o <= p ? 'organic' : 'paid') : o < 0 ? 'organic' : p < 0 ? 'paid' : null
    if (main === 'organic') {
      return {
        ...base,
        possibleCause: `The decline is mainly organic search. ${detail}`,
        description: 'Feed back to the SEO team: check organic landing pages and Search Console clicks and position for the same week.',
        ownerTeam: 'SEO team',
      }
    }
    if (main === 'paid') {
      return {
        ...base,
        possibleCause: `The decline is mainly paid traffic. ${detail}`,
        description: 'Feed back to the ads team: check paid campaign budget, delivery and bids for the week.',
        ownerTeam: 'Ads team',
      }
    }
    return {
      ...base,
      possibleCause: `Neither organic nor paid sessions fell. ${detail}`,
      description: 'Check direct and other channels for the source of the decline.',
      ownerTeam: 'SEO team',
    }
  }

  const main = o >= p ? 'organic search' : 'paid traffic'
  return {
    ...base,
    possibleCause: `Sessions increased, mostly from ${main}. ${detail}`,
    description: 'Confirm what drove the increase (sale, campaign, ranking gain) and record it for future planning.',
    ownerTeam: o >= p ? 'SEO team' : 'Ads team',
  }
}

function cvrRule(c: Comparison, all: Comparison[]): Suggestion {
  const sessions = all.find((x) => x.metricKey === 'sessions')
  const sessionsPct = sessions?.changePercentage ?? 0
  const sessionsFlat = Math.abs(sessionsPct) < (sessions?.threshold?.value ?? 0)
  const base = { priority: priorityOf(c), rule: 'SEO.txt ② 購入効率', ruleConfirmed: true, ownerTeam: 'SEO team' }
  const detail = `CVR ${formatChange(c)}, sessions ${sessions ? formatChange(sessions) : 'n/a'}.`

  if (c.absoluteChange < 0) {
    if (!sessionsFlat && sessionsPct > 0) {
      return {
        ...base,
        possibleCause: `Sessions grew but purchases did not keep up. ${detail}`,
        description: 'Check the quality of the added traffic: which channels and landing pages brought the new sessions.',
      }
    }
    if (sessionsFlat) {
      return {
        ...base,
        possibleCause: `Traffic was stable but fewer visitors bought. ${detail}`,
        description: 'Check the product side: line-up, prices, stock and page problems on key product pages.',
      }
    }
    return {
      ...base,
      possibleCause: `Sessions and CVR fell together. ${detail}`,
      description: 'Review together with the sessions anomaly for the same week.',
    }
  }
  return {
    ...base,
    possibleCause: `Purchase efficiency improved. ${detail}`,
    description: 'Identify the improvement factor (price, page change, sale) and whether it can be repeated.',
  }
}

const HEURISTIC = { rule: 'Heuristic (not yet agreed with the SEO team)', ruleConfirmed: false, ownerTeam: 'SEO team' }

function gscRule(c: Comparison, all: Comparison[]): Suggestion {
  const position = all.find((x) => x.metricKey === 'position')
  const impressions = all.find((x) => x.metricKey === 'impressions')
  const ctr = all.find((x) => x.metricKey === 'ctr')
  const rankingMoved = position?.significant ?? false
  const base = { ...HEURISTIC, priority: priorityOf(c) }

  if (!isWorse(c)) {
    return {
      ...base,
      possibleCause: `${c.label} improved (${formatChange(c)}).`,
      description: 'Identify what drove the improvement and whether it can be applied to other pages.',
    }
  }

  switch (c.metricKey) {
    case 'ctr':
      return rankingMoved
        ? {
            ...base,
            possibleCause: `CTR fell together with a ranking drop (position ${formatChange(position!)}).`,
            description: 'Address the ranking drop first; see the average position anomaly.',
          }
        : {
            ...base,
            possibleCause: `CTR fell (${formatChange(c)}) while average position held, so the search result itself attracts fewer clicks.`,
            description: 'Review titles, meta descriptions and product rich results on the top pages.',
          }
    case 'position':
      return {
        ...base,
        possibleCause: `Average position worsened (${formatChange(c)}).`,
        description: 'Compare top queries and pages with the previous export; check recent site changes and Google updates.',
      }
    case 'impressions':
      return rankingMoved
        ? {
            ...base,
            possibleCause: 'Impressions fell together with a ranking drop.',
            description: 'Address the ranking drop first; see the average position anomaly.',
          }
        : {
            ...base,
            possibleCause: `Impressions fell (${formatChange(c)}) while position held, which suggests lower search demand.`,
            description: 'Check seasonality and the sale calendar before changing pages.',
          }
    default: {
      const drivers = [
        impressions?.significant && isWorse(impressions) ? `impressions ${formatChange(impressions)}` : null,
        ctr?.significant && isWorse(ctr) ? `CTR ${formatChange(ctr)}` : null,
        rankingMoved && position && isWorse(position) ? `position ${formatChange(position)}` : null,
      ].filter(Boolean)
      return {
        ...base,
        possibleCause: drivers.length
          ? `Clicks fell (${formatChange(c)}); related changes: ${drivers.join(', ')}.`
          : `Clicks fell (${formatChange(c)}) without a significant change in impressions, CTR or position.`,
        description: 'Follow the related anomaly for the driver; if none, check which pages lost clicks.',
      }
    }
  }
}

export function suggest(source: SourceKind, c: Comparison, all: Comparison[]): Suggestion {
  if (source === 'ga4-daily' && c.metricKey === 'sessions') return sessionsRule(c, all)
  if (source === 'ga4-daily' && c.metricKey === 'cvr') return cvrRule(c, all)
  return gscRule(c, all)
}
