import type { ChangeKind, Period, SourceKind } from './types'

export const SOURCE_LABELS: Record<SourceKind, string> = {
  'gsc-daily': 'GSC daily',
  'ga4-daily': 'GA4 daily',
  'ga4-snapshot': 'GA4 totals',
  'gsc-pages': 'GSC pages',
  'gsc-queries': 'GSC queries',
  'gsc-other': 'GSC breakdown',
}

export const STATUS_LABELS: Record<string, string> = { UnderReview: 'Under review' }
export const statusLabel = (s: string) => STATUS_LABELS[s] ?? s

export function formatValue(kind: ChangeKind, metricKey: string, v: number): string {
  if (metricKey === 'ctr' || metricKey === 'cvr') return `${v.toFixed(2)}%`
  if (kind === 'rank') return v.toFixed(2)
  return Math.round(v).toLocaleString('en-US')
}

const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '±')

export function formatChange(kind: ChangeKind, absoluteChange: number, changePercentage: number | null): string {
  if (kind === 'relative') return changePercentage === null ? 'n/a' : `${sign(changePercentage)}${Math.abs(changePercentage).toFixed(1)}%`
  return `${sign(absoluteChange)}${Math.abs(absoluteChange).toFixed(2)} ${kind === 'points' ? 'pt' : 'rank'}`
}

export function formatThreshold(kind: ChangeKind, value: number): string {
  return kind === 'relative' ? `±${value}%` : `±${value} ${kind === 'points' ? 'pt' : 'rank'}`
}

// Position going up is a worse ranking; everything else is worse when it goes down.
export const isWorse = (kind: ChangeKind, absoluteChange: number) => (kind === 'rank' ? absoluteChange > 0 : absoluteChange < 0)

export const formatPeriod = (p: Period | null) => (p ? `${p.start} 〜 ${p.end}` : '—')
