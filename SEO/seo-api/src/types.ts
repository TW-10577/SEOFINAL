// Each list must match its enumerated value type in SEO/yaml/value-types (checked when the API starts).
export const SOURCE_KINDS = ['gsc-daily', 'ga4-daily', 'ga4-snapshot', 'gsc-pages', 'gsc-queries', 'gsc-other'] as const
export const ANOMALY_STATUSES = ['Detected', 'Triaged', 'CountermeasureAssigned', 'Resolved', 'Dismissed'] as const
export const COUNTERMEASURE_STATUSES = [
  'Proposed',
  'Approved',
  'InProgress',
  'Completed',
  'VerifiedEffective',
  'VerifiedIneffective',
  'Dismissed',
] as const
export const REVIEW_STATUSES = ['NotReviewed', 'Confirmed', 'Rejected', 'NeedsMoreEvidence'] as const
export const DIRECTIONS = ['both', 'increase', 'decrease'] as const
export const CONDITION_TYPES = ['numeric', 'ambiguous'] as const
export const PRIORITIES = ['High', 'Medium', 'Low'] as const
// relative: % change; points: percentage-point change; rank: change in average position (positive = worse)
export const CHANGE_KINDS = ['relative', 'points', 'rank'] as const

export type SourceKind = (typeof SOURCE_KINDS)[number]
export type AnomalyStatus = (typeof ANOMALY_STATUSES)[number]
export type CountermeasureStatus = (typeof COUNTERMEASURE_STATUSES)[number]
export type Priority = (typeof PRIORITIES)[number]
export type ChangeKind = (typeof CHANGE_KINDS)[number]
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]
export type Direction = (typeof DIRECTIONS)[number]
export type ConditionType = (typeof CONDITION_TYPES)[number]

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

// logos.seo.object.judgment-condition (design §6 O7)
export interface JudgmentCondition {
  conditionId: string
  name: string
  metricKey: string
  direction: Direction
  threshold: number
  unit: ChangeKind
  conditionType: ConditionType
  confirmed: boolean
  source: string
}

// When a metric counts as 横ばい (flat) in rule ②.
export interface FlatBand {
  value: number
  unit: ChangeKind
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
  judgmentConditionId: string | null
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
  judgmentConditionId: string
  threshold: Threshold
  previousPeriod: Period
  currentPeriod: Period
  detectionDate: string
  status: AnomalyStatus
}

// logos.seo.object.cause-hypothesis (design §6 O9)
export interface CauseHypothesis {
  causeId: string
  anomalyId: string
  hypothesis: string
  supportingEvidence: string
  confidence: string | null
  reviewStatus: ReviewStatus
  rule: string
  ruleConfirmed: boolean
  createdDate: string
}

// logos.seo.object.countermeasure (design §6 O10)
export interface Countermeasure {
  countermeasureId: string
  causeId: string
  description: string
  reason: string
  target: string
  ownerTeam: string
  priority: Priority
  status: CountermeasureStatus
  createdDate: string
  decidedBy: string | null
}

// One row of SEO/yaml/config/measurements.yaml: a measurement and the judgment condition behind it.
export interface MeasurementDef {
  measurementId: string
  number: string
  name: string
  conditionId: string
  primarySource: string
  branches: { when: string; then: string }[]
  supportedBy: string
}

// Where a measurement's data comes from, and what each export can and cannot answer.
export interface MeasurementSource {
  no: number
  files: string
  source: string
  sourceKinds: SourceKind[]
  memo1: string
  memo2: string
  import: string
  sampleDateRange: string
  dummyDateRange: string
  measurement1: string
  measurement2: string
}

export interface MeasurementConfig {
  measurements: MeasurementDef[]
  dataSources: MeasurementSource[]
}

// One line of a raw imported file, as shown on the Data Import audit view. No judgement, just what was read.
export interface ImportedRow {
  row: number
  date: string | null
  source: SourceKind
  subject: string
  metric: string
  value: number
  status: 'Imported'
}

export interface DatasetRows {
  fileName: string
  source: SourceKind
  totalRows: number
  rows: ImportedRow[]
}
