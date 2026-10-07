import { api } from '../api/client'
import ComparisonTable from '../components/ComparisonTable'
import ErrorNotice from '../components/ErrorNotice'
import { formatPeriod, metricLabel, sourceLabel } from '../format'
import { useI18n } from '../i18n'
import { useApi } from '../useApi'

export default function DataPage() {
  const { t } = useI18n()
  const { data, error, loading } = useApi(api.dashboard)

  if (error) return <ErrorNotice message={error} />
  if (loading || !data) return <p className="muted">{t('loading')}</p>

  const { stats } = data

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{t('data.eyebrow')}</div>
          <h1>{t('tab.data')}</h1>
          <p className="lead">{t('data.lead')}</p>
        </div>
      </div>

      {stats.datasets === 0 ? (
        <div className="panel empty">
          <p>{t('dash.empty')}</p>
          <p className="small">{t('dash.emptyHint')}</p>
        </div>
      ) : (
        <div className="stack">
          <div className="metric-grid">
            <Metric value={stats.datasets} label={t('data.datasetsUploaded')} />
            <Metric value={stats.datasets > 0 ? data.latest.length : 0} label={t('data.dailyDatasets')} />
          </div>

          {data.latest.map((l) => (
            <div className="panel" key={l.datasetId}>
              <div className="panel-head">
                <h2>{l.fileName}</h2>
                <span className="muted small">{sourceLabel(l.source, t)}</span>
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

          {data.weeklyTrend.length ? (
            <div className="panel">
              <div className="panel-head">
                <h2>{t('data.weeklyTrend')}</h2>
              </div>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('dash.week')}</th>
                      <th className="num">{metricLabel('clicks', t)}</th>
                      <th className="num">{metricLabel('impressions', t)}</th>
                      <th className="num">{metricLabel('ctr', t)}</th>
                      <th className="num">{metricLabel('position', t)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.weeklyTrend.map((w) => (
                      <tr key={w.period.end}>
                        <td className="muted">
                          {w.period.start.slice(5)} 〜 {w.period.end.slice(5)}
                        </td>
                        <td className="num">{w.values.clicks !== undefined ? Math.round(w.values.clicks).toLocaleString('en-US') : '—'}</td>
                        <td className="num">{w.values.impressions !== undefined ? Math.round(w.values.impressions).toLocaleString('en-US') : '—'}</td>
                        <td className="num">{w.values.ctr !== undefined ? w.values.ctr.toFixed(2) + '%' : '—'}</td>
                        <td className="num">{w.values.position !== undefined ? w.values.position.toFixed(1) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </>
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
