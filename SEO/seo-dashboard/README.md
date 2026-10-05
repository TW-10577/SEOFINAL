# SEO Dashboard

React + Vite UI for the SEO page-performance workflow. All data comes from the SEO API in `../seo-api`
(the dev server proxies `/api` to `http://localhost:8787`).

## Run

Node 22 is required (the API's SQLite driver is built for it).

```bash
cd ../seo-api && npm install && npm run dev       # API on :8787
cd ../seo-dashboard && npm install && npm run dev # UI on http://localhost:5173
```

## Tabs

| Tab | Workflow step | API |
|---|---|---|
| Dashboard | Week-over-week metrics, open anomalies, GSC weekly trend, thresholds, data warnings | `GET /api/dashboard`, `GET /api/ontology` |
| Upload data | Receive, validate, standardise CSV exports | `POST /api/datasets`, `GET /api/datasets` |
| Anomalies | Review detected changes and set their status | `GET /api/anomalies`, `PATCH /api/anomalies/:id` |
| Countermeasures | Approve, reject and track suggested actions | `GET /api/countermeasures`, `PATCH /api/countermeasures/:id` |
| Reports | Weekly monitoring report | `GET /api/reports/weekly` |

## Related folders

- `../seo-api` – backend (parsing, analysis, rules)
- `../database` – SQLite schema and `seo.db`
- `../objects`, `../value-types`, `../relations`, `../functions` – SEO ontology YAML, loaded and checked by the API at startup
- `../config/thresholds.yaml` – week-over-week thresholds
