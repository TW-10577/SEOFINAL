import type { Translate } from './i18n'
import type { ChangeKind, Period, SourceKind } from './types'

export function formatValue(kind: ChangeKind, metricKey: string, v: number): string {
  if (metricKey === 'ctr' || metricKey === 'cvr') return `${v.toFixed(2)}%`
  if (kind === 'rank') return v.toFixed(1) // design §9: average position, 1 decimal place
  return Math.round(v).toLocaleString('en-US')
}

const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '±')
const unitText = (kind: ChangeKind, t: Translate) => (kind === 'points' ? 'pt' : t('unit.rank'))

export function formatChange(kind: ChangeKind, absoluteChange: number, changePercentage: number | null, t: Translate): string {
  if (kind === 'relative') return changePercentage === null ? 'n/a' : `${sign(changePercentage)}${Math.abs(changePercentage).toFixed(1)}%`
  return `${sign(absoluteChange)}${Math.abs(absoluteChange).toFixed(2)} ${unitText(kind, t)}`
}

export function formatThreshold(kind: ChangeKind, value: number, t: Translate): string {
  return kind === 'relative' ? `±${value}%` : `±${value} ${unitText(kind, t)}`
}

// Position going up is a worse ranking; everything else is worse when it goes down.
export const isWorse = (kind: ChangeKind, absoluteChange: number) => (kind === 'rank' ? absoluteChange > 0 : absoluteChange < 0)

export const formatPeriod = (p: Period | null) => (p ? `${p.start} 〜 ${p.end}` : '—')

export const metricLabel = (metricKey: string, t: Translate) => t(`metric.${metricKey}` as Parameters<Translate>[0])

// The API names the GSC subject "Site (GSC)"; GA4 segment names are already Japanese.
export const scopeLabel = (scope: string, t: Translate) => (scope === 'Site (GSC)' ? t('scope.site') : scope)

export const sourceLabel = (source: SourceKind, t: Translate) => t(`source.${source}` as Parameters<Translate>[0])
