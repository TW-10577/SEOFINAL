-- SEO analysis database (SQLite). Applied by SEO/seo-api on startup; every statement is idempotent.
-- Column meanings follow the SEO ontology in SEO/yaml; allowed enum values are enforced by the API
-- from that ontology, not duplicated here as CHECK constraints.
-- Columns added after a table first shipped are added by the migrations in seo-api/src/db.ts.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS id_sequences (
  prefix     TEXT PRIMARY KEY,                -- DS, ANO, CH, CM, UP
  last_value INTEGER NOT NULL
);

-- The original file exactly as uploaded (CSV, TSV, TXT, XLSX, XLS), kept so any dataset can be re-parsed or audited.
-- The same bytes are stored once; a workbook gives one uploaded_files row and one dataset per sheet.
CREATE TABLE IF NOT EXISTS uploaded_files (
  upload_id   TEXT PRIMARY KEY,
  file_name   TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  file_hash   TEXT NOT NULL UNIQUE,           -- sha256 of the raw bytes
  content     BLOB NOT NULL,
  uploaded_at TEXT NOT NULL                   -- ISO 8601 timestamp
);

-- One row per uploaded CSV file or workbook sheet.
CREATE TABLE IF NOT EXISTS datasets (
  dataset_id        TEXT PRIMARY KEY,
  file_name         TEXT NOT NULL,
  source            TEXT NOT NULL,            -- logos.seo.value.data-source
  uploaded_at       TEXT NOT NULL,            -- ISO 8601 timestamp
  period_start      TEXT,                     -- YYYY-MM-DD, null for snapshot exports
  period_end        TEXT,
  row_count         INTEGER NOT NULL,
  content_hash      TEXT NOT NULL,            -- sha256 of the normalised text; unique among active datasets
  segments_json     TEXT,                     -- GA4 segment labels {total, organic, paid, direct}
  warnings_json     TEXT NOT NULL,            -- data quality warnings, JSON array of strings
  comparisons_json  TEXT NOT NULL,            -- week-over-week comparisons computed at upload
  weekly_trend_json TEXT NOT NULL,
  deleted_at        TEXT,                     -- soft delete: set when hidden, null when active
  upload_id         TEXT REFERENCES uploaded_files(upload_id)  -- null for text posted without a file
);

-- Raw daily values from GSC / GA4 daily exports, one row per date and metric.
-- GSC keys: clicks, impressions, positionWeighted (position × impressions).
-- GA4 keys: <segment>:<metric>, e.g. total:sessions, organic:sessions, total:purchases.
CREATE TABLE IF NOT EXISTS daily_metrics (
  dataset_id TEXT NOT NULL REFERENCES datasets(dataset_id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  value      REAL NOT NULL,
  PRIMARY KEY (dataset_id, date, metric_key)
);

-- Rows from GSC ページ / クエリ exports (one total for the whole export period).
CREATE TABLE IF NOT EXISTS snapshot_rows (
  dataset_id  TEXT NOT NULL REFERENCES datasets(dataset_id) ON DELETE CASCADE,
  row_no      INTEGER NOT NULL,
  row_key     TEXT NOT NULL,                  -- page URL or query text
  clicks      REAL NOT NULL,
  impressions REAL NOT NULL,
  ctr         REAL NOT NULL,
  position    REAL NOT NULL,
  PRIMARY KEY (dataset_id, row_no)
);

-- logos.seo.object.seo-anomaly
CREATE TABLE IF NOT EXISTS anomalies (
  anomaly_id            TEXT PRIMARY KEY,
  dataset_id            TEXT NOT NULL REFERENCES datasets(dataset_id) ON DELETE CASCADE,
  source                TEXT NOT NULL,
  metric_key            TEXT NOT NULL,
  metric_name           TEXT NOT NULL,
  scope                 TEXT NOT NULL,
  kind                  TEXT NOT NULL,        -- logos.seo.value.change-kind
  previous_value        REAL NOT NULL,
  current_value         REAL NOT NULL,
  absolute_change       REAL NOT NULL,
  change_percentage     REAL,
  judgment_condition_id TEXT NOT NULL,        -- logos.seo.object.judgment-condition
  threshold_kind        TEXT NOT NULL,        -- threshold as used at detection time
  threshold_value       REAL NOT NULL,
  threshold_confirmed   INTEGER NOT NULL,     -- 0/1
  threshold_source      TEXT NOT NULL,
  previous_start        TEXT NOT NULL,
  previous_end          TEXT NOT NULL,
  current_start         TEXT NOT NULL,
  current_end           TEXT NOT NULL,
  detection_date        TEXT NOT NULL,
  status                TEXT NOT NULL         -- logos.seo.value.anomaly-status
);

-- logos.seo.object.cause-hypothesis
CREATE TABLE IF NOT EXISTS cause_hypotheses (
  cause_id            TEXT PRIMARY KEY,
  anomaly_id          TEXT NOT NULL REFERENCES anomalies(anomaly_id) ON DELETE CASCADE,
  hypothesis          TEXT NOT NULL,
  supporting_evidence TEXT NOT NULL,
  confidence          TEXT,
  review_status       TEXT NOT NULL,          -- logos.seo.value.review-status
  rule                TEXT NOT NULL,
  rule_confirmed      INTEGER NOT NULL,       -- 0/1
  created_date        TEXT NOT NULL
);

-- logos.seo.object.countermeasure
CREATE TABLE IF NOT EXISTS countermeasures (
  countermeasure_id TEXT PRIMARY KEY,
  cause_id          TEXT NOT NULL REFERENCES cause_hypotheses(cause_id) ON DELETE CASCADE,
  description       TEXT NOT NULL,
  reason            TEXT NOT NULL,
  target            TEXT NOT NULL,
  owner_team        TEXT NOT NULL,
  priority          TEXT NOT NULL,            -- logos.seo.value.priority-level
  status            TEXT NOT NULL,            -- logos.seo.value.countermeasure-status
  created_date      TEXT NOT NULL,
  decided_by        TEXT
);

-- Every status change made by the system or the SEO team, for the decision record.
CREATE TABLE IF NOT EXISTS status_history (
  history_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,                  -- 'dataset' | 'anomaly' | 'cause' | 'countermeasure'
  entity_id   TEXT NOT NULL,
  from_status TEXT,                           -- null when the record was created
  to_status   TEXT NOT NULL,
  changed_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_datasets_active_hash ON datasets(content_hash) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_datasets_upload ON datasets(upload_id);
CREATE INDEX IF NOT EXISTS idx_anomalies_dataset ON anomalies(dataset_id);
CREATE INDEX IF NOT EXISTS idx_causes_anomaly ON cause_hypotheses(anomaly_id);
CREATE INDEX IF NOT EXISTS idx_countermeasures_cause ON countermeasures(cause_id);
CREATE INDEX IF NOT EXISTS idx_status_history_entity ON status_history(entity_type, entity_id);
