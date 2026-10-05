# SEO Page Performance Analysis: Implementation

| | |
|---|---|
| Location | `/home/tw10577/implementation/SEO` |
| Status | Working PoC: upload → analysis → anomaly → countermeasure → review → weekly report, end to end |
| Last updated | 2026-10-05 (CSV, TXT/TSV and Excel upload) |
| Business inputs | `LOGOS_SEO_Workflow_Design.md` (workflow), `SEO.txt` (metric definitions and 判断基準) |

---

## 1. Summary

The system takes Google Search Console (GSC) and GA4 exports (CSV, TXT/TSV or Excel), compares the latest week with the
week before, and flags any metric whose change crosses an agreed threshold. Each flagged change
becomes an **SEO Anomaly** with a suggested cause, and each anomaly gets a proposed **Countermeasure**.
The SEO team reviews both in the UI and records its decision. Everything is stored in a SQLite database.
The SEO ontology YAML defines the data model and is checked against the code every time the API starts.

What it does **not** do:
- It does not change the website or carry out any action. Every countermeasure stays a proposal until the SEO team acts on it.
- It does not call GA4 or GSC directly. Data comes in as uploaded files only.
- It does not use AI or an LLM. The suggested causes come from fixed rules.

The system has three parts:

| Part | Folder | Technology |
|---|---|---|
| Backend API | `seo-api/` | Node.js 22, TypeScript (run with `tsx`), built-in `http` server, `better-sqlite3`, `yaml`, `xlsx` (SheetJS 0.20.3) |
| Frontend | `seo-dashboard/` | React 18, Vite 5, TypeScript |
| Database | `database/` | SQLite (`seo.db`) |
| Data model | `objects/`, `value-types/`, `relations/`, `functions/`, `config/` | LOGOS-style ontology YAML |

SEO is a separate project from LOGOS-main and does not depend on it. The YAML follows the LOGOS
format (`apiVersion: logos.ontology/v0.0.1`) so it can move into LOGOS later.

---

## 2. Folder layout

```
SEO/
├── IMPLEMENTATION.md              this document
├── LOGOS_SEO_Workflow_Design.md   business workflow (input)
├── LOGOS_SEO_Ontology_Design.md_.md
├── SEO.txt                        metric definitions and 判断基準 from the business team (input)
├── download (43).csv              real GA4 export, 2026-09-10〜15
├── download (29) (1).csv          real GA4 export, totals only
├── https___www.dospara.co.jp_-Performance-on-Search-2026-09-18/   real GSC exports
│
├── objects/                       ontology: SEOAnomaly, Countermeasure
├── value-types/                   ontology: statuses, priority, change kind, data source, threshold, period, signed %
├── relations/                     ontology: AnomalyHasCountermeasure
├── functions/                     ontology: DetectSignificantChange, SuggestCause
├── config/thresholds.yaml         week-over-week thresholds
│
├── database/
│   ├── schema.sql                 table definitions
│   ├── seo.db                     real data
│   ├── seo-synthetic.db           synthetic data only
│   └── seo.backup-20261005.db     backup taken before clearing seo.db
│
├── seo-api/                       backend
│   ├── src/main.ts                entry point: loads ontology, opens DB, starts server
│   ├── src/server.ts              HTTP routes
│   ├── src/service.ts             workflow logic (upload, statuses, dashboard, report, delete)
│   ├── src/fileformats.ts         file type, text encoding and Excel sheets → text
│   ├── src/parsers.ts             recognises and reads each export format
│   ├── src/csv.ts                 delimited text, number and date parsing
│   ├── src/analysis.ts            week-over-week comparison and significance test
│   ├── src/rules.ts               cause and countermeasure rules
│   ├── src/ontology.ts            YAML loader and validator
│   ├── src/db.ts                  SQLite access
│   ├── src/types.ts               shared types and enum lists
│   └── test/                      32 automated tests (+ fixtures/)
│
├── seo-dashboard/                 frontend
│   └── src/pages/                 Dashboard, DataUpload, Anomalies, Countermeasures, Reports
│
└── sample-data/
    ├── README.md                  what each synthetic file contains
    ├── generate_synthetic.py      generator (fixed seed, reproducible)
    └── synthetic/                 SYNTHETIC_*.csv
```

---

## 3. How to run

Node 22 is required, because `better-sqlite3` is a native module built for Node 22. Run `nvm use 22` first.

```bash
# first time
cd ~/implementation/SEO/seo-api && npm install
cd ~/implementation/SEO/seo-dashboard && npm install

# terminal 1: API on :8787
cd ~/implementation/SEO/seo-api
npm run dev              # real data      → database/seo.db
npm run dev:synthetic    # synthetic data → database/seo-synthetic.db

# terminal 2: UI on http://localhost:5173
cd ~/implementation/SEO/seo-dashboard && npm run dev
```

The UI dev server forwards every `/api/...` request to `http://localhost:8787` (see `seo-dashboard/vite.config.ts`).
`dev` and `dev:synthetic` both use port 8787, so only one can run at a time.

Other commands:

| Command | Purpose |
|---|---|
| `cd seo-api && npm test` | Run the 32 backend tests |
| `cd seo-api && npm run typecheck` / `cd seo-dashboard && npm run typecheck` | Type checks |
| `cd seo-dashboard && npm run build` | Production build of the UI |
| `cd sample-data && python3 generate_synthetic.py` | Regenerate the synthetic files |
| `sqlite3 database/seo.db` | Inspect the database directly |

On start the API prints what it loaded, for example:

```
SEO API listening on http://localhost:8787
  ontology: /home/tw10577/implementation/SEO/ (2 object types, 1 relations, 2 functions, 5 enums, 6 thresholds)
  database: /home/tw10577/implementation/SEO/database/seo.db
```

If the ontology and the code disagree, the API prints the reason and does not start (see section 9).

---

## 4. End-to-end flow

```
 File (browser): .csv / .tsv / .txt / .xlsx / .xls
      │  POST /api/datasets
      ▼
 1. Receive ────────── decode text (UTF-8 / Shift_JIS / UTF-16); Excel: one dataset per sheet
      │                reject: other file types, unknown format, page/query daily export
      │
 2. Check & standardise ── recognise format, read columns, normalise dates, skip bad rows → warnings
      │                    duplicate check (same content already uploaded → skipped)
      ▼
 3. Analyse ────────── need 14 consecutive days? no → warning, stop here (data still stored)
      │                yes → latest 7 days vs previous 7 days for each metric
      ▼
 4. Detect ─────────── |change| ≥ threshold from config/thresholds.yaml ?
      │                no → shown as a normal comparison
      ▼ yes
 5. Create SEOAnomaly (status Detected)
      ▼
 6. Suggest cause ──── rules.ts (SEO.txt rules ① ②, or GSC heuristics)
      ▼
 7. Propose Countermeasure (status Proposed), linked to the anomaly
      │
      │  every object is validated against the ontology, then saved in one transaction
      ▼
 8. Dashboard / Report ── GET /api/dashboard, GET /api/reports/weekly
      ▼
 9. SEO team review ── PATCH status in Anomalies / Countermeasures tabs; every change logged
```

These steps match the workflow in `LOGOS_SEO_Workflow_Design.md`. One difference: the design's step 9
(weekly monitoring) is on demand here. The report is built whenever someone opens the Reports tab;
nothing runs on a schedule.

---

## 5. Upload and data checks (`fileformats.ts`, `parsers.ts`, `csv.ts`)

### 5.1 Accepted file types

| Extension | How it is read |
|---|---|
| `.csv` | Comma-separated text |
| `.tsv`, `.txt` | Delimited text. Tab-separated when the first data line has more tabs than commas, otherwise comma-separated |
| `.xlsx`, `.xls` | Excel workbook. **Every non-empty sheet becomes its own dataset**, named `<file> [<sheet>]`. A GSC "Export → Excel" workbook therefore gives one dataset per sheet (クエリ, ページ, 日付 chart, …). A sheet that cannot be recognised is reported as an error for that sheet only; the other sheets are still saved. If no sheet can be read, the whole upload is refused |

Anything else is refused: "Unsupported file type. Accepted: .csv, .tsv, .txt, .xlsx, .xls". Maximum size 20 MB.

**Text encodings.** The encoding is detected automatically. Excel on Japanese Windows saves CSV/TXT as
Shift_JIS, and "Unicode text" as UTF-16, so all of these are read:

| Encoding | Detected by |
|---|---|
| UTF-16 LE / BE | Byte order mark at the start of the file |
| UTF-8 (with or without BOM) | Decodes as valid UTF-8 |
| Shift_JIS | Fallback when the file is not valid UTF-8 |

**Excel cells.**
- **Date cells** are written as `YYYY-MM-DD`, read from the cell's date format and not from its display text.
- **Percent cells** keep their displayed text (for example `75.20%`), the same as in the CSV exports.
- **Other numbers** are taken as raw values, without thousands separators.
- **Dates written as text** are also accepted in the forms `YYYY/M/D` and `YYYY.M.D`.

### 5.2 Recognised exports

The format is decided from the first header cell after skipping `#` comment lines and blank lines.

| First header cell | Example file | Treated as | Used for comparison |
|---|---|---|---|
| `日付`, with `クリック数` and no `ページ`/`クエリ` column | `平均読み込み時間のチャート.csv` | `gsc-daily` | Yes |
| `セグメント`, with `日付` rows below | `download (43).csv` | `ga4-daily` | Yes |
| `セグメント`, without `日付` rows | `download (29) (1).csv` | `ga4-snapshot` | No, stored for reference |
| `上位のページ` | `ページ.csv` | `gsc-pages` | No, stored for reference |
| `上位のクエリ` | `クエリ.csv` | `gsc-queries` | No, stored for reference |
| `デバイス`, `国`, `検索での見え方`, `フィルタ` | breakdown exports | `gsc-other` | No, only recorded |
| `日付` with a `ページ` or `クエリ` column | page/query daily exports | **rejected** | Page/query-level analysis is not built yet |
| anything else | | **rejected** | Error message lists the supported formats |

### 5.3 How each export is read

**GSC daily chart.** It needs the columns `クリック数`, `表示回数` and `掲載順位`; if one is missing, the upload is rejected.
For each row the system stores:
- `clicks`
- `impressions`
- `positionWeighted` = position × impressions. Storing this lets average position be weighted by impressions later (section 6.2).

GSC's `CTR` column is not used. CTR is recalculated from clicks and impressions.

**GA4 自由形式 export.**
- Row 1 holds the segment names and row 2 the metric names. Rows whose first cell is a date `YYYYMMDD` are the data; the `総計` total row is skipped.
- The first segment is the total, for example `通販（全体）`.
- Other segments are given a role by their name:
  - contains `オーガニック` → organic
  - contains `ペイド` or `広告` → paid
  - contains `ダイレクト` → direct
- Metrics: `セッション` → sessions; `e コマース購入数` or `トランザクション` → purchases. Other metrics, such as `アクティブ ユーザー` and `DAU/WAU`, are ignored, and a warning names them.
- The upload is rejected if the total segment has no `セッション` column.

**GSC page / query exports.** The columns `クリック数`, `表示回数`, `CTR` and `掲載順位` are required, and each row is stored as is.
These exports hold one total for the whole period, so they cannot be compared week over week.

### 5.4 Checks and warnings

The file is still stored when a warning is raised. Warnings appear in the upload result, on the
Dashboard under **Data quality warnings**, and in the Weekly report.

| Check | Result |
|---|---|
| Date not `YYYY-MM-DD` or `YYYYMMDD` | Row skipped, warning |
| Clicks, impressions or position missing | Row skipped, warning |
| Same date twice | First row kept, warning |
| Fewer than 14 consecutive days ending on the last date | No comparison, warning that names the period and the number of days |
| GA4 file without date rows | Stored as `ga4-snapshot`, warning |
| Snapshot export | Warning that no comparison is possible |

### 5.5 Duplicate files

Every dataset (each sheet, for Excel) is fingerprinted with SHA-256 of its decoded text. Before hashing, the UTF-8 BOM is removed and line endings
are normalised. This matters because browsers strip the BOM when they read a file, so without it the
same file uploaded through the UI and from the command line looked different. A file whose content is
already stored is skipped with "already uploaded". Uploading the same content under a different name
also counts as a duplicate. After a dataset is deleted, its file can be uploaded again.

---

## 6. Anomaly detection (`analysis.ts`)

### 6.1 Which weeks are compared

Let **E** be the last date in the file.

| Week | Days |
|---|---|
| Latest week | E−6 … E (7 days) |
| Previous week | E−13 … E−7 (7 days) |

All 14 days must be present. If any one is missing, the comparison is skipped and a warning explains
why. Example: the real GSC chart ends on 2026-09-15, so it compares 2026-09-09〜15 with 2026-09-02〜08.

### 6.2 How each metric is calculated for a week

Each value is summed over the 7 days, then:

| Metric | Source | Weekly value | Change kind |
|---|---|---|---|
| Clicks | GSC | Σ clicks | relative (%) |
| Impressions | GSC | Σ impressions | relative (%) |
| CTR | GSC | Σ clicks ÷ Σ impressions × 100 | points (pt) |
| Average position | GSC | Σ(position × impressions) ÷ Σ impressions | rank |
| Sessions (total segment) | GA4 | Σ sessions | relative (%) |
| Purchases (total segment) | GA4 | Σ purchases | relative (%), **no threshold** |
| CVR (total segment) | GA4 | Σ purchases ÷ Σ sessions × 100 | points (pt) |
| Sessions per channel (organic / paid / direct) | GA4 | Σ sessions of that segment | relative (%), **no threshold** |

CTR and position are recalculated from the weekly totals; daily percentages are not averaged.
Averaging daily CTRs would give quiet days the same weight as busy days.
Purchases and channel sessions have no threshold, so they are never flagged on their own. They are
shown, and they are used to explain the sessions and CVR rules.

### 6.3 Size of the change

```
absoluteChange   = latest − previous
changePercentage = absoluteChange ÷ |previous| × 100      (null when previous = 0)
```

### 6.4 Significance test

The threshold's kind decides which number is compared with it:

| Kind | Significant when | Used for |
|---|---|---|
| `relative` | \|changePercentage\| ≥ threshold | clicks, impressions, sessions |
| `points` | \|absoluteChange\| ≥ threshold (percentage points) | CTR, CVR |
| `rank` | \|absoluteChange\| ≥ threshold (positions) | average position |

Changes in both directions are flagged: drops, and also rises (improvements). The comparison is `≥`,
so a change exactly at the threshold counts.

### 6.5 Thresholds (`config/thresholds.yaml`)

| Metric | Kind | Value | Confirmed | Source |
|---|---|---|---|---|
| sessions | relative | ±3.9% | **yes** | SEO.txt ① 集客状況: セッション前週比 ±3.9% |
| cvr | points | ±0.7 pt | no | SEO.txt ② 購入効率: CVR前週比 ±0.7%, read as percentage points (see section 15) |
| clicks | relative | ±10% | no | Placeholder; no GSC threshold has been agreed |
| impressions | relative | ±10% | no | Placeholder |
| ctr | points | ±0.5 pt | no | Placeholder |
| position | rank | ±0.5 | no | Placeholder |

To change a threshold, edit the YAML and restart the API. No code change is needed. At startup the
API checks the file: every metric above must be present with the kind shown, unknown metric names are
refused, and each entry must match the `logos.seo.value.threshold` structure.
Each anomaly stores the threshold that was in force when it was detected, so changing the file later
does not rewrite past anomalies. Unconfirmed thresholds are marked `unconfirmed` (or `*`) in the UI.

### 6.6 Worked examples

**Real GSC data (2026-09-09〜15 vs 09-02〜08): no anomaly.**

| Metric | Previous | Latest | Change | Threshold | Flagged |
|---|---|---|---|---|---|
| Clicks | 262,617 | 268,451 | +2.2% | ±10% | no |
| Impressions | 4,537,984 | 4,464,646 | −1.6% | ±10% | no |
| CTR | 5.79% | 6.01% | +0.23 pt | ±0.5 pt | no |
| Average position | 5.97 | 5.90 | −0.07 | ±0.5 | no |

These figures were checked independently with a separate Python calculation over the CSV and match exactly.

**Synthetic GA4 data (`SYNTHETIC_ga4_daily_20260916-20260929.csv`, 09-23〜29 vs 09-16〜22): one anomaly.**

| Metric | Previous | Latest | Change | Flagged |
|---|---|---|---|---|
| Sessions (通販（全体）) | 751,927 | 713,336 | −5.1% | **yes**, crosses ±3.9% |
| Purchases | 7,180 | 6,474 | −9.8% | no threshold |
| CVR | 0.95% | 0.91% | −0.05 pt | no, below ±0.7 pt |
| Organic sessions | 345,895 | 308,545 | −10.8% | no threshold |
| Paid sessions | 37,443 | 37,824 | +1.0% | no threshold |
| Direct sessions | 173,945 | 172,310 | −0.9% | no threshold |

**Synthetic GSC data (`SYNTHETIC_gsc_date_chart_20260916-20260929.csv`): two anomalies.**
Clicks fell 16.3% (above ±10%) and CTR fell 0.86 pt (above ±0.5). Impressions (−1.2%) and position (+0.07) are not flagged.

---

## 7. Cause and countermeasure rules (`rules.ts`)

Every anomaly gets one possible cause and one countermeasure. Each countermeasure records which rule
produced it (`rule`) and whether the SEO team defined that rule (`ruleConfirmed`). The cause is a
suggestion only. The SEO team confirms or rejects it.

### 7.1 Rule ① 集客状況 (GA4 sessions): from SEO.txt, confirmed

Inputs: the change in organic sessions (O) and paid sessions (P), as absolute numbers.

| Situation | Possible cause | Countermeasure | Owner |
|---|---|---|---|
| Sessions fell; O and P both fell | Whichever fell more | Same as the matching row below | SEO team or Ads team |
| Sessions fell; mainly organic | "The decline is mainly organic search" | Check organic landing pages and Search Console clicks and position for the same week | SEO team |
| Sessions fell; mainly paid | "The decline is mainly paid traffic" | Check paid campaign budget, delivery and bids | Ads team |
| Sessions fell; neither O nor P fell | "Neither organic nor paid sessions fell" | Check direct and other channels | SEO team |
| Sessions rose | "Increased, mostly from organic/paid" | Confirm what drove the increase and record it | Team of the larger contributor |
| Export has no organic or paid segment | Channel cannot be identified | Re-export GA4 with those segments | SEO team |

Synthetic example: organic −37,350, paid +381. The drop is mainly organic, so the case goes to the SEO team.

### 7.2 Rule ② 購入効率 (GA4 CVR): from SEO.txt, confirmed rule, unconfirmed threshold

Sessions count as "flat" when their change is smaller than the sessions threshold (±3.9%).

| Situation | Possible cause | Countermeasure |
|---|---|---|
| CVR fell; sessions rose (not flat) | Sessions grew but purchases did not keep up | Check the quality of the added traffic (channels, landing pages) |
| CVR fell; sessions flat | Traffic stable but fewer visitors bought | Check the product side: line-up, prices, stock, page problems |
| CVR fell; sessions also fell | Sessions and CVR fell together | Review together with the sessions anomaly |
| CVR rose | Purchase efficiency improved | Identify the improvement factor and whether it can be repeated |

Owner: SEO team.

### 7.3 GSC heuristics: written by the developer, **not agreed with the SEO team**

`SEO.txt` has no rules for GSC metrics, so these are placeholders, and every one is marked
`ruleConfirmed: false` in the UI. "Position held" means the position change was not significant.

| Anomaly | Situation | Countermeasure |
|---|---|---|
| CTR fell | Position held | Review titles, meta descriptions and product rich results on the top pages |
| CTR fell | Position also dropped | Address the ranking drop first |
| Position worsened | | Compare top queries and pages with the previous export; check recent site changes and Google updates |
| Impressions fell | Position held | Likely lower demand: check seasonality and the sale calendar before changing pages |
| Impressions fell | Position also dropped | Address the ranking drop first |
| Clicks fell | | Cause names whichever of impressions, CTR or position also changed significantly; follow that anomaly |
| Any metric improved | | Identify what drove the improvement and whether it can be applied to other pages |

### 7.4 Priority

| Condition | Priority |
|---|---|
| Change is an improvement (for position, a lower number) | Low |
| Worsening of at least 2 × threshold | High |
| Any other worsening | Medium |

Example: sessions −5.1% against ±3.9%. Twice the threshold is 7.8%, so the priority is Medium.

### 7.5 Not implemented from SEO.txt

Rules ③ 販売台数・価格影響, ④ シェア・競合セール and ⑤ 商品詳細への遷移率 are not implemented.
They need data that has not been supplied: sales by model, prices, market share, competitor sales and
transition rates to product pages.

---

## 8. Review workflow and decision record

### 8.1 Anomaly status (`logos.seo.value.anomaly-status`)

`Detected` → `UnderReview` → `Confirmed` → `Resolved`. The SEO team can set any of the four statuses
in the **Anomalies** tab. "Open" means any status except `Resolved`.

### 8.2 Countermeasure status (`logos.seo.value.countermeasure-status`)

Only these moves are allowed. Anything else is refused with a message that lists the allowed moves.

| From | Allowed next |
|---|---|
| Proposed | Approved, Rejected |
| Approved | Implemented, Rejected |
| Implemented | Verified |
| Verified | (final) |
| Rejected | Proposed (reopen) |

### 8.3 History

Every creation and every status change is written to `status_history` with the old status, the new
status and a timestamp: `GET /api/status-history`, optionally `?id=ANO-0001`. The UI does not show this
history yet. There is no login, so the history does not record who made a change.

---

## 9. Ontology integration (`ontology.ts`)

### 9.1 Files

| File | Defines |
|---|---|
| `objects/seo-anomaly.logos.yaml` | SEOAnomaly: 17 properties |
| `objects/countermeasure.logos.yaml` | Countermeasure: 10 properties |
| `value-types/value-type-anomaly-status.logos.yaml` | Detected, UnderReview, Confirmed, Resolved |
| `value-types/value-type-countermeasure-status.logos.yaml` | Proposed, Approved, Implemented, Verified, Rejected |
| `value-types/value-type-priority-level.logos.yaml` | High, Medium, Low |
| `value-types/value-type-change-kind.logos.yaml` | relative, points, rank |
| `value-types/value-type-data-source.logos.yaml` | gsc-daily, ga4-daily, ga4-snapshot, gsc-pages, gsc-queries, gsc-other |
| `value-types/value-type-threshold.logos.yaml` | structure: kind, value, confirmed, source |
| `value-types/value-type-period.logos.yaml` | structure: start, end |
| `value-types/value-type-signed-percentage.logos.yaml` | number, minimum −100, no maximum |
| `relations/relation-anomaly-has-countermeasure.logos.yaml` | SEOAnomaly ↔ Countermeasure |
| `functions/function-detect-significant-change.logos.yaml` | inputs and outputs of the detection step (`analysis.ts`) |
| `functions/function-suggest-cause.logos.yaml` | inputs and outputs of the rules step (`rules.ts`) |

Value types owned by other LOGOS packages are only referenced: `shared-core` short-text, long-text,
number, date and boolean, and `retail-ec-common` subject-id. The loader treats them as text, number,
`YYYY-MM-DD` date and true/false.

### 9.2 What is checked at startup

The API refuses to start, with a message naming the problem, when:
1. A YAML file cannot be parsed, or a value type has an unsupported `valueKind`.
2. Any `valueTypeRef` in an object, structured value type, relation accessor or function parameter does not resolve.
3. The values of an enum in YAML differ from the list the code uses, in either direction. This applies to anomaly status, countermeasure status, priority, change kind and data source.
4. `config/thresholds.yaml` is missing a metric, has an unknown metric, uses the wrong kind, or has an invalid value.

It also warns, without stopping, when a record already in the database no longer matches the ontology.

### 9.3 What is checked at runtime

- **Before saving:** every SEOAnomaly and Countermeasure is validated against its object type. Missing required fields, nulls in non-nullable fields, wrong types, values outside an enum and fields that are not defined all cause the save to fail.
- **Status changes:** the allowed anomaly statuses are read from the YAML enum.
- **`GET /api/ontology`:** returns the loaded objects, relations, functions, enums and thresholds. The Dashboard's **Thresholds** panel is built from it.

### 9.4 Limits

The YAML has not been run through the official LOGOS validator (`pnpm ir:build` in LOGOS-main).
Some formats are this project's own: `valueKind: structured`, function `input`/`output` parameter
blocks, and `config/thresholds.yaml`. These would need to be aligned before moving into LOGOS-main.

---

## 10. Database (`database/schema.sql`, `seo-api/src/db.ts`)

SQLite in WAL mode, with foreign keys on. The schema is applied on every start and is idempotent.

| Table | One row per | Key columns |
|---|---|---|
| `datasets` | uploaded file | `dataset_id` (DS-0001…), file name, source, upload time, period, row count, `content_hash` (unique), warnings, comparisons and weekly trend (JSON) |
| `daily_metrics` | date × metric of a daily export | `dataset_id`, `date`, `metric_key` (e.g. `clicks`, `total:sessions`, `organic:sessions`), `value` |
| `snapshot_rows` | row of a GSC page/query export | `dataset_id`, `row_no`, `row_key` (URL or query), clicks, impressions, CTR, position |
| `anomalies` | SEOAnomaly | `anomaly_id` (ANO-0001…), metric, scope, values, change, threshold used, both periods, status, possible cause |
| `countermeasures` | Countermeasure | `countermeasure_id` (CM-0001…), `related_anomaly_id`, description, reason, owner, priority, status, rule, rule_confirmed |
| `status_history` | status change | entity type and id, from, to, timestamp |
| `id_sequences` | ID prefix | last number used for DS / ANO / CM |

- **Uploads are atomic.** A dataset, its raw rows, anomalies and countermeasures are saved in one transaction. If any part fails, nothing is kept.
- **Deleting a dataset** (the **Delete** button on the Upload tab) also removes its raw rows, anomalies, countermeasures and their history. The UI first shows how many anomalies and countermeasures will go, and whether any already carry an SEO team decision.
- **Backup:** copy `seo.db` together with `seo.db-wal` while the API is running, or use `sqlite3 seo.db ".backup copy.db"`.

---

## 11. API

All responses are JSON. Errors are returned as `{ "error": "..." }` with status 400, 404, 413 or 500.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | `{ ok: true }` |
| GET | `/api/ontology` | Loaded ontology summary and thresholds |
| GET | `/api/datasets` | All uploaded datasets |
| POST | `/api/datasets` | Upload a file. Body: the raw file bytes. Header `X-File-Name`: URL-encoded file name (the extension decides how it is read). Returns `{ items: [...] }`, one item per dataset (one per sheet for Excel). Each item has the dataset, its new anomalies and countermeasures and the duplicate flag, or an `error` for that sheet |
| GET | `/api/datasets/:id/deletion-impact` | What deleting this dataset would remove |
| DELETE | `/api/datasets/:id` | Delete a dataset and everything derived from it |
| GET | `/api/dashboard` | Counts, latest comparisons, GSC weekly trend, open anomalies, warnings |
| GET | `/api/anomalies` | All anomalies, newest first |
| PATCH | `/api/anomalies/:id` | `{ "status": "UnderReview" }` |
| GET | `/api/countermeasures` | All countermeasures, newest first |
| PATCH | `/api/countermeasures/:id` | `{ "status": "Approved" }` (transitions as in section 8.2) |
| GET | `/api/reports/weekly` | Weekly report data |
| GET | `/api/status-history` | Status history (`?id=` to filter) |

There is no authentication. The API is meant to run on a developer machine only.

---

## 12. User interface (`seo-dashboard/`)

The layout follows the LOGOS workbench: a dark green header (LOGOS · SEO DOMAIN · 0.0.1), a sidebar
with one application (**SEO**), and the SEO sections as tabs across the top.

| Tab | Shows | Actions |
|---|---|---|
| **Dashboard** | Counts (datasets, open anomalies, anomalies detected, awaiting decision, approved actions); latest week vs previous week for the newest GSC and GA4 datasets; open anomalies (up to 5); GSC weekly trend for up to 12 weeks; thresholds with their confirmed state; data quality warnings | |
| **Upload data** | Drop zone for CSV, TXT/TSV and Excel (several files at once); result per dataset, so one line per Excel sheet (type, rows, period, anomalies, warnings or error); table of uploaded datasets | Upload, Delete (with confirmation) |
| **Anomalies** | Each anomaly: metric, scope, both periods, values, change, threshold (unconfirmed marked), possible cause | Filter by status and metric; set status |
| **Countermeasures** | Each countermeasure: action, reason, owner, priority, status, rule (unconfirmed marked), linked anomaly | Filter by status and team; Approve, Reject, Mark implemented, Mark verified, Reopen |
| **Reports** | 1 data sources and periods · 2 metric changes · 3 anomalies and causes · 4 countermeasures and decisions · 5 open items · 6 data quality warnings | Regenerate, Print / PDF |

If the API is not running, every tab shows "Cannot reach the SEO API. Start it with `npm run dev` in SEO/seo-api."

---

## 13. Verification

### 13.1 Automated tests (`cd seo-api && npm test`): 32 tests, all passing

| Area | What is tested |
|---|---|
| Real exports | GSC chart: 92 days and 12 weekly trend rows. GA4 6-day file gives a warning and no comparison. GA4 totals and ページ.csv (1000 rows) stored as snapshots |
| Duplicates | Same file twice is skipped. A BOM or CRLF version of the same content is also skipped |
| Detection | GA4 sessions −5% is flagged at ±3.9% and blamed on organic. A 3% change is not flagged. CTR is recalculated from totals and position is impression-weighted |
| File formats | Tab-separated .txt and .tsv, comma .txt, Shift_JIS, UTF-16 and UTF-8 with BOM, .xlsx with real date and percent cells, multi-sheet workbook (one dataset per sheet, bad sheet reported separately), legacy .xls, `YYYY/M/D` dates |
| Rejection | Unknown format, unsupported file type, unreadable workbook, page-level daily export |
| Workflow | Countermeasure transitions enforced. Dashboard and weekly report counts |
| Database | Data and decisions survive a restart. Raw daily values stored. Every status change recorded. Delete removes all derived records and the file can be uploaded again. A failed upload leaves nothing behind |
| Ontology | Real YAML loads and matches the code. Startup refused on enum drift, on an invalid or wrong-kind threshold, and on a broken reference in an object, relation or function. A changed threshold changes detection (±6% stops a −5% drop being flagged). Non-conforming objects are rejected |

### 13.2 Manual checks

- Weekly GSC sums checked against an independent Python calculation (section 6.6).
- Real GSC exports combined into one 7-sheet .xlsx: every sheet recognised with the same row counts as the CSVs. `download (43).csv` re-saved as a Shift_JIS tab-separated .txt: read as GA4 daily, 6 rows.
- Full workflow through HTTP on a temporary database: upload, anomaly, countermeasure to SEO team, approve, refused invalid moves, history (4 entries), report and dashboard counts.
- All endpoints return 200 through the UI's `/api` proxy. Both apps type-check and the UI builds.
- **Not done by the developer:** clicking through the UI in a browser. The screens have been seen only through screenshots shared during development.

---

## 14. Synthetic data (`sample-data/`)

The real exports cover only one period (see section 15), so synthetic files were generated to exercise
detection and the later steps. Every file name starts with `SYNTHETIC_`. The levels are based on the
real exports; the daily values and scenarios are invented. `sample-data/README.md` has the details.

| File | Contents | Usable now |
|---|---|---|
| `SYNTHETIC_ga4_daily_20260916-20260929.csv` | 14 days of GA4; organic −11% in week 2 | Yes: 1 anomaly (sessions) |
| `SYNTHETIC_gsc_date_chart_20260916-20260929.csv` | 14 days of GSC; CTR −12% on every page in week 2 | Yes: 2 anomalies (clicks, CTR) |
| `SYNTHETIC_download (43)_2weeks_20260902-20260915.csv` | The real `download (43).csv` rows (09-10〜15, unchanged) plus 8 invented days (09-02〜09) with no trend | Yes: 0 anomalies, by design |
| `SYNTHETIC_gsc_pages_daily_20260916-20260929.csv` | 1000 real URLs × 14 days; `/gamepc` loses about 1.9 positions; one page disappears from 09-25 | No: page-level analysis not built |
| `SYNTHETIC_gsc_queries_daily_20260916-20260929.csv` | Real top 1000 plus 1,500 invented long-tail queries × 14 days; `ゲーミングpc` loses about 2.3 positions; `vspo pc` disappears | No: query-level analysis not built |

Synthetic data has its own database (`npm run dev:synthetic`), which already holds the two usable
synthetic files. If synthetic files are uploaded into the real database, remove them with **Delete**.

---

## 15. Open issues and decisions needed

### Decisions for the SEO / business team

| # | Question | Why it matters |
|---|---|---|
| 1 | **CVR threshold unit.** Does "CVR前週比 ±0.7%" mean 0.7 percentage points or 0.7% relative? | Real CVR is about 0.95% (6,207 ÷ 653,096). As percentage points, CVR would have to fall to about 0.25% before anything is flagged, so in practice it never fires. In the synthetic test purchases fell 9.8% and nothing was flagged |
| 2 | **GSC thresholds.** Clicks, impressions, CTR and position use placeholders (±10%, ±10%, ±0.5 pt, ±0.5) | Until agreed, GSC anomalies are only indicative |
| 3 | **GSC rules.** The countermeasures in section 7.3 are developer heuristics | They should be confirmed, replaced or extended by the SEO team |
| 4 | **Two-period exports.** All GSC page/query files are a single 3-month total, and GA4 covers 6 days | Without at least 14 consecutive days, steps 4–9 cannot run on real data |
| 5 | **Query list limit.** The query export stops at the top 1000, which covers 44.4% of clicks (pages: 94.1%) | A query that drops out of the top 1000 would look like a 100% drop. A rule for this is needed before query-level analysis |
| 6 | **Rules ③ ④ ⑤** | Need sales by model, prices, share, competitor sales and transition rates |

### Technical limitations

| Limitation | Note |
|---|---|
| Page- and query-level analysis not built | Detection runs on site-level GSC and GA4 channels only. Page/query daily files are rejected with a clear message. The synthetic data for this work is ready |
| GA4 and GSC are not joined | They have different periods and units, and no shared key such as a landing page URL |
| Only the latest two weeks are compared | Older weeks appear in the GSC trend table but are not checked for anomalies |
| No login | There is no user identity, and the history does not record who made a change |
| No scheduled run | The weekly report is produced when the tab is opened |
| Excel password-protected files | Cannot be read; remove the password first |
| Node 22 required | `better-sqlite3` is a native module; `seo-api/.nvmrc` pins version 22 |
| Not validated by LOGOS | See section 9.4 |
| Status history not shown in the UI | Available through the API only |

---

## 16. Correction to the earlier data gap report

| Report said | Actual |
|---|---|
| Query file: 999 rows | 1000 rows |
| Page file: 1,077 rows | 1000 rows (1,077 is the file's line count, not its row count) |
| Coverage: 44.4% (queries), 94.1% (pages) | Correct: 1,513,981 and 3,209,424 of 3,409,251 clicks |
