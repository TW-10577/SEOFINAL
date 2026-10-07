import { api } from '../api/client'
import { formatChange, formatPeriod, formatThreshold, formatValue, isWorse, metricLabel } from '../format'
import { useI18n } from '../i18n'
import { useApi } from '../useApi'
import ErrorNotice from './ErrorNotice'

// The measurement sheet (config/measurements.yaml) with the latest GA4 result and what has been uploaded per source.
export default function MeasurementsOverview() {
  const { t } = useI18n()
  const { data, error } = useApi(api.measurements)
  if (error) return <ErrorNotice message={error} />
  if (!data) return null

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h2>{t('ms.measurements')}</h2>
          <span className="muted small">{t('ms.measurementsHint')}</span>
        </div>
        <div className="grid-two">
          {data.measurements.map((m) => {
            const l = m.latest
            return (
              <div className="subpanel" key={m.measurementId}>
                <div className="item-head">
                  <div className="item-title">
                    {m.number} {m.name}
                  </div>
                  {m.openAnomalies ? <span className="badge warn">{t('ms.openAnomalies', { n: m.openAnomalies })}</span> : null}
                </div>
                <dl className="facts">
                  <dt>{t('ms.condition')}</dt>
                  <dd>
                    <span className="mono">{m.conditionId}</span>{' '}
                    {m.condition ? formatThreshold(m.condition.unit, m.condition.threshold, t) : '—'}{' '}
                    {m.condition && !m.condition.confirmed ? <span className="badge warn plain">{t('unconfirmed')}</span> : null}
                  </dd>
                  {m.branches.map((b) => (
                    <BranchRow key={b.when} when={b.when} then={b.then} />
                  ))}
                  <dt>{t('ms.primary')}</dt>
                  <dd>{m.primarySource}</dd>
                  <dt>{t('ms.supportedBy')}</dt>
                  <dd>{m.supportedBy}</dd>
                  <dt>{t('ms.latest')}</dt>
                  <dd>
                    {l ? (
                      <>
                        {metricLabel(l.metricKey, t)} {formatValue(l.kind, l.metricKey, l.previous)} → {formatValue(l.kind, l.metricKey, l.current)}{' '}
                        <span className={`change ${isWorse(l.kind, l.absoluteChange) ? 'bad' : 'good'}`}>
                          {formatChange(l.kind, l.absoluteChange, l.changePercentage, t)}
                        </span>{' '}
                        {l.significant ? <span className="badge warn">{t('cmp.significant')}</span> : null}
                        <div className="muted small">
                          {formatPeriod(l.previousPeriod)} → {formatPeriod(l.currentPeriod)} · {m.latestFile}
                        </div>
                      </>
                    ) : (
                      <span className="muted">{t('ms.noLatest')}</span>
                    )}
                  </dd>
                </dl>
              </div>
            )
          })}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{t('ms.sources')}</h2>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('ms.no')}</th>
                <th>{t('ms.file')}</th>
                <th>{t('ms.source')}</th>
                <th>{t('ms.memo')}</th>
                <th>{t('ms.import')}</th>
                <th>{t('ms.sampleRange')}</th>
                <th>{t('ms.dummyRange')}</th>
                <th>{t('ms.m1')}</th>
                <th>{t('ms.m2')}</th>
                <th>{t('ms.uploaded')}</th>
              </tr>
            </thead>
            <tbody>
              {data.dataSources.map((s) => (
                <tr key={s.no}>
                  <td>{s.no}</td>
                  <td>{s.files}</td>
                  <td>{s.source}</td>
                  <td className="small">
                    {s.memo1}
                    <div className="muted">{s.memo2}</div>
                  </td>
                  <td>{s.import}</td>
                  <td className="small">{s.sampleDateRange}</td>
                  <td className="small">{s.dummyDateRange}</td>
                  <td className="small">{s.measurement1}</td>
                  <td className="small muted">{s.measurement2}</td>
                  <td className="small">
                    {s.uploads.length ? (
                      s.uploads.map((u) => (
                        <div key={u.datasetId}>
                          <span className="badge good">{u.datasetId}</span> {u.fileName}
                          <div className="muted">{formatPeriod(u.period)}</div>
                        </div>
                      ))
                    ) : (
                      <span className="badge warn">{t('ms.notUploaded')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function BranchRow({ when, then }: { when: string; then: string }) {
  return (
    <>
      <dt>{when}</dt>
      <dd>→ {then}</dd>
    </>
  )
}
