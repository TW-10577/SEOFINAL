# Synthetic sample data

**Everything in `synthetic/` is invented.** It exists so the full workflow (detect → anomaly → cause →
countermeasure → weekly report) can be built and demonstrated before the business side supplies
two-period exports. Do not use it for business decisions or mix it into the real database.

The levels are based on the real dospara exports (`../ページ.csv`, `../クエリ.csv`, the GSC date chart,
`../download (43).csv`); the daily values, the query long tail and every scenario below are made up.

## Files

| File | Fills gap | Usable by the API today |
|---|---|---|
| `SYNTHETIC_gsc_date_chart_*.csv` | Two periods at site level | Yes |
| `SYNTHETIC_ga4_daily_*.csv` | Two periods of GA4 (the real file has 6 days) | Yes |
| `SYNTHETIC_download (43)_2weeks_20260902-20260915.csv` | The real `download (43).csv` (09-10〜15, unchanged) with 8 invented days before it (09-02〜09) so it covers 14 days. The invented days copy the real week's level, weekday pattern and channel mix with no trend | Yes |
| `SYNTHETIC_gsc_pages_daily_*.csv` | Date column alongside page | No: page-level analysis not built yet |
| `SYNTHETIC_gsc_queries_daily_*.csv` | Date column alongside query, plus 1,500 invented long-tail queries below the real top-1000 cut-off | No: query-level analysis not built yet |

## Scenarios (week 09-23〜29 vs week 09-16〜22)

| Scenario | Where | Expected result |
|---|---|---|
| CTR falls ~12% on every page while position holds (e.g. a SERP layout change) | GSC site, pages | Clicks −16% and CTR −0.86 pt anomalies; countermeasure: review titles and snippets |
| Organic sessions −11%, paid +1%, direct −1% | GA4 | Sessions −5.1% anomaly (crosses ±3.9%); rule ① sends it to the SEO team |
| Conversion rate dips ~4.5% (0.95% → 0.91%) | GA4 | **Not flagged**: the CVR threshold is ±0.7 pt, which a ~0.95% CVR can never reach. Needs the SEO team's decision |
| `/gamepc` loses ~1.9 positions | GSC pages | For future page-level analysis |
| `/5shopping/shp_vga_def_parts.html` disappears from 09-25 | GSC pages | For future page-level analysis ("drops out" case) |
| `ゲーミングpc` loses ~2.3 positions | GSC queries | For future query-level analysis |
| `vspo pc` (near the top-1000 cut-off) disappears in week 2 | GSC queries | Shows the false "−100%" risk from the gap report |

## Use

Synthetic data has its own database, `../database/seo-synthetic.db`, already loaded with the two usable files.

```bash
cd ../seo-api && npm run dev:synthetic   # instead of npm run dev
```

Regenerate (deterministic, same seed → same files): `python3 generate_synthetic.py`
