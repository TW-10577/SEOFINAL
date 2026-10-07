import type { ReactNode } from 'react'
import { api } from '../api/client'
import ComparisonTable from '../components/ComparisonTable'
import ErrorNotice from '../components/ErrorNotice'
import { formatChange, formatPeriod, metricLabel, scopeLabel, sourceLabel } from '../format'
import { useI18n } from '../i18n'
import { useApi } from '../useApi'

export default function ReportsPage() {
  const { t, enumLabel, lang } = useI18n()
  const { data: r, error, loading, reload } = useApi(api.weeklyReport)

  function generateTxtReport() {
    if (!r) return
    const lines: string[] = []
    lines.push('LOGOS Weekly Measurement Report')
    lines.push('')
    lines.push('Period: ' + (r.dataSources[0]?.period ? `${r.dataSources[0].period.start} to ${r.dataSources[0].period.end}` : 'Unknown'))
    lines.push('')
    lines.push('Summary')
    lines.push(`Total measurements: ${r.summary.length}`)
    lines.push(`Anomalies: ${r.anomalies.length}`)
    lines.push(`Countermeasures: ${r.countermeasures.length}`)
    lines.push('')

    if (r.anomalies.length > 0) {
      lines.push('Detected Anomalies')
      lines.push('')
      r.anomalies.forEach((a, i) => {
        lines.push(`${i + 1}. ${enumLabel('anomaly-status', a.status)}`)
        lines.push(`   Metric: ${a.metricKey}`)
        if (a.cause) {
          lines.push(`   Cause: ${a.cause.hypothesis}`)
          lines.push(`   Rule: ${a.cause.rule}`)
        }
        lines.push('')
      })
    }

    lines.push('Conclusion')
    lines.push(`${r.anomalies.length} significant changes were detected.`)
    if (r.openItems.length > 0) {
      lines.push(`${r.openItems.length} items require ongoing monitoring.`)
    }

    const text = lines.join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `LOGOS-Report-${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{t('rep.eyebrow')}</div>
          <h1>{t('rep.title')}</h1>
          {r ? <p className="lead">{t('rep.generated', { time: new Date(r.generatedAt).toLocaleString(lang === 'ja' ? 'ja-JP' : 'en-GB') })}</p> : null}
        </div>
        <div className="actions">
          <button className="btn" onClick={reload}>
            {t('rep.regenerate')}
          </button>
          <button className="btn" onClick={generateTxtReport} disabled={!r}>
            {t('rep.generateTxt')}
          </button>
          <button className="btn primary" onClick={() => window.print()} disabled={!r}>
            {t('rep.print')}
          </button>
        </div>
      </div>

      <ErrorNotice message={error} />
      {loading && !r ? <p className="muted">{t('loading')}</p> : null}
      {r && r.dataSources.length === 0 ? <div className="panel empty">{t('rep.empty')}</div> : null}

      {r && r.dataSources.length ? (
        <div className="stack">
          <Section title={t('rep.s1')}>
            <table className="data">
              <tbody>
                {r.dataSources.map((d) => (
                  <tr key={d.datasetId}>
                    <td>{d.fileName}</td>
                    <td className="muted">{sourceLabel(d.source, t)}</td>
                    <td className="muted">{formatPeriod(d.period)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title={t('rep.s2')}>
            {r.summary.length ? (
              r.summary.map((s) =>
                s.comparisons.length ? (
                  <div key={s.datasetId} style={{ marginBottom: 12 }}>
                    <p className="muted small">
                      {sourceLabel(s.source, t)} · {s.fileName}
                    </p>
                    <ComparisonTable comparisons={s.comparisons} />
                  </div>
                ) : (
                  <p key={s.datasetId} className="muted small">
                    {t('rep.notEnough', { file: s.fileName })}
                  </p>
                ),
              )
            ) : (
              <p className="muted">{t('rep.noDaily')}</p>
            )}
          </Section>

          <Section title={t('rep.s3')}>
            {r.anomalies.length ? (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('rep.id')}</th>
                      <th>{t('cmp.metric')}</th>
                      <th className="num">{t('cmp.change')}</th>
                      <th>{t('rep.hypothesis')}</th>
                      <th>{t('rep.reviewStatus')}</th>
                      <th>{t('rep.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.anomalies.map((a) => (
                      <tr key={a.anomalyId}>
                        <td className="mono">{a.anomalyId}</td>
                        <td>
                          {metricLabel(a.metricKey, t)} <span className="muted">· {scopeLabel(a.scope, t)}</span>
                        </td>
                        <td className="num">{formatChange(a.kind, a.absoluteChange, a.changePercentage, t)}</td>
                        <td>{a.cause?.hypothesis ?? '—'}</td>
                        <td>{a.cause ? enumLabel('review-status', a.cause.reviewStatus) : '—'}</td>
                        <td>{enumLabel('anomaly-status', a.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">{t('rep.noAnomalies')}</p>
            )}
          </Section>

          <Section title={t('rep.s4')}>
            {r.countermeasures.length ? (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('rep.id')}</th>
                      <th>{t('rep.action')}</th>
                      <th>{t('rep.owner')}</th>
                      <th>{t('rep.priority')}</th>
                      <th>{t('rep.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.countermeasures.map((c) => (
                      <tr key={c.countermeasureId}>
                        <td className="mono">{c.countermeasureId}</td>
                        <td>{c.description}</td>
                        <td>{c.ownerTeam}</td>
                        <td>{enumLabel('priority-level', c.priority)}</td>
                        <td>{enumLabel('countermeasure-status', c.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">{t('rep.noCountermeasures')}</p>
            )}
          </Section>

          <Section title={t('rep.s5')}>
            {r.openItems.length ? (
              <ul>
                {r.openItems.map((a) => (
                  <li key={a.anomalyId}>
                    {a.anomalyId}: {metricLabel(a.metricKey, t)} ({scopeLabel(a.scope, t)}), {enumLabel('anomaly-status', a.status)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">{t('rep.noOpen')}</p>
            )}
          </Section>

          <Section title={t('rep.s6')}>
            {r.warnings.length ? (
              <ul>
                {r.warnings.map((w, i) => (
                  <li key={i}>
                    <span className="muted">{w.fileName}:</span> {w.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">{t('rep.none')}</p>
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
