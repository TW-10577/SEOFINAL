-- LOGOS SEO PoC — SQLite schema.
-- Traceability chain:
--   uploads → raw_records → imported_data → analysis_results → measurements
--     → anomalies → cause_hypotheses → countermeasures
-- measurement_sources links each measurement to the exact imported_data rows it used.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_info (
  version INTEGER NOT NULL
);

-- ---------- Receive SEO Data / Check and Standardize Data ----------

CREATE TABLE IF NOT EXISTS uploads (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name             TEXT    NOT NULL,
  source                TEXT    NOT NULL CHECK (source IN ('GA4', 'GSC')),
  file_type             TEXT    NOT NULL,
  structure             TEXT,             -- detected from contents, e.g. ga4-explorations, gsc-query
  uploaded_at           TEXT    NOT NULL,
  analysis_period_start TEXT,
  analysis_period_end   TEXT,
  period_note           TEXT,             -- where the period came from
  row_count             INTEGER NOT NULL DEFAULT 0,
  valid_row_count       INTEGER NOT NULL DEFAULT 0,
  validation_status     TEXT    NOT NULL CHECK (validation_status IN ('valid', 'valid_with_warnings', 'invalid')),
  import_status         TEXT    NOT NULL CHECK (import_status IN ('imported', 'rejected')),
  warning_count         INTEGER NOT NULL DEFAULT 0,
  error_count           INTEGER NOT NULL DEFAULT 0,
  schema_version        INTEGER NOT NULL,
  metadata_json         TEXT    NOT NULL DEFAULT '{}'   -- export comments, GSC filters, sheet names
);

CREATE TABLE IF NOT EXISTS upload_issues (
  id          INTEGER PRIMARY KEY,
  upload_id   INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  severity    TEXT    NOT NULL CHECK (severity IN ('error', 'warning')),
  code        TEXT    NOT NULL,
  message     TEXT    NOT NULL,
  row_number  INTEGER,
  column_name TEXT
);

-- One row per source line, exactly as read (header → cell text).
CREATE TABLE IF NOT EXISTS raw_records (
  id          INTEGER PRIMARY KEY,
  upload_id   INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  table_name  TEXT    NOT NULL,           -- structure, plus sheet name for Excel
  row_number  INTEGER NOT NULL,           -- 1-based line / row in the source
  status      TEXT    NOT NULL CHECK (status IN ('valid', 'invalid', 'duplicate', 'total', 'metadata')),
  values_json TEXT    NOT NULL,
  issues_json TEXT    NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS raw_records_upload ON raw_records(upload_id, row_number);

-- SEO Data (O6), normalized to one metric value per row.
CREATE TABLE IF NOT EXISTS imported_data (
  id                INTEGER PRIMARY KEY,
  upload_id         INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  source_record_id  INTEGER NOT NULL REFERENCES raw_records(id) ON DELETE CASCADE,
  source            TEXT    NOT NULL,
  structure         TEXT    NOT NULL,
  data_date         TEXT,                 -- set for daily rows
  period_start      TEXT,                 -- period the value covers (= data_date for daily rows)
  period_end        TEXT,
  page_url          TEXT,
  query             TEXT,
  segment           TEXT,                 -- GA4 segment name as exported
  traffic_source    TEXT,                 -- role from config (total / organic / advertising), if mapped
  device            TEXT,
  country           TEXT,
  search_appearance TEXT,
  metric_name       TEXT    NOT NULL,     -- normalized metric key
  source_metric_name TEXT   NOT NULL,     -- column header as exported
  metric_value      REAL,
  is_valid          INTEGER NOT NULL CHECK (is_valid IN (0, 1)),
  invalid_reason    TEXT
);
CREATE INDEX IF NOT EXISTS imported_data_lookup ON imported_data(source, metric_name, data_date);
CREATE INDEX IF NOT EXISTS imported_data_upload ON imported_data(upload_id);

-- ---------- Ontology objects derived from imported data ----------

CREATE TABLE IF NOT EXISTS pages (
  url   TEXT PRIMARY KEY,
  title TEXT
);

CREATE TABLE IF NOT EXISTS search_queries (
  query TEXT PRIMARY KEY
);

-- Query Classification (O3). Brand division only; the rule is unconfirmed (see config).
CREATE TABLE IF NOT EXISTS query_classifications (
  query                TEXT NOT NULL REFERENCES search_queries(query) ON DELETE CASCADE,
  classification_type  TEXT NOT NULL,     -- brand_division
  classification_value TEXT NOT NULL,     -- brand / non-brand
  rule_source          TEXT NOT NULL,
  PRIMARY KEY (query, classification_type)
);

CREATE TABLE IF NOT EXISTS traffic_sources (
  segment   TEXT PRIMARY KEY,             -- GA4 segment name
  role      TEXT,                         -- total / organic / advertising / null
  confirmed INTEGER NOT NULL DEFAULT 0
);

-- ---------- Analyze / Detect ----------

CREATE TABLE IF NOT EXISTS measurement_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  current_start  TEXT NOT NULL,
  current_end    TEXT NOT NULL,
  previous_start TEXT NOT NULL,
  previous_end   TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  config_json    TEXT NOT NULL,           -- rule configuration used for this run
  issues_json    TEXT NOT NULL DEFAULT '[]'
);

-- Current vs previous period. Absolute change and change rate are calculated values.
CREATE TABLE IF NOT EXISTS analysis_results (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id                INTEGER NOT NULL REFERENCES measurement_runs(id) ON DELETE CASCADE,
  source                TEXT    NOT NULL,
  subject_type          TEXT    NOT NULL,
  subject_key           TEXT    NOT NULL,
  metric                TEXT    NOT NULL,
  current_period_start  TEXT    NOT NULL,
  current_period_end    TEXT    NOT NULL,
  previous_period_start TEXT    NOT NULL,
  previous_period_end   TEXT    NOT NULL,
  previous_value        REAL,
  current_value         REAL,
  absolute_change       REAL,
  change_rate           REAL,
  note                  TEXT
);

CREATE TABLE IF NOT EXISTS measurements (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id             INTEGER NOT NULL REFERENCES measurement_runs(id) ON DELETE CASCADE,
  analysis_result_id INTEGER REFERENCES analysis_results(id) ON DELETE CASCADE,
  measurement_name   TEXT    NOT NULL,
  rule_id            TEXT    NOT NULL,     -- Judgment Condition (O7)
  threshold_value    REAL,
  threshold_unit     TEXT    NOT NULL,
  result             TEXT    NOT NULL,     -- comparison outcome in words
  status             TEXT    NOT NULL CHECK (status IN ('OK', 'NG', 'NOT_EVALUABLE')),
  reason             TEXT    NOT NULL,
  evidence_json      TEXT    NOT NULL,
  created_at         TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS measurement_sources (
  measurement_id   INTEGER NOT NULL REFERENCES measurements(id) ON DELETE CASCADE,
  imported_data_id INTEGER NOT NULL REFERENCES imported_data(id) ON DELETE CASCADE,
  PRIMARY KEY (measurement_id, imported_data_id)
);

-- SEO Anomaly (O8)
CREATE TABLE IF NOT EXISTS anomalies (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  measurement_id INTEGER NOT NULL UNIQUE REFERENCES measurements(id) ON DELETE CASCADE,
  subject_type   TEXT    NOT NULL,
  subject_key    TEXT    NOT NULL,
  metric         TEXT    NOT NULL,
  previous_value REAL    NOT NULL,
  current_value  REAL    NOT NULL,
  change         REAL    NOT NULL,
  change_rate    REAL,
  detection_date TEXT    NOT NULL,
  state          TEXT    NOT NULL DEFAULT 'Detected'
                 CHECK (state IN ('Detected', 'Triaged', 'CountermeasureAssigned', 'Resolved', 'Dismissed'))
);

-- Cause Hypothesis (O9). Never confirmed by the system.
CREATE TABLE IF NOT EXISTS cause_hypotheses (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  anomaly_id          INTEGER NOT NULL UNIQUE REFERENCES anomalies(id) ON DELETE CASCADE,
  branch              TEXT,
  cause_text          TEXT    NOT NULL,
  supporting_evidence TEXT    NOT NULL,
  confidence          TEXT    NOT NULL CHECK (confidence IN ('High', 'Medium', 'Low')),
  confidence_reason   TEXT    NOT NULL,
  review_status       TEXT    NOT NULL DEFAULT 'NotReviewed'
                      CHECK (review_status IN ('NotReviewed', 'Confirmed', 'Rejected', 'NeedsMoreEvidence')),
  created_at          TEXT    NOT NULL
);

-- Countermeasure (O10). Created as Proposed; only the SEO team moves it forward.
CREATE TABLE IF NOT EXISTS countermeasures (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  cause_id         INTEGER NOT NULL REFERENCES cause_hypotheses(id) ON DELETE CASCADE,
  action_text      TEXT    NOT NULL,
  reason           TEXT    NOT NULL,
  target           TEXT    NOT NULL,
  responsible_team TEXT,
  status           TEXT    NOT NULL DEFAULT 'Proposed'
                   CHECK (status IN ('Proposed', 'Approved', 'InProgress', 'Completed', 'VerifiedEffective', 'VerifiedIneffective')),
  created_at       TEXT    NOT NULL
);

-- Human decisions (SEO team review), one row per state change.
CREATE TABLE IF NOT EXISTS state_events (
  id         INTEGER PRIMARY KEY,
  entity     TEXT    NOT NULL CHECK (entity IN ('anomaly', 'cause', 'countermeasure')),
  entity_id  INTEGER NOT NULL,
  from_state TEXT    NOT NULL,
  to_state   TEXT    NOT NULL,
  actor      TEXT    NOT NULL,
  note       TEXT    NOT NULL DEFAULT '',
  at         TEXT    NOT NULL
);

-- Generated report text (a view output, kept so a download matches its preview).
CREATE TABLE IF NOT EXISTS reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id       INTEGER NOT NULL REFERENCES measurement_runs(id) ON DELETE CASCADE,
  file_name    TEXT    NOT NULL,
  content      TEXT    NOT NULL,
  generated_at TEXT    NOT NULL
);
