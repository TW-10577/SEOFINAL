import { useState } from 'react'
import { api } from '../api/client'
import ErrorNotice from '../components/ErrorNotice'
import MeasurementsOverview from '../components/MeasurementsOverview'
import { formatChange, formatThreshold, formatValue, isWorse } from '../format'
import { useI18n } from '../i18n'
import { useApi } from '../useApi'

export default function MeasurementsPage() {
  const { t } = useI18n()
  const { data, error, loading } = useApi(api.measurements)
  const [showDetail, setShowDetail] = useState<string | null>(null)

  if (error) return <ErrorNotice message={error} />
  if (loading || !data) return <p className="muted">{t('loading')}</p>

  const { measurements } = data
  const okCount = measurements.filter((m) => m.latest && !isWorse(m.latest.kind, m.latest.absoluteChange)).length
  const ngCount = measurements.filter((m) => m.latest && isWorse(m.latest.kind, m.latest.absoluteChange)).length

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{t('meas.eyebrow')}</div>
          <h1>{t('tab.measurements')}</h1>
          <p className="lead">{t('meas.lead')}</p>
        </div>
      </div>

      <div className="stack">
        <div className="panel">
          <div className="panel-head">
            <h2>{t('meas.summary')}</h2>
          </div>
          <div className="metric-grid">
            <Metric value={measurements.length} label={t('meas.totalMeasurements')} />
            <Metric value={okCount} label={t('meas.okCount')} />
            <Metric value={ngCount} label={t('meas.ngCount')} />
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>{t('meas.results')}</h2>
            <span className="muted small">{t('meas.resultsHint')}</span>
          </div>
          {measurements.length === 0 ? (
            <p className="empty">{t('meas.noMeasurements')}</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('meas.col.measurement')}</th>
                    <th className="num">{t('meas.col.result')}</th>
                    <th className="num">{t('meas.col.status')}</th>
                    <th>{t('meas.col.reason')}</th>
                    <th>{t('meas.col.rule')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {measurements.map((m) => {
                    const l = m.latest
                    const isOk = !l || !isWorse(l.kind, l.absoluteChange)
                    return (
                      <tr key={m.measurementId}>
                        <td>
                          <strong>{m.number}</strong> {m.name}
                        </td>
                        <td className="num">
                          {l ? (
                            <>
                              {formatValue(l.kind, l.metricKey, l.previous)} → {formatValue(l.kind, l.metricKey, l.current)}
                              <br />
                              <span className={`change ${isOk ? 'good' : 'bad'}`}>{formatChange(l.kind, l.absoluteChange, l.changePercentage, t)}</span>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="num">
                          <span className={`badge ${isOk ? 'good' : 'bad'}`}>{isOk ? 'OK' : 'NG'}</span>
                        </td>
                        <td className="muted small">
                          {l ? (
                            isOk ? (
                              <>{t('meas.reason.withinThreshold')}</>
                            ) : (
                              <>{t('meas.reason.exceededThreshold')}</>
                            )
                          ) : (
                            t('meas.noData')
                          )}
                        </td>
                        <td className="mono small">{m.conditionId}</td>
                        <td>
                          <button className="btn small" onClick={() => setShowDetail(m.measurementId)}>
                            {t('meas.detail')}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <MeasurementsOverview />
      </div>

      {showDetail && (
        <DetailPanel
          measurement={measurements.find((m) => m.measurementId === showDetail)}
          onClose={() => setShowDetail(null)}
        />
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

function DetailPanel({ measurement, onClose }: { measurement: any; onClose: () => void }) {
  const { t } = useI18n()

  if (!measurement) return null

  const l = measurement.latest
  const isOk = !l || !isWorse(l.kind, l.absoluteChange)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>
              {measurement.number} {measurement.name}
            </h2>
          </div>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        {l ? (
          <div className="modal-body">
            <div className="subpanel">
              <div className="item-head">
                <div className="item-title">{t('meas.detail.measurement')}</div>
                <span className={`badge ${isOk ? 'good' : 'bad'}`}>{isOk ? 'OK' : 'NG'}</span>
              </div>
              <dl className="facts">
                <dt>{t('meas.detail.result')}</dt>
                <dd>
                  <strong className={isOk ? 'change good' : 'change bad'}>
                    {formatChange(l.kind, l.absoluteChange, l.changePercentage, t)}
                  </strong>
                </dd>
                <dt>{t('meas.detail.status')}</dt>
                <dd>{isOk ? t('meas.ok') : t('meas.ng')}</dd>
                <dt>{t('meas.detail.reason')}</dt>
                <dd>{isOk ? t('meas.reason.withinThreshold') : t('meas.reason.exceededThreshold')}</dd>
                <dt>{t('meas.detail.rule')}</dt>
                <dd>
                  <span className="mono">{measurement.conditionId}</span>
                  <div className="muted small">{measurement.condition?.source}</div>
                </dd>
                <dt>{t('meas.detail.threshold')}</dt>
                <dd>
                  {measurement.condition
                    ? formatThreshold(measurement.condition.unit, measurement.condition.threshold, t)
                    : '—'}
                </dd>
                <dt>{t('meas.detail.previous')}</dt>
                <dd>{formatValue(l.kind, l.metricKey, l.previous)}</dd>
                <dt>{t('meas.detail.current')}</dt>
                <dd>{formatValue(l.kind, l.metricKey, l.current)}</dd>
                <dt>{t('meas.detail.change')}</dt>
                <dd>{formatChange(l.kind, l.absoluteChange, l.changePercentage, t)}</dd>
              </dl>
            </div>
          </div>
        ) : (
          <div className="modal-body">
            <p className="muted">{t('meas.noData')}</p>
          </div>
        )}

        <div className="modal-foot">
          <button className="btn primary" onClick={onClose}>
            {t('meas.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
