// Each list must match its enumerated value type in SEO/value-types (checked when the API starts).
export const SOURCE_KINDS = ['gsc-daily', 'ga4-daily', 'ga4-snapshot', 'gsc-pages', 'gsc-queries', 'gsc-other'] as const
export const ANOMALY_STATUSES = ['Detected', 'UnderReview', 'Confirmed', 'Resolved'] as const
export const COUNTERMEASURE_STATUSES = ['Proposed', 'Approved', 'Implemented', 'Verified', 'Rejected'] as const
export const PRIORITIES = ['High', 'Medium', 'Low'] as const
// relative: % change; points: percentage-point change; rank: change in average position (positive = worse)
export const CHANGE_KINDS = ['relative', 'points', 'rank'] as const

export type SourceKind = (typeof SOURCE_KINDS)[number]
export type AnomalyStatus = (typeof ANOMALY_STATUSES)[number]
export type CountermeasureStatus = (typeof COUNTERMEASURE_STATUSES)[number]
export type Priority = (typeof PRIORITIES)[number]
export type ChangeKind = (typeof CHANGE_KINDS)[number]

export interface Period {
  start: string
  end: string
}

export interface Threshold {
  kind: ChangeKind
  value: number
  confirmed: boolean
  source: string
}

export interface Comparison {
  metricKey: string
  label: string
  scope: string
  kind: ChangeKind
  previous: number
  current: number
  absoluteChange: number
  changePercentage: number | null
  threshold: Threshold | null
  significant: boolean
  previousPeriod: Period
  currentPeriod: Period
}

export interface WeeklyTrendRow {
  period: Period
  values: Record<string, number>
}

export interface SnapshotRow {
  key: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface SegmentLabels {
  total: string
  organic?: string
  paid?: string
  direct?: string
}

export interface ParsedFile {
  source: SourceKind
  daily?: Record<string, Record<string, number>>
  segments?: SegmentLabels
  snapshot?: SnapshotRow[]
  rowCount: number
  warnings: string[]
}

export interface Dataset {
  datasetId: string
  fileName: string
  source: SourceKind
  uploadedAt: string
  period: Period | null
  rowCount: number
  warnings: string[]
  comparisons: Comparison[]
  weeklyTrend: WeeklyTrendRow[]
}

export interface Anomaly {
  anomalyId: string
  datasetId: string
  source: SourceKind
  metricKey: string
  metricName: string
  scope: string
  kind: ChangeKind
  previousValue: number
  currentValue: number
  absoluteChange: number
  changePercentage: number | null
  threshold: Threshold
  previousPeriod: Period
  currentPeriod: Period
  detectionDate: string
  status: AnomalyStatus
  possibleCause: string
}

export interface Countermeasure {
  countermeasureId: string
  relatedAnomalyId: string
  description: string
  reason: string
  ownerTeam: string
  priority: Priority
  status: CountermeasureStatus
  createdDate: string
  rule: string
  ruleConfirmed: boolean
}
