# LOGOS SEO Page Performance Analysis — PoC

Implements the workflow in `LOGOS_SEO_Workflow_Design.md` and the ontology in
`LOGOS_SEO_Ontology_Design.md_.md`, using **only the client judgment rules in `SEO.txt`**.
The system suggests; the SEO team reviews and decides. It never confirms a cause, approves or
executes a countermeasure, or changes the website.

## Run

```bash
nvm use 22
npm install
npm run dev:api     # http://localhost:8787/api   (SQLite at database/seo.db)
npm run dev:web     # http://localhost:5173        (proxies /api)
npm test            # API tests (node:test)
npm run build       # typecheck + build the dashboard
```

Flow: **Data Import → Data → Measurements → Generate Report → Preview / Download TXT**.
There is no separate report page.

## Structure

```
config/rules.yaml        Client rules ① ②, thresholds, GA4/GSC mappings — unresolved items marked
shared/src/index.ts      Domain types and lifecycles shared by API and UI
api/src/
  schema.sql             SQLite schema (traceability chain below)
  import/                grid.ts (CSV/Excel/encoding) · ga4.ts · gsc.ts · index.ts (validate + persist)
  measure/
    logic.ts             Pure rule logic: change, threshold judgment, rule ① / ② follow-up branches
    series.ts            Daily values per period (latest upload wins, missing days reported)
    gsc-evidence.ts      GSC supporting evidence for rule ① (organic ↓ only)
    engine.ts            Run: analysis results → measurements → anomaly → cause → countermeasure
    read.ts              Read models + SEO team state transitions
  data.ts                Data page queries     report.ts   TXT report from DB records
  app.ts                 HTTP routes (Hono)
api/test/                rules · gsc · import · trace (traceability, persistence, report, API)
dashboard/src/           pages/DataImport · Data · Measurements, components/*
```

## Database

Uploaded data is stored in SQLite at **`SEO/database/seo.db`** (created automatically on first start from
`api/src/schema.sql`; set `SEO_DB_PATH` to use another file). Every upload is committed in one transaction:
`uploads`, `upload_issues`, `raw_records` (each source line as exported) and `imported_data` (one metric value per row).
Data survives browser refresh and API restarts. Open the file with any SQLite viewer, e.g.:

```bash
sqlite3 database/seo.db "SELECT id, file_name, source, import_status, row_count FROM uploads;"
```

## Traceability

```
uploads → raw_records (each source line, as exported) → imported_data (one metric value per row)
  → analysis_results (current vs previous; calculated) → measurements (OK / NG / NOT_EVALUABLE)
  → anomalies (Detected) → cause_hypotheses (NotReviewed) → countermeasures (Proposed)
measurement_sources links every measurement to the imported_data rows it used.
state_events records every SEO team decision (who, when, from → to, note).
```

An upload that is evidence for a measurement cannot be deleted.

## Measurement logic

| Rule | Evaluation | Follow-up (What to Check Next) |
|---|---|---|
| ① Sessions ±3.9% WoW (GA4, total segment) | \|change rate\| ≥ 3.9 → NG, else OK | Organic ↓ → feedback to SEO team · advertising ↓ → feedback to advertising team · both ↓ → larger decrease is the primary cause (both countermeasures, primary first) · neither ↓ → no follow-up |
| ② CVR ±0.7% WoW (GA4, CVR = CV ÷ Sessions × 100) | **Unit unresolved → NOT_EVALUABLE** (both readings shown). Once `threshold_unit` is set: percent or percentage_points | Needs `flat_band_percent`; until set, the branch is reported as undetermined and no countermeasure is suggested. Combinations the client did not define (e.g. sessions ↓ + CVR ↓) get no branch. |

NOT_EVALUABLE (never OK) when: a day is missing in either week, previous value is 0, threshold
missing, threshold unit unresolved, or the required metric is not in the data.

Confidence (ontology: "to be confirmed") is system-defined: **High** = branch matched with complete
data and confirmed mappings; **Medium** = branch matched but depends on an unconfirmed mapping or
unavailable supporting evidence; **Low** = no branch applies.

## GSC evidence logic

GSC never creates a measurement or anomaly. When rule ① is NG **and organic sessions decreased**:

- **Query tab** — top queries by clicks, brand / non-brand, brand share of query clicks. 3-month total, no WoW.
- **Page tab** — top pages, share = page clicks ÷ site clicks from the daily chart for the same period
  (reproduces SEO.txt: top page 19.6%, /gamepc 7.1%). No WoW.
- **Daily chart** — compared for the **same weeks** as GA4 only if it covers them; client meanings:
  position worse = ranking dropped, impressions ↓ = fewer searches, CTR ↓ = title/snippet problem.
  The client chart ends 2026-09-15, before the GA4 current week, so it is shown as reference only and
  not used in the hypothesis.

## Ontology

The system runs on the LOGOS ontology in **`LOGOS_SEO_Ontology_Standalone_Final/`**
(see its `SEO_YAML_README.md`). It compiles with the official LOGOS compiler with 0 diagnostics:

```bash
npm run ontology:check     # needs a LOGOS checkout; LOGOS_REPO=/path/to/LOGOS-main
```

- **Startup:** `api/src/ontology.ts` loads it. The API refuses to start if an object, lifecycle or
  vocabulary the system needs is missing, if an initial state differs from what the system creates, or
  if a rule in `config/rules.yaml` does not fit the JudgmentCondition vocabularies.
- **Decisions:** SEO team state changes are checked against the ontology lifecycles (one governed
  action per transition). The UI shows exactly those actions, with their en/ja names.
- **Endpoint:** `GET /api/ontology` returns the objects, lifecycles, vocabularies, relations and actions.
- **Tests:** `api/test/ontology.test.ts` keeps the database values and engine outputs equal to the
  ontology vocabularies.

| Ontology | Implementation |
|---|---|
| Site, Search Query, Page, Traffic Source | `uploads` / `imported_data` segment, query, page_url; `pages`, `search_queries`, `traffic_sources` |
| Query Classification | `query_classifications` (brand division; provisional rule) |
| Analysis Period | `uploads.analysis_period_*`, `measurement_runs` current / previous |
| SEO Data | `imported_data` (+ `raw_records` = evidence `source-record`) |
| Judgment Condition | `config/rules.yaml` (snapshot in `measurement_runs.config_json`), `measurements.rule_id` |
| SEO Anomaly / Cause Hypothesis / Countermeasure | `anomalies` / `cause_hypotheses` / `countermeasures`; state changes in `state_events` |
| BASED_ON, EVALUATED_BY | `measurement_sources`, `measurements.rule_id` |
| DETECTED_ON / APPLIED_TO | `anomalies.subject_*` (site for rules ① ②), `countermeasures.target` |
| COMPARED_WITH | `analysis_results` (current vs previous) |
| LANDS_ON (query → page) | Not populated: the client exports have no query × page rows |
| Reports, MetricChange | Not objects; the report is generated from DB records |

## Unresolved — client questions

1. **Rule ② unit**: does "±0.7%" mean a relative change or 0.7 percentage points? (`threshold_unit`)
2. **"Flat"** in rule ②: what band counts as flat for sessions / CV? (`flat_band_percent`)
3. Rule ② does not cover sessions ↓ + CVR ↓ — the case in the dummy data. Is a follow-up expected?
4. Rule ① defines follow-up only for decreases; what should happen on a significant increase?
5. GA4 segments: confirm 通販（全体） = total, オーガニックサーチ = organic, ペイド系合算 = advertising.
6. CV: e コマース購入数 or トランザクション?
7. Brand classification rule behind "brand = 66%" (the provisional list gives 65.9%).
8. Weekly GSC exports (or date × page / query) are needed for the daily chart to cover the GA4 weeks
   and for keyword / page changes; current tabs are 3-month totals capped at 1,000 rows.
9. GSC dates are Pacific Time, GA4 is the property time zone — accept the one-day offset?
10. The GA4 file marks 2026-09-16 – 09-23 as fake data; the measured weeks include it.
