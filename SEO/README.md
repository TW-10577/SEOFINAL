# LOGOS SEO Page Performance Analysis — PoC

Implements the workflow in `LOGOS_SEO_Workflow_Design.md` and the ontology in
`LOGOS_SEO_Ontology_Design.md_.md`, using **only the client judgment rules in `SEO.txt`**.
The system suggests; the SEO team reviews and decides. It never confirms a cause, approves or
executes a countermeasure, or changes the website.

## Run

```bash
nvm use 22
npm install
cp .env.example .env   # set DATABASE_URL (PostgreSQL), see Database below
npm run dev:api     # http://localhost:8787/api   (PostgreSQL from DATABASE_URL)
npm run dev:web     # http://localhost:5173        (proxies /api)
npm test            # API tests (node:test, against the PostgreSQL test database)
npm run build       # typecheck + build the dashboard
```

Flow: **Data Import → Data → Measurements → Generate Report → Preview / Download TXT**.
There is no separate report page.

## Structure

```
shared/src/index.ts      Domain types and lifecycles shared by API and UI
api/src/
  db.ts                  Database layer (PostgreSQL via `pg`; the only file that knows the driver)
  schema.sql             PostgreSQL schema (traceability chain below)
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

## Upload formats

Any common data or document format can be uploaded: CSV, TSV, TXT (comma, tab, semicolon, pipe or
space-aligned columns), Excel (XLS / XLSX / ODS / Excel XML), JSON, XML, HTML, PDF, Word (DOCX), or a ZIP
of these (e.g. the Search Console export download). The format is detected from the file contents
(`api/src/import/formats.ts`), tables are extracted, and the GA4 / Search Console parsers recognise the
structure exactly as for CSV. Each upload ends as:

| Status | Meaning |
|---|---|
| `imported` | SEO data stored (warnings, if any, are listed) |
| `unsupported` | The file format cannot be read (images, legacy `.doc`, PowerPoint, gzip, unknown binary) — with the reason |
| `failed` | Readable, but processing failed or no GA4 / Search Console data was found (invalid JSON, PDF without text, HTML without a table, …) — with the reason |

PDF tables are rebuilt from text positions; a scanned (image-only) PDF has no text and fails with that reason.

## Source detection and rules

The source is detected per file from its **contents**, never the file name (`api/src/import/detect.ts`):

1. **Layout:** a recognised GA4 Explorations export (セグメント header row) or Search Console Performance
   export (dimension column + クリック数 / 表示回数 / CTR / 掲載順位).
2. **Fields:** otherwise GA4-specific fields (sessions, users, engagement, conversions …) against GSC-specific
   fields (clicks, impressions, CTR, position, query, page …). Two or more, and clearly more than the other side.
3. **Unknown:** the Data Import page asks the SEO team to select GA4 or Google Search Console. The stored file
   is then analysed with that source (`POST /api/uploads/:id/source`).

Only the detected source's parser, validation and rules are applied. GA4 data is judged by the GA4 rules ① ②
in `rules.yaml` (`source: GA4`). SEO.txt gives Search Console no judgment criteria of its own, so GSC data is
used as supporting evidence for rule ① when organic traffic decreases. After each upload the measurement for
the latest GA4 week is re-run, and the upload response lists per file: detected source, applied rules,
validation criteria and the result.

## Database

Uploaded data is stored in **PostgreSQL**. The connection comes from **`DATABASE_URL`** (environment, or `SEO/.env`;
never hard-coded). Tables are created automatically on first start from `api/src/schema.sql`. Every upload is
committed in one transaction: `uploads`, `upload_issues`, `raw_records` (each source line as exported) and
`imported_data` (one metric value per row). Data survives browser refresh and API restarts.

Local PostgreSQL in Docker (data in the named volume `logos-seo-pgdata`):

```bash
docker run -d --name logos-seo-postgres --restart unless-stopped \
  -e POSTGRES_USER=logos -e POSTGRES_PASSWORD=<password> -e POSTGRES_DB=postgres \
  -p 127.0.0.1:5433:5432 -v logos-seo-pgdata:/var/lib/postgresql postgres:18
# Byte-order text sorting (as before) and a separate test database:
docker exec logos-seo-postgres psql -U logos -d postgres \
  -c "CREATE DATABASE logos_seo TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8'" \
  -c "CREATE DATABASE logos_seo_test TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8'"
docker exec -it logos-seo-postgres psql -U logos -d logos_seo -c "SELECT id, file_name, source, import_status, row_count FROM uploads;"
```

Moving data from the earlier SQLite file (`database/seo.db`, only read — never changed) into PostgreSQL, with ids,
dates, values and relationships unchanged and a per-table checksum check:

```bash
npm run db:migrate-sqlite -w api                 # add `-- --replace` to empty the PostgreSQL tables first
```

## Traceability

```
uploads → raw_records (each source line, as exported) → imported_data (one metric value per row)
  → analysis_results (current vs previous; calculated) → measurements (OK / NG / NOT_EVALUABLE)
  → anomalies (Detected) → cause_hypotheses (NotReviewed) → countermeasures (Proposed)
measurement_sources links every measurement to the imported_data rows it used.
state_events records every SEO team decision (who, when, from → to, note).
amendments keeps every SEO team edit of a cause / countermeasure text (old and new text, who, when).
```

Anomaly subjects and countermeasure targets name a record: `anomalies.subject_type/subject_key` and
`countermeasures.target_type/target_key` point at `sites.key` (the property URL from the GA4 export notes),
`traffic_sources.segment`, `pages.url` or `search_queries.query`. Reports are not stored: they are rebuilt
from these tables on every request.

Deleting an upload also deletes the measurement runs that used it, unless the SEO team has recorded decisions on them (then it is refused).

## Measurement logic

| Rule | Evaluation | Follow-up (What to Check Next) |
|---|---|---|
| ① Sessions ±3.9% WoW (GA4, total segment) | \|change rate\| ≥ 3.9 → NG, else OK | Organic ↓ → feedback to SEO team · advertising ↓ → feedback to advertising team · both ↓ → larger decrease is the primary cause (both countermeasures, primary first) · neither ↓ → no follow-up |
| ② CVR ±0.7% WoW (GA4, CVR = CV ÷ Sessions × 100) | **Unit unresolved → NOT_EVALUABLE** (both readings shown). Once `threshold_unit` is set: percent or percentage_points | Needs `flat_band_percent`; until set, the branch is reported as undetermined and no countermeasure is suggested. Combinations the client did not define (e.g. sessions ↓ + CVR ↓) get no branch. |

NOT_EVALUABLE (never OK) when: a day is missing in either week, previous value is 0, threshold
missing, threshold unit unresolved, or the required metric is not in the data.

**Uploaded data always flows** Data Import → Data → Measurements. Dates a GA4 export's own notes mark as
not real (e.g. `# Fake data: 20260916-20260923`) are used and every value and result that depends on them is
labelled **TEST DATA** (`data_policy.evaluate_synthetic_data: true` in `rules.yaml`). The "Include test data"
switch on the Data and Measurements pages (or `false` in `rules.yaml`) leaves those dates out instead; the
page then says which days are real, and no comparison is made up when fewer than 14 days remain.

**Countermeasure = the client's action.** Rule ① suggests exactly "Provide feedback to the SEO team" /
"… to the advertising team"; the evidence found goes into the countermeasure's reason.

Unconfirmed mappings a result depends on (segments, CV column) are shown next to the result
(⚠ Unconfirmed mapping) and in the report.

Confidence (ontology: "to be confirmed") is system-defined and never High for rule ①:
**Medium** = a client-defined Search Console signal was seen in the same weeks; **Low** = none, or no
same-week data. Rule ②: **High** = branch matched with confirmed mappings, **Medium** = depends on an
unconfirmed mapping, **Low** = no branch applies.

## SEO team review

- **Cause:** Confirm / Reject / Needs more evidence, or **Modify** the text (allowed while NotReviewed or
  NeedsMoreEvidence). The generated text is kept in `amendments`.
- **Countermeasure:** **Adjust** the text (while Proposed), Approve or Reject. Approval needs a
  **Confirmed** cause; the anomaly can move to CountermeasureAssigned only with an approved
  countermeasure. Both rules are `guards` on the ontology transitions and are checked by the API; the UI
  disables the button and says why.

## Weekly monitoring

Each run is compared with the previous week's run: per rule **new** (NG now, not before), **continuing**
(NG both weeks), **cleared** (NG before, OK now), plus open anomalies from earlier weeks and the number
resolved / dismissed. Shown under the results on the Measurements page and in report section 13.

## GSC evidence logic

GSC never creates a measurement or anomaly. When rule ① is NG **and organic sessions decreased**:

- **Query tab** — top queries by clicks, brand / non-brand, brand share of query clicks. 3-month total, no WoW.
- **Page tab** — top pages, share = page clicks ÷ site clicks from the daily chart for the same period
  (reproduces SEO.txt: top page 19.6%, /gamepc 7.1%). No WoW.
- **Daily chart** — compared for the **same weeks** as GA4 only if it covers them; client meanings:
  position worse = ranking dropped, impressions ↓ = fewer searches, CTR ↓ = title/snippet problem.
  These are the only cause signals. SEO.txt gives no size, so they are read by direction only
  (no system thresholds). The client chart (exported as 平均読み込み時間のチャート.csv; detected from its
  columns) ends 2026-09-15, so it does not cover the GA4 test weeks and is shown as reference only.
- **Weekly page / query exports** (one per measured week), when uploaded, show where clicks fell. This
  is labelled system analysis, not a client rule, and does not decide the cause. A page or query that is
  in only one week's export is not compared (not in export ≠ 0 clicks).

## Ontology

The system runs on the LOGOS ontology in **`LOGOS_SEO_Ontology_Standalone_Final/`**
(see its `SEO_YAML_README.md`). It compiles with the official LOGOS compiler with 0 diagnostics:

```bash
npm run ontology:check     # needs a LOGOS checkout; LOGOS_REPO=/path/to/LOGOS-main
```

- **Startup:** `api/src/ontology.ts` loads it. The API refuses to start if an object, lifecycle or
  vocabulary the system needs is missing, if an initial state differs from what the system creates, or
  if a rule in `LOGOS_SEO_Ontology_Standalone_Final/rules.yaml` does not fit the JudgmentCondition vocabularies.
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
| Judgment Condition | `LOGOS_SEO_Ontology_Standalone_Final/rules.yaml` (snapshot in `measurement_runs.config_json`), `measurements.rule_id` |
| SEO Anomaly / Cause Hypothesis / Countermeasure | `anomalies` / `cause_hypotheses` / `countermeasures`; state changes in `state_events` |
| BASED_ON, EVALUATED_BY | `measurement_sources`, `measurements.rule_id` |
| DETECTED_ON / APPLIED_TO | `anomalies.subject_type/subject_key` (Site for rules ① ②), `countermeasures.target_type/target_key` |
| Transition guards | `context.causeReviewStatus == 'CONFIRMED'` (approve), `context.hasApprovedCountermeasure == true` (assign); facts supplied by `measure/read.ts` |
| Modify / Adjust | actions `amend-cause-hypothesis`, `adjust-countermeasure` (allowed states from the YAML); history in `amendments` |
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
10. The GA4 file marks 2026-09-16 – 09-23 as fake data, so no complete real two-week period exists.
    Two real GA4 weeks are needed; to use Search Console evidence they must lie inside the GSC daily
    chart (currently 2026-06-16 – 2026-09-15), e.g. 2026-09-02 – 2026-09-15.
11. Search Console signals have no size in SEO.txt: is any worsening enough, or is there a threshold?
