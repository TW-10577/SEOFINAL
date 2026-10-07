import { type ReactNode, useMemo, useState } from 'react'
import { api } from '../api/client'
import AnomalyCard from '../components/AnomalyCard'
import ErrorNotice from '../components/ErrorNotice'
import { metricLabel } from '../format'
import { useI18n } from '../i18n'
import type { AnomalyStatus, ReviewStatus } from '../types'
import { useApi } from '../useApi'

export default function AnomaliesPage() {
  const { t, enumLabel, next, ontology } = useI18n()
  const { data, error, loading, reload } = useApi(api.anomalies)
  const [status, setStatus] = useState('')
  const [metric, setMetric] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  const statuses = ontology?.enums['logos.seo.value.anomaly-status']?.map((e) => e.value) ?? []
  const metrics = useMemo(() => [...new Set((data ?? []).map((a) => a.metricKey))], [data])
  const shown = (data ?? []).filter((a) => (!status || a.status === status) && (!metric || a.metricKey === metric))

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn()
      setActionError(null)
      reload()
    } catch (e) {
      setActionError((e as Error).message)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{t('an.eyebrow')}</div>
          <h1>{t('tab.anomalies')}</h1>
          <p className="lead">{t('an.lead')}</p>
        </div>
      </div>

      <div className="panel">
        <div className="toolbar">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('an.allStatuses')}</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {enumLabel('anomaly-status', s)}
              </option>
            ))}
          </select>
          <select value={metric} onChange={(e) => setMetric(e.target.value)}>
            <option value="">{t('an.allMetrics')}</option>
            {metrics.map((m) => (
              <option key={m} value={m}>
                {metricLabel(m, t)}
              </option>
            ))}
          </select>
        </div>

        <ErrorNotice message={error ?? actionError} />
        {loading && !data ? <p className="muted">{t('loading')}</p> : null}
        {data && shown.length === 0 ? <p className="empty">{data.length ? t('an.noMatch') : t('an.none')}</p> : null}

        <div className="stack">
          {shown.map((a) => (
            <AnomalyCard
              key={a.anomalyId}
              anomaly={a}
              actions={
                next('anomaly-status', a.status).length ? (
                  <div className="actions">
                    {next('anomaly-status', a.status).map((s) => (
                      <button key={s} className="btn small" onClick={() => void act(() => api.setAnomalyStatus(a.anomalyId, s as AnomalyStatus))}>
                        {t('an.moveTo', { status: enumLabel('anomaly-status', s) })}
                      </button>
                    ))}
                  </div>
                ) : null
              }
            >
              {a.cause ? (
                <div className="subpanel">
                  <div className="item-head">
                    <div className="item-title">
                      {t('an.cause')} <span className="mono muted">{a.cause.causeId}</span>
                    </div>
                    <span className={`badge ${a.cause.reviewStatus === 'Confirmed' ? 'good' : a.cause.reviewStatus === 'Rejected' ? 'bad' : 'warn'}`}>
                      {enumLabel('review-status', a.cause.reviewStatus)}
                    </span>
                  </div>
                  <dl className="facts">
                    <dt>{t('an.evidence')}</dt>
                    <dd>{a.cause.supportingEvidence}</dd>
                    <dt>{t('an.rule')}</dt>
                    <dd>
                      {a.cause.rule} {a.cause.ruleConfirmed ? null : <span className="badge warn plain">{t('unconfirmed')}</span>}
                    </dd>
                    <dt>{t('an.confidence')}</dt>
                    <dd className="muted">{a.cause.confidence ?? t('an.notAssessed')}</dd>
                    {a.countermeasures.map((c) => (
                      <FragmentRow key={c.countermeasureId} label={t('an.countermeasure')}>
                        {c.description} <span className="mono muted">{c.countermeasureId}</span>{' '}
                        <span className="badge">{enumLabel('countermeasure-status', c.status)}</span>
                      </FragmentRow>
                    ))}
                  </dl>
                  {next('review-status', a.cause.reviewStatus).length ? (
                    <div className="actions">
                      <span className="muted small" style={{ alignSelf: 'center' }}>
                        {t('an.review')}:
                      </span>
                      {next('review-status', a.cause.reviewStatus).map((s) => (
                        <button key={s} className="btn small" onClick={() => void act(() => api.setCauseReview(a.cause!.causeId, s as ReviewStatus))}>
                          {t('an.markReview', { status: enumLabel('review-status', s) })}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </AnomalyCard>
          ))}
        </div>
      </div>
    </>
  )
}

function FragmentRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
}
