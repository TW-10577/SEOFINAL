// Domain model shared by the API and the dashboard.
export { translateDataTerms } from './dataTerms.ts';
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
/** imported: SEO data stored · unsupported: the file format cannot be read · failed: readable, but no usable SEO data. */
export type ImportStatus = 'imported' | 'unsupported' | 'failed';

export interface Upload {
  id: number;
  fileName: string;
  /** Detected from the file contents; null when no GA4 / Search Console data was recognised. */
  source: Source | null;
  /** Format detected from the file contents, e.g. csv, xlsx, json, xml, html, pdf, docx, zip. */
  fileType: string;
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
  /** GA4 traffic channels (segments other than the configured site total). GA4 only. */
  segments: string[];
  metrics: { source: Source; metric: string }[];
  /** Sources whose data has a page / query dimension. */
  pageSources: Source[];
  querySources: Source[];
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

/** GA4 dataset overview for the Data page: what was uploaded and whether it is usable. Never OK / NG. */
export interface Ga4Overview {
  uploads: { id: number; fileName: string; validationStatus: ValidationStatus; rowCount: number; validRowCount: number; period: Period | null; uploadedAt: string }[];
  /** Dates with total-segment data, oldest → newest. */
  period: Period | null;
  days: number;
  /** Valid imported GA4 values (one per date × segment × metric). */
  records: number;
  segments: { total: string; organic: string; advertising: string; all: string[] };
  /** Normalized metric key of the purchases (CV) column, for /data/trends. */
  purchasesMetric: string | null;
  /** Sums over all dates shown (CVR = purchases ÷ sessions × 100). */
  kpis: { sessions: number | null; purchases: number | null; organicSessions: number | null; cvr: number | null };
  health: {
    /** Calendar days from the first to the last date. */
    expectedDays: number;
    missingDates: string[];
    /** Date × segment × metric present more than once (within or across uploads). */
    duplicateDates: string[];
    duplicateRows: number;
    invalidRows: number;
    /** 総計 (totals) rows skipped — kept for reconciliation, never plotted. */
    totalsRows: number;
    /** Dates the export marks as not real (test data). */
    syntheticDates: string[];
    syntheticIncluded: boolean;
    /** GA4 columns the rules.yaml input_fields need. */
    requiredFields: { column: string; available: boolean; days: number }[];
    issues: { severity: 'error' | 'warning'; message: string; fileName: string }[];
  };
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
  /** Import context the run was made for: upload ids (empty = all data), their file names, test data. */
  scope: { uploadIds: number[]; files: string[]; includeTestData: boolean | null };
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

/** Evidence section: GA4, Search Console, page / query detail, daily trend. */
export type EvidenceGroup = 'ga4' | 'gsc' | 'detail' | 'daily';

export interface EvidenceItem {
  group?: EvidenceGroup;
  label: string;
  value: string;
  /** Marks evidence that depends on an unconfirmed mapping or an unaligned period. */
  caveat?: string;
}

export interface EvidenceTable {
  group?: EvidenceGroup;
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
  /** Short possible cause (NG only). */
  causeSummary: string | null;
  /** Analysis unit as the rule defines it, e.g. "Site / Traffic Source". */
  analysisUnit: string;
  /** Unconfirmed client mappings this rule's result depends on. */
  caveats: string[];
  /** Short rule name (M1 / M2) and the client criterion in words. */
  ruleCode: string;
  criteria: string;
  /** test: the result uses dates the uploaded file marks as not real. */
  dataKind: 'real' | 'test';
  /** Figures behind the result: the judged figure first, then figures shown for reference. */
  basis: BasisRow[];
  /** Only for NG: likely cause and suggested next step, from the cause hypothesis and countermeasure. */
  why: WhyNg | null;
}

export interface BasisRow {
  label: string;
  metric: string;
  previous: number | null;
  current: number | null;
  absoluteChange: number | null;
  changeRate: number | null;
  /** Set on the figure the rule judges; null for reference figures. */
  status: MeasurementStatus | null;
}

export interface WhyNg {
  title: string;
  likelyCause: string;
  confidence: Confidence | null;
  /** The countermeasure when one is proposed; otherwise what is needed to determine the cause. */
  nextStep: string;
  nextStepKind: 'countermeasure' | 'evidence' | 'rule';
  /** rules.yaml feedback of the matched branch: the team it goes to and the message. */
  team: string | null;
  feedback: string | null;
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
  'Rejected',
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
  /** Transitions whose ontology guard does not hold yet, with the reason (by target state). */
  blocked?: Record<string, string>;
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
  /** Investigation behind the hypothesis (possible cause, facts, contribution, missing evidence). */
  analysis: CauseAnalysis | null;
  /** SEO team modifications of the cause text, oldest first (the current text is causeText). */
  amendments: Amendment[];
  /** Whether the SEO team may modify the text in the current state (ontology allowedActionRefs). */
  editable: boolean;
}

export interface Amendment {
  id: number;
  field: string;
  oldValue: string;
  newValue: string;
  actor: string;
  note: string;
  at: string;
}

export interface CauseAnalysis {
  channel: 'organic' | 'advertising';
  /**
   * search_decline: the GSC date chart for the same weeks shows organic search clicks ↓ (cause determined) ·
   * no_search_decline: it covers the weeks but clicks did not fall · undetermined: no date chart for the weeks.
   */
  case: 'search_decline' | 'no_search_decline' | 'undetermined';
  /** SEO.txt signals: ranking (position worse), searches (impressions ↓), snippet (CTR ↓). */
  signals: ('ranking' | 'searches' | 'snippet')[];
  /** True when the evidence determines a possible cause; only then is a countermeasure proposed. */
  determined: boolean;
  /** Search Console supporting evidence (organic finding of rule ① only); never a measurement. */
  gscEvidence?: GscSupportingEvidence | null;
  title: string;
  facts: string[];
  affectedMetric: string;
  contribution: string | null;
  affected: EvidenceTable | null;
  missing: string[];
  limitation: string | null;
  /** rules.yaml investigation (GSC_R01) run for this anomaly. */
  investigation?: GscInvestigation | null;
}

// ---------- rules.yaml GSC investigation (GSC_R01) ----------
// Not an OK / NG measurement: runs when GA4_R01 is NG with organic sessions decreasing, and compares the
// GSC exports for the two measured weeks to find what may explain the organic decrease.

export type InvestigationConfidence = 'high' | 'medium' | 'low' | 'insufficient_data';

export interface GscAffectedRow {
  key: string;
  clicksPrevious: number;
  clicksCurrent: number;
  clicksChange: number;
  impressionsChange: number;
  ctrPrevious: number | null;
  ctrCurrent: number | null;
  positionPrevious: number | null;
  positionCurrent: number | null;
  /** Share of the summed clicks decrease (decreasing rows only), percent. */
  share: number | null;
}

export interface GscInvestigationCheck {
  id: string;
  source: string;
  /** Both measured weeks are available for this source. */
  available: boolean;
  reason: string | null;
  files: { previous: string | null; current: string | null };
  /** Totals over the rows present in both weeks (clicks, impressions, CTR, impressions-weighted position). */
  totals: GscMetricChange[];
  /** Rows with the largest clicks decrease. */
  affected: GscAffectedRow[];
  /** Signals found by this check (queries_with_click_decrease: true …). */
  signals: Record<string, boolean | null>;
  /** rules.yaml interpretation of each signal found. */
  interpretations: string[];
}

export interface GscInvestigation {
  ruleId: string;
  name: string;
  checks: GscInvestigationCheck[];
  /** Every signal the cause_identification conditions read. */
  signals: Record<string, boolean | null>;
  /** Site-level change of the measured weeks (GSC Chart by Date), when available. */
  siteChanges: GscMetricChange[];
  /** The cause_identification entry that matched; null = fallback. */
  matched: string | null;
  cause: string;
  countermeasureKey: string;
  countermeasure: string;
  confidence: InvestigationConfidence;
  affectedQueries: string[];
  affectedPages: string[];
  affectedDevice: string | null;
  affectedSearchAppearance: string | null;
  evidence: string[];
  /** How the undefined terms were read (impressions_stable, "concentrated" …). */
  definitions: string[];
}

// ---------- Search Console supporting evidence (rule ① organic decrease) ----------
// Track A — Chart by Date: the only dated GSC data, compared week on week.
// Track B — Pages / Queries / Devices / Countries: period-total snapshots (no dates), never compared or judged.

export interface GscMetricChange {
  metric: 'clicks' | 'impressions' | 'ctr' | 'position';
  previous: number;
  current: number;
  change: number;
  changeRate: number | null;
  /** down / up / same; for position: worse (number up) / better / same. */
  direction: 'down' | 'up' | 'same' | 'worse' | 'better';
}

export interface GscUploadRef {
  id: number;
  fileName: string;
  period: Period | null;
}

export interface GscShareRow {
  key: string;
  clicks: number;
  /** Share of clicks in the snapshot, percent. */
  share: number | null;
  impressions: number;
  impressionsShare?: number | null;
  ctr: number | null;
  position: number | null;
  /** Queries: brand / non-brand (provisional rule). */
  classification?: string;
}

export interface GscSnapshot {
  available: boolean;
  /** Why it is not available (no export uploaded). */
  reason: string | null;
  upload: GscUploadRef | null;
  top: GscShareRow[];
  bottom: GscShareRow[];
  /** Countries: everything after the top rows. */
  other: GscShareRow | null;
  totalClicks: number;
  note: string | null;
}

export interface GscSupportingEvidence {
  dateChart: {
    available: boolean;
    reason: string | null;
    upload: GscUploadRef | null;
    /** Weeks compared: the measured GA4 weeks, or the latest chart weeks when reference only. */
    periods: { current: Period; previous: Period } | null;
    /** The chart does not cover the measured weeks; the latest weeks are shown for reference only. */
    reference: boolean;
    metrics: GscMetricChange[];
    summary: string | null;
    indications: ('ranking' | 'search_demand' | 'ctr')[];
    indicationText: string | null;
  };
  pages: GscSnapshot;
  queries: GscSnapshot & { brandShare: number | null; brandCaveat: string | null };
  devices: GscSnapshot;
  countries: GscSnapshot;
  note: string;
}

export interface Countermeasure {
  id: number;
  causeId: number;
  actionText: string;
  reason: string;
  target: string;
  /** APPLIED_TO: site / traffic_source / page / search_query, and the key of that record. */
  targetType: string | null;
  targetKey: string | null;
  responsibleTeam: string | null;
  status: CountermeasureStatus;
  createdAt: string;
  amendments: Amendment[];
  editable: boolean;
  blocked?: Record<string, string>;
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
  /** Short name shown on the Measurements page, e.g. M1. */
  code: string;
  name: string;
  criteria: string;
  primaryJudgment: string;
  whatToCheckNext: string;
  subject: string;
  /** Analysis unit shown with the result (rules.yaml analysis_unit). */
  analysisUnit: string;
  metric: string;
  thresholdValue: number | null;
  thresholdUnit: 'percent' | 'percentage_points' | 'unresolved';
  thresholdNote: string | null;
  flatBandPercent?: number | null;
  /** Data source the rule judges; it is never applied to the other source. */
  source: Source;
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

// ---------- Weekly monitoring ----------

/** Change of one rule's result since the previous week's run. */
export interface MonitoringItem {
  ruleId: string;
  name: string;
  previous: MeasurementStatus | null;
  current: MeasurementStatus;
  /** new: NG now, not NG last week · continuing: NG both weeks · cleared: NG last week, OK now · unchanged: otherwise */
  change: 'new' | 'continuing' | 'cleared' | 'unchanged';
}

export interface Monitoring {
  previousRun: { id: number; current: Period } | null;
  items: MonitoringItem[];
  /** Anomalies from earlier weeks still open (not Resolved / Dismissed). */
  openFromEarlier: number;
  /** Anomalies resolved or dismissed by the SEO team, all weeks. */
  closed: number;
}

// ---------- GSC overview and GSC Performance Report ----------

export interface GscTotals {
  clicks: number | null;
  impressions: number | null;
  /** Percent, clicks ÷ impressions × 100. */
  ctr: number | null;
  /** Impression-weighted average of the daily positions. */
  position: number | null;
}

export interface GscOverview {
  uploads: { id: number; fileName: string; structure: string | null; period: Period | null; validationStatus: string; rowCount: number; validRowCount: number }[];
  /** The dated Chart by Date: the only GSC data with dates. */
  daily: {
    available: boolean;
    range: Period | null;
    days: number;
    missingDates: string[];
    totals: GscTotals;
    points: { date: string; clicks: number; impressions: number; ctr: number | null; position: number | null }[];
    /** Compared only when two complete 7-day periods exist in the dated data. */
    comparison: { current: Period; previous: Period; rows: { metric: string; previous: number | null; current: number | null; absoluteChange: number | null; changeRate: number | null }[] } | null;
  };
  /** Whole-period snapshot tables (no dates): which exports exist for each dimension. */
  snapshots: Record<'query' | 'page' | 'country' | 'device' | 'appearance', { available: boolean; upload: { id: number; fileName: string; period: Period | null } | null; rows: number }>;
  warnings: { severity: string; message: string; fileName: string; code: string }[];
}

export interface GscReport {
  source: 'GSC';
  fileName: string;
  generatedAt: string;
  content: string;
  doc: ReportDoc;
}


// ---------- Report ----------

/** Generated on request from the database (a view output, not stored). */
export interface Report {
  runId: number;
  fileName: string;
  generatedAt: string;
  /** TXT file (download). */
  content: string;
  /** The same report as sections and blocks, for the formatted preview. */
  doc: ReportDoc;
}

/** Report content as structured blocks; the TXT file and the preview are both rendered from it. */
export interface ReportDoc {
  title: string;
  sections: ReportSection[];
  /** Header and executive-summary facts, taken from the same stored results as the sections. */
  meta?: {
    runId: number;
    dataSources: string[];
    files: string[];
    overall: string;
    evaluated: number;
    ok: number;
    ng: number;
    notEvaluable: number;
    keyFinding: string;
  };
}

export interface ReportSection {
  n: number;
  title: string;
  blocks: ReportBlock[];
}

export type ReportBlock =
  | { t: 'kv'; rows: [label: string, value: string][] }
  | { t: 'table'; columns: string[]; rows: string[][]; title?: string; note?: string }
  | { t: 'p'; text: string; tone?: 'muted' | 'warn' }
  | { t: 'list'; items: string[] }
  /** A result line with its status chip, e.g. [NG] ① Traffic Acquisition — Sessions. */
  | { t: 'status'; status: string; label: string; title: string; meta?: string }
  /** A titled group of blocks (an anomaly, a measurement, a countermeasure, GSC evidence…). */
  | { t: 'group'; title: string; status?: string; statusLabel?: string; blocks: ReportBlock[] };
