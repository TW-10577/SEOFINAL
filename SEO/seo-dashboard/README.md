# SEO Dashboard

React + Vite UI for the SEO page-performance workflow. All data comes from the SEO API in `../seo-api`
(the dev server proxies `/api` to `http://localhost:8787`).

## Run

Node 22 is required (the API's SQLite driver is built for it).

```bash
cd ../seo-api && npm install && npm run dev       # API on :8787
cd ../seo-dashboard && npm install && npm run dev # UI on http://localhost:5173
```

The header has an EN / 日本語 switch. UI text is in `src/i18n.tsx`; status labels come from the ontology.

## Tabs

| Tab | Workflow step | API |
|---|---|---|
| Dashboard | Week-over-week metrics, open anomalies, GSC weekly trend, thresholds, data warnings | `GET /api/dashboard`, `GET /api/ontology` |
| Upload data | Receive, validate and standardise CSV / TXT / Excel exports; soft delete and restore | `POST /api/datasets`, `GET /api/datasets`, `DELETE /api/datasets/:id`, `POST /api/datasets/:id/restore` |
| Anomalies | Review detected changes and their cause hypotheses | `GET /api/anomalies`, `PATCH /api/anomalies/:id`, `PATCH /api/causes/:id` |
| Countermeasures | Move suggested actions through their lifecycle | `GET /api/countermeasures`, `PATCH /api/countermeasures/:id` |
| Reports | Weekly monitoring report | `GET /api/reports/weekly` |

## Related folders

- `../seo-api` – backend (parsing, analysis, rules)
- `../database` – SQLite schema and `seo.db`
- `../yaml` (`objects`, `value-types`, `relations`, `functions`, `config`) – SEO ontology YAML, loaded and checked by the API at startup
- `../yaml/config/judgment-conditions.yaml` – judgment conditions and 横ばい bands
