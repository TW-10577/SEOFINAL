import type { ReactNode } from 'react'
import { api } from '../api/client'
import ComparisonTable from '../components/ComparisonTable'
import { formatChange, formatPeriod, SOURCE_LABELS, statusLabel } from '../format'
import { useApi } from '../useApi'

export default function ReportsPage() {
  const { data: r, error, loading, reload } = useApi(api.weeklyReport)

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Step 9 · Weekly monitoring</div>
          <h1>Weekly report</h1>
          {r ? <p className="lead">Generated {new Date(r.generatedAt).toLocaleString()}</p> : null}
        </div>
        <div className="actions">
          <button className="btn" onClick={reload}>
            Regenerate
          </button>
          <button className="btn primary" onClick={() => window.print()} disabled={!r}>
            Print / PDF
          </button>
        </div>
      </div>

      {error ? <div className="notice error">{error}</div> : null}
      {loading && !r ? <p className="muted">Loading…</p> : null}
      {r && r.dataSources.length === 0 ? <div className="panel empty">Upload data to generate a report.</div> : null}

      {r && r.dataSources.length ? (
        <div className="stack">
          <Section title="1. Data sources and analysis period">
            <table className="data">
              <tbody>
                {r.dataSources.map((d) => (
                  <tr key={d.datasetId}>
                    <td>{d.fileName}</td>
                    <td className="muted">{SOURCE_LABELS[d.source]}</td>
                    <td className="muted">{formatPeriod(d.period)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="2. Metric changes (latest week vs previous week)">
            {r.summary.length ? (
              r.summary.map((s) =>
                s.comparisons.length ? (
                  <div key={s.datasetId} style={{ marginBottom: 12 }}>
                    <p className="muted small">
                      {SOURCE_LABELS[s.source]} · {s.fileName}
                    </p>
                    <ComparisonTable comparisons={s.comparisons} />
                  </div>
                ) : (
                  <p key={s.datasetId} className="muted small">
                    {s.fileName}: not enough days for a week-over-week comparison.
                  </p>
                ),
              )
            ) : (
              <p className="muted">No daily data uploaded.</p>
            )}
          </Section>

          <Section title="3. Significant anomalies and possible causes">
            {r.anomalies.length ? (
              <table className="data">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Metric</th>
                    <th className="num">Change</th>
                    <th>Possible cause (system suggestion)</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {r.anomalies.map((a) => (
                    <tr key={a.anomalyId}>
                      <td className="mono">{a.anomalyId}</td>
                      <td>
                        {a.metricName} <span className="muted">· {a.scope}</span>
                      </td>
                      <td className="num">{formatChange(a.kind, a.absoluteChange, a.changePercentage)}</td>
                      <td>{a.possibleCause}</td>
                      <td>{statusLabel(a.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">No metric crossed its threshold.</p>
            )}
          </Section>

          <Section title="4. Countermeasures and SEO team decisions">
            {r.countermeasures.length ? (
              <table className="data">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Action</th>
                    <th>Owner</th>
                    <th>Priority</th>
                    <th>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {r.countermeasures.map((c) => (
                    <tr key={c.countermeasureId}>
                      <td className="mono">{c.countermeasureId}</td>
                      <td>{c.description}</td>
                      <td>{c.ownerTeam}</td>
                      <td>{c.priority}</td>
                      <td>{c.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">No countermeasures proposed.</p>
            )}
          </Section>

          <Section title="5. Open monitoring items">
            {r.openItems.length ? (
              <ul>
                {r.openItems.map((a) => (
                  <li key={a.anomalyId}>
                    {a.anomalyId}: {a.metricName} ({a.scope}), {statusLabel(a.status)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No open items.</p>
            )}
          </Section>

          <Section title="6. Data quality warnings">
            {r.warnings.length ? (
              <ul>
                {r.warnings.map((w, i) => (
                  <li key={i}>
                    <span className="muted">{w.fileName}:</span> {w.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">None.</p>
            )}
          </Section>
        </div>
      ) : null}
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      {children}
    </div>
  )
}
