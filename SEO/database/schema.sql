-- SEO analysis database (SQLite). Applied by SEO/seo-api on startup; every statement is idempotent.
-- Column meanings follow the SEO ontology in SEO/objects and SEO/value-types; allowed enum values are
-- enforced by the API from that ontology, not duplicated here as CHECK constraints.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS id_sequences (
  prefix TEXT PRIMARY KEY,
  last_value INTEGER NOT NULL
);

-- One row per uploaded CSV file.
CREATE TABLE IF NOT EXISTS datasets (
  dataset_id        TEXT PRIMARY KEY,
  file_name         TEXT NOT NULL,
  source            TEXT NOT NULL,          -- logos.seo.value.data-source
  uploaded_at       TEXT NOT NULL,          -- ISO 8601 timestamp
  period_start      TEXT,                   -- YYYY-MM-DD, null for snapshot exports
  period_end        TEXT,
  row_count         INTEGER NOT NULL,
  content_hash      TEXT NOT NULL UNIQUE,   -- sha256 of the file; the same file is never imported twice
  segments_json     TEXT,                   -- GA4 segment labels {total, organic, paid, direct}
  warnings_json     TEXT NOT NULL,          -- data quality warnings, JSON array of strings
  comparisons_json  TEXT NOT NULL,          -- week-over-week comparisons computed at upload
  weekly_trend_json TEXT NOT NULL
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
  row_key     TEXT NOT NULL,                -- page URL or query text
  clicks      REAL NOT NULL,
  impressions REAL NOT NULL,
  ctr         REAL NOT NULL,
  position    REAL NOT NULL,
  PRIMARY KEY (dataset_id, row_no)
);

-- logos.seo.object.seo-anomaly
CREATE TABLE IF NOT EXISTS anomalies (
  anomaly_id          TEXT PRIMARY KEY,
  dataset_id          TEXT NOT NULL REFERENCES datasets(dataset_id) ON DELETE CASCADE,
  source              TEXT NOT NULL,
  metric_key          TEXT NOT NULL,
  metric_name         TEXT NOT NULL,
  scope               TEXT NOT NULL,
  kind                TEXT NOT NULL,        -- logos.seo.value.change-kind
  previous_value      REAL NOT NULL,
  current_value       REAL NOT NULL,
  absolute_change     REAL NOT NULL,
  change_percentage   REAL,
  threshold_kind      TEXT NOT NULL,        -- logos.seo.value.threshold, as used at detection time
  threshold_value     REAL NOT NULL,
  threshold_confirmed INTEGER NOT NULL,     -- 0/1
  threshold_source    TEXT NOT NULL,
  previous_start      TEXT NOT NULL,
  previous_end        TEXT NOT NULL,
  current_start       TEXT NOT NULL,
  current_end         TEXT NOT NULL,
  detection_date      TEXT NOT NULL,
  status              TEXT NOT NULL,        -- logos.seo.value.anomaly-status
  possible_cause      TEXT NOT NULL
);

-- logos.seo.object.countermeasure
CREATE TABLE IF NOT EXISTS countermeasures (
  countermeasure_id  TEXT PRIMARY KEY,
  related_anomaly_id TEXT NOT NULL REFERENCES anomalies(anomaly_id) ON DELETE CASCADE,
  description        TEXT NOT NULL,
  reason             TEXT NOT NULL,
  owner_team         TEXT NOT NULL,
  priority           TEXT NOT NULL,         -- logos.seo.value.priority-level
  status             TEXT NOT NULL,         -- logos.seo.value.countermeasure-status
  created_date       TEXT NOT NULL,
  rule               TEXT NOT NULL,
  rule_confirmed     INTEGER NOT NULL       -- 0/1
);

-- Every status change made by the system or the SEO team, for the decision record.
CREATE TABLE IF NOT EXISTS status_history (
  history_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,                -- 'anomaly' | 'countermeasure'
  entity_id   TEXT NOT NULL,
  from_status TEXT,                         -- null when the record was created
  to_status   TEXT NOT NULL,
  changed_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_anomalies_dataset ON anomalies(dataset_id);
CREATE INDEX IF NOT EXISTS idx_countermeasures_anomaly ON countermeasures(related_anomaly_id);
CREATE INDEX IF NOT EXISTS idx_status_history_entity ON status_history(entity_type, entity_id);
