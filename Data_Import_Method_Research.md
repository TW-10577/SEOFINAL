# Data Import Method — Research & PoC CSV Layouts

**Project:** LOGOS Squad A  **Site:** www.dospara.co.jp  **Date:** 2026-09-25  **Author:** Krithika (with Claude)

| # | Task | Source | Deliverable |
|---|---|---|---|
| 1 | Data Import Method | **FromDB** (internal order / sales DB) | Ingestion method + PoC CSV layout |
| 2 | Data Import Method | **ImportExternal – GA4** | Ingestion method + PoC CSV layout |
| 3 | Data Import Method | **ImportExternal – Google Search Console** | Ingestion method + PoC CSV layout |
| 4 | Data Import Method | **ImportExternal – Crawl results** | Ingestion method + PoC CSV layout |

---

## 0. Summary of decisions

| Source | PoC ingestion (now) | Target ingestion (after PoC) | Grain | Refresh | Key constraint |
|---|---|---|---|---|---|
| FromDB (ISM order slips) | Scheduled CSV extract of ISM search template **#370**, dropped to a landing folder | TEBIS Data Product (DB → TEBIS → LOGOS), no direct DB connection from LOGOS | day × store × department | Daily (D+1, JST) | LOGOS red line: **LOGOS does not ingest from source DBs** (D0 §2.2, D2 SRC-02) |
| GA4 | **GA4 Data API `runReport`** → normalized long CSV | **GA4 → BigQuery export** (`events_YYYYMMDD`) → TEBIS | day × channel group × landing page | Daily (D+1) | Standard property: 1M events/day export cap; API token quota 200k/day |
| Search Console | **Search Analytics API** (daily, paged 25k rows) → CSV | **Bulk Data Export → BigQuery** (`searchdata_url_impression`) → TEBIS | day × page × query × device × country | Daily (data lag 2–3 days) | UI export caps at **1,000 rows**; dates are **Pacific Time** |
| Crawl results | Scheduled crawler (competitor order-number RPA + PageSpeed Insights API + site crawler) → CSV | Same jobs, output registered as a TEBIS Data Product | observation × target × metric | Daily (competitors), weekly (site audit) | robots.txt / ToS / legal review; estimated values must be flagged |

**Common rule for all four:** everything reaches LOGOS as a **file- or table-based Data Product with a contract** (schema version, freshness, quality flags, lineage), matching the `SourceBinding` fields in D2 §18.3 (`mode`, `freshness`, `degradation`, `nullHandling`, `unknownValueHandling`).

---

## 1. What the uploaded sample data tells us

| File | Source | Observation | Implication for ingestion |
|---|---|---|---|
| `download 29.csv`, `download 43.csv` | GA4 Explorations (free-form) export | 5 comment lines (`# ----`), **2-row header** (segment + metric), a **totals row** tagged `総計` in a trailing column, UTF-8 **with BOM**, wide layout (one column per segment × metric) | UI exports are not machine-friendly; PoC should use the API and a **long (tidy) format** instead |
| `1790323527467_クエリ.csv` | GSC Performance → Queries | Exactly **1,000 rows** = UI export cap. These rows sum to 1,513,981 clicks of **3,409,251 total** (~44%) | UI export loses ~56% of query clicks (long tail + anonymized). Use API / Bulk Export |
| `1790323527469_ページ.csv` | GSC → Pages | 1,000 rows, 3,209,424 clicks (~94% of total) | Page level is mostly covered, but still capped |
| `…_デバイス.csv`, `…_国.csv`, `…_検索での見え方.csv`, `…_平均読み込み時間のチャート.csv` | GSC → other tabs | Each dimension exported separately; daily chart = 92 days (2026-06-16 → 09-15); `フィルタ.csv` holds filter metadata (web, last 3 months) | Each export is a separate 1-D cut; the API returns them **combined** in one row set. Filter metadata must travel with the file (manifest) |
| `PC_Order_Status_….xlsx` → `DP Order Source Data` | ISM general search #370 (internal DB) | Columns: store code, department, slip date, slips incl. deleted, deleted slips, paid slips. Pasted manually daily, no header | Good candidate for an automated scheduled extract; clean grain |
| `PC_Order_Status_….xlsx` → `Order History`, `Order History (2)` | RPA crawl of competitor sites (Mouse, PC Koubou, Lenovo, HP, Dell, ASUS, MDL, Frontier…) | Order numbers captured per day/hour; daily orders are **derived from number deltas**. Manual rules: Lenovo leading "G" removed, Dell counter reset (`9999999`), missing days interpolated and **coloured grey** | Crawl CSV needs `raw_value`, `derived_value`, `is_estimated`, `estimation_method`, `counter_reset` fields — not colours |
| `PC_Order_Status_….xlsx` → `GA Sessions+CVR`, `Page Speed Scores` | GA4 UI, WebPageTest / PageSpeed Insights | Manually typed; speed scores only a few rows | Replace with GA4 API + PSI API jobs |
| `キャンペーンページデータ集計.xlsx` | GA4 per campaign page | ~30 weekly sheets (`セッション比較MMDD`), layouts drift sheet to sheet (23 → 160 columns), `ー` used for "no data" | Needs a fixed layout + `page_group` master (campaign ↔ URL mapping); `ー` must become NULL/UNKNOWN, not 0 |

**Cross-source gotchas found**

- **Time zone:** GSC dates are Pacific Time; GA4 and ISM are JST. Store the source date *and* its time zone (`date_tz`).
- **Definitions differ:** GA4 "e-commerce purchases" ≠ ISM "paid slips" ≠ competitor "order-number delta". Keep them as separate metrics; reconcile in a derived layer.
- **Unknown vs zero:** `ー`, blank cells and grey estimates must map to `NULL` + a status flag (D2 SRC-06: separate `nullHandling` / `unknownValueHandling`).

---

## 2. FromDB — internal order / sales database

### 2.1 Options

| Option | How | Pros | Cons | Verdict |
|---|---|---|---|---|
| A. Manual copy-paste (current) | ISM general search #370 → copy → paste into Excel | No setup | Error-prone, person-dependent, no lineage | ✗ Replace |
| B. Scheduled CSV extract (file drop) | ISM saved search / SQL export on a schedule → SFTP / shared folder / cloud storage | Fast to set up, no DB credentials outside IT, easy to audit | Batch only; file-contract discipline needed | ✅ **PoC** |
| C. Direct DB connection (JDBC/ODBC) from LOGOS | LOGOS queries the DB | Fresh data | **Forbidden** by D0 §2.2 / D2 SRC-02; security & load risk | ✗ |
| D. TEBIS Data Product (ELT / CDC → warehouse) | TEBIS pulls from DB (batch or CDC), publishes a governed table | Governed, reusable, lineage, quality checks | Needs TEBIS scheduling | ✅ **Target** |

**Decision:** PoC = Option B (daily CSV extract, delivered by the DB owner). Submit the same layout to TEBIS as a **data requirement** (D1 Stage 3) so Option D replaces it without changing the schema.

### 2.2 PoC CSV layout — `fromdb_order_daily_YYYYMMDD.csv`

| # | Column | Type | Required | Example | Notes |
|---|---|---|---|---|---|
| 1 | `order_date` | DATE (YYYY-MM-DD) | ✅ | 2026-09-24 | Slip date, JST |
| 2 | `store_code` | STRING | ✅ | 1 | Keep as string (leading zeros) |
| 3 | `department_name` | STRING | ✅ | Dospara Mail-Order Dept. | Or `department_code` + master |
| 4 | `channel` | ENUM | ✅ | mail_order / corporate / wholesale / store | Controlled vocabulary |
| 5 | `slips_total` | INT | ✅ | 2604 | Incl. deleted |
| 6 | `slips_deleted` | INT | ✅ | 1451 | |
| 7 | `slips_paid` | INT | ✅ | 1717 | |
| 8 | `units` | INT | ○ | | PC units if available |
| 9 | `sales_amount_jpy` | DECIMAL | ○ | | Tax-excluded; state rule in manifest |
| 10 | `extract_query_id` | STRING | ✅ | ISM-370 | Lineage |
| 11 | `extracted_at` | TIMESTAMP (ISO 8601, +09:00) | ✅ | 2026-09-25T06:00:00+09:00 | |

Primary key: `order_date + store_code + department_name + channel`. Re-delivery of a date **replaces** that date (idempotent upsert).

```csv
order_date,store_code,department_name,channel,slips_total,slips_deleted,slips_paid,units,sales_amount_jpy,extract_query_id,extracted_at
2023-01-01,1,Dospara Mail-Order Dept.,mail_order,2604,1451,1717,,,ISM-370,2026-09-25T06:00:00+09:00
2023-01-02,1,Dospara Mail-Order Dept.,mail_order,2536,1429,1720,,,ISM-370,2026-09-25T06:00:00+09:00
```

---

## 3. ImportExternal — GA4

### 3.1 Options

| Option | How | Pros | Cons | Verdict |
|---|---|---|---|---|
| A. UI / Explorations CSV export | Manual download | Zero setup | Comment lines, 2-row headers, totals rows, sampling/thresholding, manual | ✗ (only for ad-hoc) |
| B. **GA4 Data API (`runReport`)** | Script (Python client) daily; service account with Viewer role | Aggregated data matching UI, easy, free | Token quotas (standard: 200k/day, 40k/hour, 14k per project/hour); `(other)` row on high cardinality; thresholding may apply | ✅ **PoC** |
| C. **BigQuery Export** | Link GA4 → BigQuery (daily and/or streaming) | Raw, unsampled event-level; joinable with GSC & DB; full history from link date | Standard property cap **1M events/day** for daily export; BigQuery cost; sessionization needs SQL | ✅ **Target** (via TEBIS) |
| D. 3rd-party connectors (Fivetran, Airbyte, etc.) | Managed pipeline | Low code | Cost, another vendor | Optional |

**Decision:** PoC = Data API with a fixed report definition (below). Enable BigQuery export **now** (history only starts from link date), and move to it as TEBIS Data Product after PoC. Check event volume vs 1M/day cap (the site has ~100k+ sessions/day, so events/day likely exceed 1M → streaming export or 360 may be required, or event filtering).

### 3.2 PoC report definition

- Dimensions: `date`, `sessionDefaultChannelGroup`, `landingPagePlusQueryString` (or `landingPage`), `deviceCategory`
- Metrics: `sessions`, `activeUsers`, `ecommercePurchases`, `transactions`, `purchaseRevenue`
- Separate small report for segment-level KPIs matching current sheets (Top page, campaign pages, organic / direct / paid) — done by mapping landing page → `page_group` master rather than GA4 segments.

### 3.3 PoC CSV layout — `ga4_daily_YYYYMMDD.csv` (long / tidy)

| # | Column | Type | Required | Example | Notes |
|---|---|---|---|---|---|
| 1 | `date` | DATE | ✅ | 2026-09-10 | Property time zone (JST) |
| 2 | `property_id` | STRING | ✅ | 123456789 | |
| 3 | `channel_group` | STRING | ✅ | Organic Search | GA4 default channel group |
| 4 | `landing_page` | STRING | ✅ | /gamepc | Path only, query string removed or kept per rule |
| 5 | `page_group` | STRING | ○ | top / campaign:customize-half-price | From page-group master |
| 6 | `device_category` | ENUM | ✅ | mobile / desktop / tablet | |
| 7 | `sessions` | INT | ✅ | 105296 | |
| 8 | `active_users` | INT | ✅ | 34824 | |
| 9 | `ecommerce_purchases` | INT | ✅ | 988 | |
| 10 | `transactions` | INT | ○ | 1842 | |
| 11 | `purchase_revenue_jpy` | DECIMAL | ○ | | |
| 12 | `is_thresholded` | BOOL | ✅ | false | From API metadata |
| 13 | `extracted_at` | TIMESTAMP | ✅ | 2026-09-25T06:00:00+09:00 | |

Rules: no totals rows (compute them), no ratios stored (CVR, DAU/WAU are **derived**), one header row, UTF-8 without BOM.

```csv
date,property_id,channel_group,landing_page,page_group,device_category,sessions,active_users,ecommerce_purchases,transactions,purchase_revenue_jpy,is_thresholded,extracted_at
2026-09-10,123456789,Organic Search,/gamepc,category:gamepc,mobile,12034,9811,95,,,false,2026-09-25T06:00:00+09:00
```

**Mapping from current export (`download 43.csv`):** `通販（全体） オーガニックサーチ / セッション` → `channel_group=Organic Search`, metric `sessions`; `ペイド系合算` → sum of paid channel groups (define in master).

---

## 4. ImportExternal — Google Search Console

### 4.1 Options

| Option | How | Pros | Cons | Verdict |
|---|---|---|---|---|
| A. UI CSV export (current) | Performance report → Export | Easy | **1,000-row cap** per tab; each dimension separate; our sample captures only ~44% of query clicks | ✗ |
| B. **Search Analytics API** (`searchanalytics.query`) | Daily job per day & search type; `rowLimit` 25,000 with `startRow` paging | Free, multi-dimension rows, quick to build | Max ~50k rows/day/search type; anonymized queries missing; 2–3 day lag | ✅ **PoC** |
| C. **Bulk Data Export → BigQuery** | Search Console settings → BigQuery (daily) | All rows except anonymized queries; tables `searchdata_site_impression`, `searchdata_url_impression`, `ExportLog`; search-appearance flags | Starts from setup date (no backfill); BigQuery cost | ✅ **Target** |
| D. Looker Studio connector | Dashboard | Visual | Not an ingestion path | ✗ |

**Decision:** PoC = API (back-fill last 16 months once, then daily). Turn on Bulk Export now so history accumulates. Note GSC data is in **Pacific Time**.

### 4.2 PoC CSV layout — `gsc_perf_YYYYMMDD.csv`

| # | Column | Type | Required | Example | Notes |
|---|---|---|---|---|---|
| 1 | `data_date` | DATE | ✅ | 2026-09-15 | **PT** |
| 2 | `site_url` | STRING | ✅ | sc-domain:dospara.co.jp | |
| 3 | `search_type` | ENUM | ✅ | web / image / video / news / discover | |
| 4 | `page_url` | STRING | ✅ | https://www.dospara.co.jp/gamepc | |
| 5 | `query` | STRING | ○ | ゲーミングpc | NULL when anonymized |
| 6 | `is_anonymized_query` | BOOL | ✅ | false | |
| 7 | `country` | STRING (ISO-3166 alpha-3) | ✅ | jpn | API returns lowercase alpha-3 |
| 8 | `device` | ENUM | ✅ | MOBILE / DESKTOP / TABLET | |
| 9 | `search_appearance` | STRING | ○ | PRODUCT_SNIPPETS | Separate query (API can't combine with other dims freely) |
| 10 | `clicks` | INT | ✅ | 37502 | |
| 11 | `impressions` | INT | ✅ | 498533 | |
| 12 | `sum_position` | DECIMAL | ✅ | | `position × impressions` → allows correct re-aggregation |
| 13 | `ctr` | — | ✗ | | **Do not store**; derive = clicks / impressions |
| 14 | `data_state` | ENUM | ✅ | final / all | API `dataState` |
| 15 | `extracted_at` | TIMESTAMP | ✅ | | |

Why `sum_position`: averages can't be summed. Storing `position × impressions` lets LOGOS recompute the weighted average at any grain (this is how Bulk Export stores it too).

```csv
data_date,site_url,search_type,page_url,query,is_anonymized_query,country,device,search_appearance,clicks,impressions,sum_position,data_state,extracted_at
2026-09-15,sc-domain:dospara.co.jp,web,https://www.dospara.co.jp/gamepc,ゲーミングpc,false,jpn,MOBILE,,420,5210,16412.0,final,2026-09-25T06:00:00+09:00
```

**Mapping from current UI files:** `クエリ.csv` → `query`; `ページ.csv` → `page_url`; `デバイス.csv` → `device` (モバイル=MOBILE, PC=DESKTOP, タブレット=TABLET); `国.csv` → `country` (日本=jpn); `検索での見え方.csv` → `search_appearance` (商品スニペット=PRODUCT_SNIPPETS, 販売者のリスティング=merchant listings, レビュー スニペット=REVIEW_SNIPPET); `フィルタ.csv` → manifest.

---

## 5. ImportExternal — Crawl results

"Crawl results" covers three different jobs seen in the data. Keep them as separate datasets with one shared envelope.

| Sub-type | What | Current state | PoC method | Tool |
|---|---|---|---|---|
| 5a. Competitor observation | Order numbers (→ estimated orders), campaign / instalment offers, prices | RPA writes `注文履歴.xlsx` on `\\THN-186\share`; manual paste & fixes | RPA output as **CSV** (not xlsx) to landing folder; derivation (delta, reset, interpolation) done in pipeline, not by hand | Existing RPA, or Playwright / Scrapy |
| 5b. Page performance | LCP, INP, CLS, TTFB, etc. for own & competitor pages | Manual WebPageTest / PSI, few rows | Daily **PageSpeed Insights API v5** (lab) + **CrUX API** (field) | PSI API, CrUX API |
| 5c. Site SEO audit | Status code, indexability, title, canonical, structured data | Not in sample | Weekly **Screaming Frog CLI** (headless) export | Screaming Frog SEO Spider |

**Compliance:** respect robots.txt (RFC 9309) and each site's terms; low request rate; identify the bot; confirm with legal before collecting competitor data. Store only what is needed.

### 5.1 PoC CSV layout — `crawl_observation_YYYYMMDD.csv` (shared long format)

| # | Column | Type | Required | Example | Notes |
|---|---|---|---|---|---|
| 1 | `observed_at` | TIMESTAMP | ✅ | 2026-09-24T16:00:00+09:00 | Capture time |
| 2 | `observation_date` | DATE | ✅ | 2026-09-24 | JST business date |
| 3 | `crawl_job` | ENUM | ✅ | competitor_order / competitor_campaign / pagespeed / site_audit | |
| 4 | `target_company` | STRING | ✅ | mouse / pc_koubou / lenovo / hp / dell / asus / mdl / frontier / dospara | Master list |
| 5 | `target_url` | STRING | ✅ | https://… | |
| 6 | `metric` | STRING | ✅ | order_number / instalment_max_count / lcp_ms / http_status | Controlled vocabulary |
| 7 | `raw_value` | STRING | ✅ | G00100816 | As captured |
| 8 | `value_num` | DECIMAL | ○ | 100816 | Cleaned (e.g. Lenovo "G" stripped) |
| 9 | `derived_value` | DECIMAL | ○ | 479 | e.g. daily orders = delta vs previous |
| 10 | `is_estimated` | BOOL | ✅ | false | Replaces grey cells |
| 11 | `estimation_method` | ENUM | ○ | linear_interpolation_2day | |
| 12 | `counter_reset` | BOOL | ✅ | false | Dell 9999999 wrap |
| 13 | `capture_status` | ENUM | ✅ | ok / not_found / blocked / timeout | Failure ≠ 0 |
| 14 | `tool` | STRING | ✅ | rpa_v1 / psi_v5 / screamingfrog_22 | Lineage |
| 15 | `run_id` | STRING | ✅ | 20260924-1600-rpa | |

```csv
observed_at,observation_date,crawl_job,target_company,target_url,metric,raw_value,value_num,derived_value,is_estimated,estimation_method,counter_reset,capture_status,tool,run_id
2026-09-24T16:00:00+09:00,2026-09-24,competitor_order,mouse,https://…,order_number,00100816,100816,479,false,,false,ok,rpa_v1,20260924-1600-rpa
2026-09-24T09:00:00+09:00,2026-09-24,pagespeed,dospara,https://www.dospara.co.jp/,lcp_ms,2137,2137,,false,,false,ok,psi_v5,20260924-0900-psi
```

---

## 6. Common file contract (all PoC CSVs)

- **Encoding:** UTF-8 **without BOM**; comma delimiter; RFC 4180 quoting; LF line endings.
- **Header:** exactly one header row, snake_case English names; no comment lines, no totals rows, no merged/multi-row headers.
- **Dates:** ISO 8601 (`YYYY-MM-DD`, timestamps with offset). Record source time zone.
- **Nulls:** empty field = NULL. Never `ー`, `-`, `0`, or colours for "unknown".
- **Ratios:** don't store CVR / CTR / avg position / DAU-WAU; store numerator and denominator.
- **File name:** `<source>_<dataset>_<YYYYMMDD>[_<run>].csv`, one day per file, re-delivery overwrites.
- **Manifest** (`*.manifest.json` next to each file): `schema_version`, `source`, `date_range`, `filters`, `row_count`, `extracted_at`, `checksum_sha256`.
- **Quality checks at load:** row_count matches manifest; PK unique; totals reconcile (e.g. GSC Σclicks by device = Σclicks by date — true in our sample: 3,409,251); no future dates; enums valid → otherwise quarantine (D2 SRC-06).

**SourceBinding hints (D2 §18):** `mode: batch`; `freshness.expectedLatency` = PT6H (DB, GA4), P3D (GSC); `staleAfter` = P1D / P4D; `degradation.onMappingError: quarantine`; `unknownValueHandling: quarantine`.

---

## 7. Open questions / next steps

1. Confirm with IT who can schedule ISM #370 extract and where the landing folder lives (replace `\\THN-186\share` manual paste).
2. GA4: property type (standard vs 360) and daily event volume → decides daily vs streaming BigQuery export.
3. GSC: which property (domain vs URL-prefix); enable Bulk Export now.
4. Crawl: legal/ToS review for competitor observation; confirm RPA can emit CSV.
5. Create the `page_group` master (campaign name ↔ URL pattern ↔ period) to replace the weekly `セッション比較MMDD` sheets.
6. Hand the four layouts to TEBIS as data requirements (D1 Stage 3).

---

## 8. Resources

**GA4**
- [GA4 BigQuery Export – Analytics Help](https://support.google.com/analytics/answer/9358801?hl=en) — daily / streaming / fresh daily; 1M events/day for standard properties
- [GA4 BigQuery Export schema](https://support.google.com/analytics/answer/7029846?hl=en)
- [GA4 Data API – runReport](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport)
- [GA4 Data API – dimensions & metrics](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema)
- [GA4 Data API – quotas](https://developers.google.com/analytics/devguides/reporting/data/v1/quotas)
- [Managing quota for Google Analytics Data API (Google blog)](https://developers.google.com/analytics/blog/2023/data-api-quota-management?hl=en)
- [Bridging the gap between GA UI and BigQuery Export (Google blog)](https://developers.google.com/analytics/blog/2023/bigquery-vs-ui)

**Google Search Console**
- [About bulk data export to BigQuery – Search Console Help](https://support.google.com/webmasters/answer/12918484?hl=en)
- [Bulk export table guidelines (schemas)](https://support.google.com/webmasters/answer/12917991?hl=en)
- [Bulk data export announcement (Search Central blog)](https://developers.google.com/search/blog/2023/02/bulk-data-export)
- [Search Console API – Getting all your performance data](https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data)
- [Search Analytics: query method reference](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)
- [Performance data filtering and limits deep dive (Search Central blog)](https://developers.google.com/search/blog/2022/10/performance-data-deep-dive)

**Crawl / performance**
- [PageSpeed Insights API – Get started](https://developers.google.com/speed/docs/insights/v5/get-started)
- [PSI API – runPagespeed method](https://developers.google.com/speed/docs/insights/rest/v5/pagespeedapi/runpagespeed)
- [Measure Core Web Vitals with PSI API and CrUX API (codelab)](https://developers.google.com/codelabs/chrome-web-vitals-psi-crux)
- [Screaming Frog SEO Spider – user guide (command line / scheduling)](https://www.screamingfrog.co.uk/seo-spider/user-guide/general/)
- [RFC 9309 – Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309)

**Formats**
- [RFC 4180 – CSV format](https://www.rfc-editor.org/rfc/rfc4180)

**Internal (project docs)**
- `D0_LOGOS_Platform_Design_Brief.md` §2.2 — "LOGOS does not perform data ingestion"; TEBIS owns ingestion
- `D1_Domain_Ontology_Playbook.md` Stage 3 — Data Realization Check / TEBIS data requirements list
- `D2_Ontology_Modeling_Spec.md` §18 — SourceBinding fields (SRC-02, SRC-06, SRC-07, SRC-08)
