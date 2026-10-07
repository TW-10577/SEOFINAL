import type { Issue, Period, RecordStatus, Source, Structure } from '@seo/shared';

export interface NormalizedValue {
  dataDate: string | null;
  pageUrl?: string | null;
  query?: string | null;
  segment?: string | null;
  device?: string | null;
  country?: string | null;
  searchAppearance?: string | null;
  metricName: string;
  sourceMetricName: string;
  metricValue: number | null;
  isValid: boolean;
  invalidReason?: string | null;
}

export interface ParsedRecord {
  rowNumber: number;
  status: RecordStatus;
  values: Record<string, string>;
  issues: string[];
  data: NormalizedValue[];
}

export interface ParsedTable {
  source: Source;
  structure: Structure;
  sheet: string;
  /** Period covered by the table: from dates in the data, the export header, or supplied later. */
  period: Period | null;
  periodNote: string | null;
  /** true when rows carry no date, so the period must come from elsewhere. */
  undated: boolean;
  metadata: Record<string, unknown>;
  records: ParsedRecord[];
  issues: Issue[];
}

/** Result of structure detection on one grid. */
export type Detection = { ok: true; table: ParsedTable } | { ok: false; issue: Issue };
