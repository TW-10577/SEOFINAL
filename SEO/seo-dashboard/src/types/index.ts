// Mirrors seo-api/src/types.ts
export type SourceKind = 'gsc-daily' | 'ga4-daily' | 'ga4-snapshot' | 'gsc-pages' | 'gsc-queries' | 'gsc-other'
export type AnomalyStatus = 'Detected' | 'Triaged' | 'CountermeasureAssigned' | 'Resolved' | 'Dismissed'
export type CountermeasureStatus = 'Proposed' | 'Approved' | 'InProgress' | 'Completed' | 'VerifiedEffective' | 'VerifiedIneffective' | 'Dismissed'
export type ReviewStatus = 'NotReviewed' | 'Confirmed' | 'Rejected' | 'NeedsMoreEvidence'
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
  judgmentConditionId: string
  threshold: Threshold
  previousPeriod: Period
  currentPeriod: Period
  detectionDate: string
  status: AnomalyStatus
}

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

// As returned by GET /api/anomalies: the anomaly with its cause hypothesis and countermeasures.
export interface AnomalyView extends Anomaly {
  cause: CauseHypothesis | null
  countermeasures: Countermeasure[]
}

// As returned by GET /api/countermeasures.
export interface CountermeasureView extends Countermeasure {
  anomalyId: string
  rule: string
  ruleConfirmed: boolean
}

export interface DeletedDataset extends Dataset {
  deletedAt: string
}

export interface JudgmentCondition {
  conditionId: string
  name: string
  metricKey: string
  direction: 'both' | 'increase' | 'decrease'
  threshold: number
  unit: ChangeKind
  conditionType: 'numeric' | 'ambiguous'
  confirmed: boolean
  source: string
}

export interface FlatBand {
  value: number
  unit: ChangeKind
  confirmed: boolean
  source: string
}

// One item per dataset: a text file gives one, an Excel workbook one per sheet.
export type UploadItem = (UploadResult & { name: string }) | { name: string; error: string }

export interface UploadResult {
  duplicate: boolean
  dataset: Dataset
  anomalies: Anomaly[]
  causes: CauseHypothesis[]
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
    causesToReview: number
    proposedCountermeasures: number
    activeCountermeasures: number
  }
  latest: LatestComparison[]
  weeklyTrend: WeeklyTrendRow[]
  openAnomalies: AnomalyView[]
  warnings: DataWarning[]
}

export interface OntologySummary {
  dir: string
  objects: { id: string; apiName: string; properties: { apiName: string; valueTypeRef: string }[] }[]
  relations: string[]
  functions: string[]
  enums: Record<string, { value: string; displayName: { en?: string; ja?: string } }[]>
  conditions: JudgmentCondition[]
  flatBands: Record<string, FlatBand>
  lifecycles: Record<string, { initial: string; transitions: Record<string, string[]> }>
}

export interface WeeklyReport {
  generatedAt: string
  dataSources: Pick<Dataset, 'datasetId' | 'fileName' | 'source' | 'period' | 'uploadedAt'>[]
  summary: LatestComparison[]
  anomalies: AnomalyView[]
  countermeasures: CountermeasureView[]
  decisions: { anomalies: Record<string, number>; causes: Record<string, number>; countermeasures: Record<string, number> }
  openItems: AnomalyView[]
  warnings: DataWarning[]
}

export interface MeasurementView {
  measurementId: string
  number: string
  name: string
  conditionId: string
  primarySource: string
  branches: { when: string; then: string }[]
  supportedBy: string
  condition: JudgmentCondition | null
  latest: Comparison | null
  latestFile: string | null
  openAnomalies: number
}

export interface MeasurementSourceView {
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
  uploads: { datasetId: string; fileName: string; source: SourceKind; period: Period | null; rowCount: number }[]
}

export interface MeasurementsData {
  measurements: MeasurementView[]
  dataSources: MeasurementSourceView[]
}

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
  datasetId: string
  fileName: string
  source: SourceKind
  uploadedAt: string
  period: Period | null
  totalRows: number
  rows: ImportedRow[]
}
