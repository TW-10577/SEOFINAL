// Mirrors seo-api/src/types.ts
export type SourceKind = 'gsc-daily' | 'ga4-daily' | 'ga4-snapshot' | 'gsc-pages' | 'gsc-queries' | 'gsc-other'
export type AnomalyStatus = 'Detected' | 'UnderReview' | 'Confirmed' | 'Resolved'
export type CountermeasureStatus = 'Proposed' | 'Approved' | 'Implemented' | 'Verified' | 'Rejected'
export type Priority = 'High' | 'Medium' | 'Low'
export type ChangeKind = 'relative' | 'points' | 'rank'

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

// One item per dataset: a text file gives one, an Excel workbook one per sheet.
export type UploadItem = (UploadResult & { name: string }) | { name: string; error: string }

export interface UploadResult {
  duplicate: boolean
  dataset: Dataset
  anomalies: Anomaly[]
  countermeasures: Countermeasure[]
}

export interface DataWarning {
  fileName: string
  message: string
}

export interface LatestComparison {
  datasetId: string
  fileName: string
  source: SourceKind
  comparisons: Comparison[]
}

export interface DashboardData {
  stats: {
    datasets: number
    openAnomalies: number
    totalAnomalies: number
    proposedCountermeasures: number
    approvedCountermeasures: number
  }
  latest: LatestComparison[]
  weeklyTrend: WeeklyTrendRow[]
  openAnomalies: Anomaly[]
  warnings: DataWarning[]
}

export interface OntologySummary {
  dir: string
  objects: { id: string; apiName: string; properties: { apiName: string; valueTypeRef: string }[] }[]
  enums: Record<string, { value: string; displayName: { en?: string; ja?: string } }[]>
  thresholds: Record<string, Threshold>
}

export interface WeeklyReport {
  generatedAt: string
  dataSources: Pick<Dataset, 'datasetId' | 'fileName' | 'source' | 'period' | 'uploadedAt'>[]
  summary: LatestComparison[]
  anomalies: Anomaly[]
  countermeasures: Countermeasure[]
  decisions: { anomalies: Record<string, number>; countermeasures: Record<string, number> }
  openItems: Anomaly[]
  warnings: DataWarning[]
}
