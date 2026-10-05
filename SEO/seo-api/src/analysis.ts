import type { ChangeKind, Comparison, ParsedFile, Period, Threshold, WeeklyTrendRow } from './types.ts'

const DAY_MS = 86_400_000

// Every key here must be configured in config/thresholds.yaml with the same kind.
export const THRESHOLD_KINDS: Record<string, ChangeKind> = {
  sessions: 'relative',
  cvr: 'points',
  clicks: 'relative',
  impressions: 'relative',
  ctr: 'points',
  position: 'rank',
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
}

type Sum = (key: string) => number

interface MetricDef {
  key: string
  label: string
  scope: string
  kind: ChangeKind
  threshold?: string
  value: (s: Sum) => number
}

const ratio = (a: number, b: number) => (b === 0 ? Number.NaN : a / b)

function metricsFor(parsed: ParsedFile): MetricDef[] {
  if (parsed.source === 'gsc-daily') {
    const scope = 'Site (GSC)'
    return [
      { key: 'clicks', label: 'Clicks', scope, kind: 'relative', threshold: 'clicks', value: (s) => s('clicks') },
      { key: 'impressions', label: 'Impressions', scope, kind: 'relative', threshold: 'impressions', value: (s) => s('impressions') },
      { key: 'ctr', label: 'CTR', scope, kind: 'points', threshold: 'ctr', value: (s) => ratio(s('clicks'), s('impressions')) * 100 },
      { key: 'position', label: 'Average position', scope, kind: 'rank', threshold: 'position', value: (s) => ratio(s('positionWeighted'), s('impressions')) },
    ]
  }
  if (parsed.source === 'ga4-daily' && parsed.segments) {
    const seg = parsed.segments
    const list: MetricDef[] = [
      { key: 'sessions', label: 'Sessions', scope: seg.total, kind: 'relative', threshold: 'sessions', value: (s) => s('total:sessions') },
      { key: 'purchases', label: 'Purchases', scope: seg.total, kind: 'relative', value: (s) => s('total:purchases') },
      { key: 'cvr', label: 'CVR', scope: seg.total, kind: 'points', threshold: 'cvr', value: (s) => ratio(s('total:purchases'), s('total:sessions')) * 100 },
    ]
    for (const role of ['organic', 'paid', 'direct'] as const) {
      const scope = seg[role]
      if (scope) list.push({ key: `${role}Sessions`, label: 'Sessions', scope, kind: 'relative', value: (s) => s(`${role}:sessions`) })
    }
    return list
  }
  return []
}

function summer(daily: Record<string, Record<string, number>>, period: Period): Sum {
  return (key) => {
    let total = 0
    for (let d = period.start; d <= period.end; d = addDays(d, 1)) {
      const v = daily[d]?.[key]
      if (v === undefined) return Number.NaN
      total += v
    }
    return total
  }
}

function hasFullDays(daily: Record<string, Record<string, number>>, end: string, days: number): boolean {
  for (let i = 0; i < days; i++) if (!daily[addDays(end, -i)]) return false
  return true
}

export function dataPeriod(parsed: ParsedFile): Period | null {
  const dates = Object.keys(parsed.daily ?? {}).sort()
  return dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null
}

function isSignificant(kind: ChangeKind, absoluteChange: number, changePercentage: number | null, t: Threshold): boolean {
  if (kind === 'relative') return changePercentage !== null && Math.abs(changePercentage) >= t.value
  return Math.abs(absoluteChange) >= t.value
}

export function compareLatestWeeks(
  parsed: ParsedFile,
  thresholds: Record<string, Threshold>,
): { comparisons: Comparison[]; warning?: string } {
  const period = dataPeriod(parsed)
  const daily = parsed.daily
  if (!period || !daily) return { comparisons: [] }
  if (!hasFullDays(daily, period.end, 14)) {
    const days = Object.keys(daily).length
    return {
      comparisons: [],
      warning: `Week-over-week comparison needs 14 consecutive days ending ${period.end}; this file covers ${period.start}〜${period.end} (${days} day(s)). Export at least two full weeks.`,
    }
  }
  const currentPeriod = { start: addDays(period.end, -6), end: period.end }
  const previousPeriod = { start: addDays(period.end, -13), end: addDays(period.end, -7) }
  const cur = summer(daily, currentPeriod)
  const prev = summer(daily, previousPeriod)

  const comparisons: Comparison[] = []
  for (const m of metricsFor(parsed)) {
    const previous = m.value(prev)
    const current = m.value(cur)
    if (!Number.isFinite(previous) || !Number.isFinite(current)) continue
    const absoluteChange = current - previous
    const changePercentage = previous === 0 ? null : (absoluteChange / Math.abs(previous)) * 100
    const threshold = m.threshold ? (thresholds[m.threshold] ?? null) : null
    comparisons.push({
      metricKey: m.key,
      label: m.label,
      scope: m.scope,
      kind: m.kind,
      previous,
      current,
      absoluteChange,
      changePercentage,
      threshold,
      significant: threshold ? isSignificant(m.kind, absoluteChange, changePercentage, threshold) : false,
      previousPeriod,
      currentPeriod,
    })
  }
  return { comparisons }
}

export function weeklyTrend(parsed: ParsedFile, maxWeeks = 12): WeeklyTrendRow[] {
  const period = dataPeriod(parsed)
  const daily = parsed.daily
  if (!period || !daily) return []
  const metrics = metricsFor(parsed).filter((m) => m.threshold)
  const rows: WeeklyTrendRow[] = []
  for (let end = period.end; rows.length < maxWeeks && hasFullDays(daily, end, 7); end = addDays(end, -7)) {
    const week = { start: addDays(end, -6), end }
    const s = summer(daily, week)
    const values: Record<string, number> = {}
    for (const m of metrics) {
      const v = m.value(s)
      if (Number.isFinite(v)) values[m.key] = v
    }
    rows.push({ period: week, values })
  }
  return rows.reverse()
}
