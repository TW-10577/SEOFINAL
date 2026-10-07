import { api } from '../api/client'
import AnomalyCard from '../components/AnomalyCard'
import ComparisonTable from '../components/ComparisonTable'
import ErrorNotice from '../components/ErrorNotice'
import { formatPeriod, formatThreshold, formatValue, metricLabel, sourceLabel } from '../format'
import { useI18n } from '../i18n'
import { useApi } from '../useApi'

const TREND_METRICS = [
  { key: 'clicks', kind: 'relative' as const },
  { key: 'impressions', kind: 'relative' as const },
  { key: 'ctr', kind: 'points' as const },
  { key: 'position', kind: 'rank' as const },
]

export default function Dashboard({ onUpload }: { onUpload: () => void }) {
  const { t, enumLabel, ontology } = useI18n()
  const { data, error, loading } = useApi(api.dashboard)

  if (error) return <ErrorNotice message={error} />
  if (loading || !data) return <p className="muted">{t('loading')}</p>

  const { stats } = data
  if (stats.datasets === 0) {
    return (
      <>
        <Head />
        <div className="panel empty">
          <p>{t('dash.empty')}</p>
          <p className="small">{t('dash.emptyHint')}</p>
          <button className="btn primary" onClick={onUpload} style={{ marginTop: 12 }}>
            {t('tab.upload')}
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
          <Metric value={stats.datasets} label={t('dash.datasets')} />
          <Metric value={stats.openAnomalies} label={t('dash.openAnomalies')} />
          <Metric value={stats.totalAnomalies} label={t('dash.totalAnomalies')} />
          <Metric value={stats.causesToReview} label={t('dash.causesToReview')} />
          <Metric value={stats.proposedCountermeasures} label={t('dash.proposed')} />
          <Metric value={stats.activeCountermeasures} label={t('dash.active')} />
        </div>

        {data.latest.map((l) => (
          <div className="panel" key={l.datasetId}>
            <div className="panel-head">
              <h2>{t('dash.latestVsPrevious', { source: sourceLabel(l.source, t) })}</h2>
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
              <p className="muted small">{t('dash.notEnoughDays')}</p>
            )}
          </div>
        ))}

        <div className="grid-two">
          <div className="panel">
            <div className="panel-head">
              <h2>{t('dash.openAnomalies')}</h2>
            </div>
            {data.openAnomalies.length ? (
              <div className="stack">
                {data.openAnomalies.map((a) => (
                  <AnomalyCard key={a.anomalyId} anomaly={a} />
                ))}
              </div>
            ) : (
              <p className="muted">{t('dash.noOpen')}</p>
            )}
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>{t('dash.trend')}</h2>
            </div>
            {data.weeklyTrend.length ? (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('dash.week')}</th>
                      {TREND_METRICS.map((m) => (
                        <th key={m.key} className="num">
                          {metricLabel(m.key, t)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.weeklyTrend.map((w) => (
                      <tr key={w.period.end}>
                        <td className="muted">
                          {w.period.start.slice(5)} 〜 {w.period.end.slice(5)}
                        </td>
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
              <p className="muted">{t('dash.trendEmpty')}</p>
            )}
          </div>
        </div>

        {ontology ? (
          <div className="panel">
            <div className="panel-head">
              <h2>{t('dash.conditions')}</h2>
              <span className="muted small">{t('dash.conditionsSource')}</span>
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('cond.id')}</th>
                    <th>{t('cond.name')}</th>
                    <th>{t('cond.direction')}</th>
                    <th className="num">{t('cond.threshold')}</th>
                    <th>{t('cond.type')}</th>
                    <th>{t('cond.status')}</th>
                    <th>{t('cond.source')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ontology.conditions.map((c) => (
                    <tr key={c.conditionId}>
                      <td className="mono">{c.conditionId}</td>
                      <td>{c.name}</td>
                      <td>{enumLabel('direction', c.direction)}</td>
                      <td className="num">{formatThreshold(c.unit, c.threshold, t)}</td>
                      <td>{enumLabel('condition-type', c.conditionType)}</td>
                      <td>{c.confirmed ? <span className="badge good">{t('confirmed')}</span> : <span className="badge warn">{t('unconfirmed')}</span>}</td>
                      <td className="muted small">{c.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small" style={{ marginTop: 12 }}>
              {t('dash.flatBands')}:{' '}
              {Object.entries(ontology.flatBands)
                .map(([k, b]) => `${metricLabel(k, t)} ${formatThreshold(b.unit, b.value, t)}${b.confirmed ? '' : ` (${t('unconfirmed')})`}`)
                .join(' · ')}
            </p>
          </div>
        ) : null}

        {data.warnings.length ? (
          <div className="panel">
            <div className="panel-head">
              <h2>{t('dash.warnings')}</h2>
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
  const { t } = useI18n()
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">{t('dash.eyebrow')}</div>
        <h1>{t('tab.dashboard')}</h1>
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
