import AnomalyCard from '../components/AnomalyCard'
import ComparisonTable from '../components/ComparisonTable'
import { api } from '../api/client'
import { formatPeriod, formatThreshold, formatValue, SOURCE_LABELS } from '../format'
import { useApi } from '../useApi'

const TREND_METRICS = [
  { key: 'clicks', label: 'Clicks', kind: 'relative' as const },
  { key: 'impressions', label: 'Impressions', kind: 'relative' as const },
  { key: 'ctr', label: 'CTR', kind: 'points' as const },
  { key: 'position', label: 'Avg position', kind: 'rank' as const },
]

export default function Dashboard({ onUpload }: { onUpload: () => void }) {
  const { data, error, loading } = useApi(api.dashboard)
  const ontology = useApi(api.ontology)

  if (error) return <div className="notice error">{error}</div>
  if (loading || !data) return <p className="muted">Loading…</p>

  const { stats } = data
  if (stats.datasets === 0) {
    return (
      <>
        <Head />
        <div className="panel empty">
          <p>No data uploaded yet.</p>
          <p className="small">Upload a GSC daily export (平均読み込み時間のチャート.csv) or a GA4 daily export to start.</p>
          <button className="btn primary" onClick={onUpload} style={{ marginTop: 12 }}>
            Upload data
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <Head />
      <div className="stack">
        <div className="metric-grid">
          <Metric value={stats.datasets} label="Datasets" />
          <Metric value={stats.openAnomalies} label="Open anomalies" />
          <Metric value={stats.totalAnomalies} label="Anomalies detected" />
          <Metric value={stats.proposedCountermeasures} label="Awaiting decision" />
          <Metric value={stats.approvedCountermeasures} label="Approved actions" />
        </div>

        {data.latest.map((l) => (
          <div className="panel" key={l.datasetId}>
            <div className="panel-head">
              <h2>{SOURCE_LABELS[l.source]}: latest week vs previous week</h2>
              <span className="muted small">{l.fileName}</span>
            </div>
            {l.comparisons.length ? (
              <>
                <p className="muted small" style={{ marginBottom: 8 }}>
                  {formatPeriod(l.comparisons[0].previousPeriod)} → {formatPeriod(l.comparisons[0].currentPeriod)}
                </p>
                <ComparisonTable comparisons={l.comparisons} />
              </>
            ) : (
              <p className="muted small">Not enough days in this file for a week-over-week comparison.</p>
            )}
          </div>
        ))}

        <div className="grid-two">
          <div className="panel">
            <div className="panel-head">
              <h2>Open anomalies</h2>
            </div>
            {data.openAnomalies.length ? (
              <div className="stack">
                {data.openAnomalies.map((a) => (
                  <AnomalyCard key={a.anomalyId} anomaly={a} />
                ))}
              </div>
            ) : (
              <p className="muted">No open anomalies: no metric crossed its threshold in the latest week.</p>
            )}
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>Weekly trend (GSC)</h2>
            </div>
            {data.weeklyTrend.length ? (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Week</th>
                      {TREND_METRICS.map((m) => (
                        <th key={m.key} className="num">
                          {m.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.weeklyTrend.map((w) => (
                      <tr key={w.period.end}>
                        <td className="muted">{w.period.start.slice(5)} 〜 {w.period.end.slice(5)}</td>
                        {TREND_METRICS.map((m) => (
                          <td key={m.key} className="num">
                            {w.values[m.key] === undefined ? '—' : formatValue(m.kind, m.key, w.values[m.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">Upload a GSC daily export to see weekly trends.</p>
            )}
          </div>
        </div>

        {ontology.data ? (
          <div className="panel">
            <div className="panel-head">
              <h2>Thresholds</h2>
              <span className="muted small">config/thresholds.yaml · validated against the SEO ontology</span>
            </div>
            <table className="data">
              <tbody>
                {Object.entries(ontology.data.thresholds).map(([metric, t]) => (
                  <tr key={metric}>
                    <td>{metric}</td>
                    <td className="num">{formatThreshold(t.kind, t.value)}</td>
                    <td>{t.confirmed ? <span className="badge good">confirmed</span> : <span className="badge warn">unconfirmed</span>}</td>
                    <td className="muted">{t.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {data.warnings.length ? (
          <div className="panel">
            <div className="panel-head">
              <h2>Data quality warnings</h2>
            </div>
            <table className="data">
              <tbody>
                {data.warnings.map((w, i) => (
                  <tr key={i}>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                      {w.fileName}
                    </td>
                    <td>{w.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </>
  )
}

function Head() {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">SEO page performance</div>
        <h1>Dashboard</h1>
      </div>
    </div>
  )
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}
