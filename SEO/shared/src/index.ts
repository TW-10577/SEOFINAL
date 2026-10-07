// Types shared by the API and the dashboard.
// Ontology names follow LOGOS_SEO_Ontology_Design.md; table shapes follow the PoC spec.

export type Source = 'GA4' | 'GSC';
export const SOURCES: Source[] = ['GA4', 'GSC'];

/** Structure detected from file contents (not from the file name). */
export type Structure =
  | 'ga4-explorations'
  | 'gsc-query'
  | 'gsc-page'
  | 'gsc-date'
  | 'gsc-device'
  | 'gsc-country'
  | 'gsc-appearance'
  | 'gsc-filter';

export interface Period {
  start: string; // yyyy-mm-dd
  end: string;
}

// ---------- Import ----------

export interface Issue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  row?: number | null;
  column?: string | null;
}

export type ValidationStatus = 'valid' | 'valid_with_warnings' | 'invalid';
export type ImportStatus = 'imported' | 'rejected';

export interface Upload {
  id: number;
  fileName: string;
  source: Source;
  fileType: 'csv' | 'xlsx';
  structure: string | null;
  uploadedAt: string;
  period: Period | null;
  periodNote: string | null;
  rowCount: number;
  validRowCount: number;
  validationStatus: ValidationStatus;
  importStatus: ImportStatus;
  warningCount: number;
  errorCount: number;
  schemaVersion: number;
  metadata: Record<string, unknown>;
}

export interface UploadDetail extends Upload {
  issues: Issue[];
}

export type RecordStatus = 'valid' | 'invalid' | 'duplicate' | 'total' | 'metadata';

export interface RawRecord {
  id: number;
  rowNumber: number;
  table: string;
  status: RecordStatus;
  values: Record<string, string>;
  issues: string[];
}

export interface ImportedRow {
  id: number;
  uploadId: number;
  sourceRecordId: number;
  source: Source;
  structure: string;
  dataDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  pageUrl: string | null;
  query: string | null;
  segment: string | null;
  trafficSource: string | null;
  device: string | null;
  country: string | null;
  searchAppearance: string | null;
  metricName: string;
  sourceMetricName: string;
  metricValue: number | null;
  isValid: boolean;
}

// ---------- Data page ----------

export interface DataFilters {
  sources: Source[];
  dateRange: Record<Source, Period | null>;
  segments: string[];
  metrics: { source: Source; metric: string }[];
  hasPages: boolean;
  hasQueries: boolean;
}

export interface ComparisonRow {
  source: Source;
  subjectType: string;
  subjectKey: string;
  metric: string;
  previous: number | null;
  current: number | null;
  absoluteChange: number | null;
  changeRate: number | null;
  note: string | null;
}

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface Series {
  key: string;
  label: string;
  points: SeriesPoint[];
}

export interface TopRow {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
  share: number | null;
  classification?: string;
}

// ---------- Measurements ----------

export type MeasurementStatus = 'OK' | 'NG' | 'NOT_EVALUABLE';

export interface MeasurementRun {
  id: number;
  current: Period;
  previous: Period;
  createdAt: string;
  issues: Issue[];
}

export interface AnalysisResult {
  id: number;
  runId: number;
  source: Source;
  subjectType: string;
  subjectKey: string;
  metric: string;
  current: Period;
  previous: Period;
  previousValue: number | null;
  currentValue: number | null;
  absoluteChange: number | null;
  changeRate: number | null;
  note: string | null;
}

export interface EvidenceItem {
  label: string;
  value: string;
  /** Marks evidence that depends on an unconfirmed mapping or an unaligned period. */
  caveat?: string;
}

export interface EvidenceTable {
  title: string;
  note?: string;
  columns: string[];
  rows: (string | number | null)[][];
}

export interface Evidence {
  items: EvidenceItem[];
  tables: EvidenceTable[];
}

export interface SourceRef {
  uploadId: number;
  fileName: string;
  sourceRecordId: number;
  rowNumber: number;
  dataDate: string | null;
  segment: string | null;
  metricName: string;
  metricValue: number | null;
}

export interface Measurement {
  id: number;
  runId: number;
  analysisResultId: number | null;
  name: string;
  ruleId: string;
  ruleNumber: string;
  subjectType: string;
  subjectKey: string;
  metric: string;
  previousValue: number | null;
  currentValue: number | null;
  absoluteChange: number | null;
  changeRate: number | null;
  thresholdValue: number | null;
  thresholdUnit: string;
  result: string;
  status: MeasurementStatus;
  reason: string;
  createdAt: string;
  anomalyId: number | null;
  causeSummary: string | null;
}

// Allowed state changes are defined by the ontology lifecycles (GET /api/ontology), not here.
export const ANOMALY_STATES = ['Detected', 'Triaged', 'CountermeasureAssigned', 'Resolved', 'Dismissed'] as const;
export type AnomalyState = (typeof ANOMALY_STATES)[number];

export const REVIEW_STATUSES = ['NotReviewed', 'Confirmed', 'Rejected', 'NeedsMoreEvidence'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const COUNTERMEASURE_STATUSES = [
  'Proposed',
  'Approved',
  'InProgress',
  'Completed',
  'VerifiedEffective',
  'VerifiedIneffective',
] as const;
export type CountermeasureStatus = (typeof COUNTERMEASURE_STATUSES)[number];

export interface Anomaly {
  id: number;
  measurementId: number;
  runId: number;
  subjectType: string;
  subjectKey: string;
  metric: string;
  previousValue: number;
  currentValue: number;
  change: number;
  changeRate: number | null;
  detectionDate: string;
  state: AnomalyState;
}

export type Confidence = 'High' | 'Medium' | 'Low';

export interface CauseHypothesis {
  id: number;
  anomalyId: number;
  branch: string | null;
  causeText: string;
  supportingEvidence: Evidence;
  confidence: Confidence;
  confidenceReason: string;
  reviewStatus: ReviewStatus;
  createdAt: string;
}

export interface Countermeasure {
  id: number;
  causeId: number;
  actionText: string;
  reason: string;
  target: string;
  responsibleTeam: string | null;
  status: CountermeasureStatus;
  createdAt: string;
}

export interface StateEvent {
  id: number;
  entity: 'anomaly' | 'cause' | 'countermeasure';
  entityId: number;
  fromState: string;
  toState: string;
  actor: string;
  note: string;
  at: string;
}

export interface MeasurementDetail {
  measurement: Measurement;
  run: MeasurementRun;
  rule: RuleConfig;
  analysisResult: AnalysisResult | null;
  evidence: Evidence;
  sources: SourceRef[];
  anomaly: Anomaly | null;
  cause: CauseHypothesis | null;
  countermeasures: Countermeasure[];
  events: StateEvent[];
}

// ---------- Config ----------

export interface RuleConfig {
  id: string;
  number: string;
  name: string;
  criteria: string;
  primaryJudgment: string;
  whatToCheckNext: string;
  subject: string;
  metric: string;
  thresholdValue: number | null;
  thresholdUnit: 'percent' | 'percentage_points' | 'unresolved';
  thresholdNote: string | null;
  flatBandPercent?: number | null;
  /** JudgmentCondition.direction: up / down / both. */
  direction: string;
  /** JudgmentCondition.conditionType: numeric / ambiguous. */
  conditionType: string;
}

export interface UnresolvedItem {
  key: string;
  description: string;
}

export interface ConfigSummary {
  rules: RuleConfig[];
  unresolved: UnresolvedItem[];
}

// ---------- Report ----------

export interface Report {
  id: number;
  runId: number;
  fileName: string;
  generatedAt: string;
  content: string;
}
