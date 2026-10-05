import { useMemo, useState } from 'react'
import { api } from '../api/client'
import AnomalyCard from '../components/AnomalyCard'
import { SOURCE_LABELS, statusLabel } from '../format'
import type { AnomalyStatus } from '../types'
import { useApi } from '../useApi'

const STATUSES: AnomalyStatus[] = ['Detected', 'UnderReview', 'Confirmed', 'Resolved']

export default function AnomaliesPage() {
  const { data, error, loading, reload } = useApi(api.anomalies)
  const [status, setStatus] = useState('')
  const [metric, setMetric] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  const metrics = useMemo(() => [...new Set((data ?? []).map((a) => a.metricName))], [data])
  const shown = (data ?? []).filter((a) => (!status || a.status === status) && (!metric || a.metricName === metric))

  async function move(id: string, next: AnomalyStatus) {
    try {
      await api.setAnomalyStatus(id, next)
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
          <div className="eyebrow">Steps 4–5 · Detect and record</div>
          <h1>Anomalies</h1>
          <p className="lead">Week-over-week changes that crossed a threshold. The cause shown is a suggestion; the SEO team confirms it.</p>
        </div>
      </div>

      <div className="panel">
        <div className="toolbar">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
          <select value={metric} onChange={(e) => setMetric(e.target.value)}>
            <option value="">All metrics</option>
            {metrics.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>

        {error || actionError ? <div className="notice error">{error ?? actionError}</div> : null}
        {loading && !data ? <p className="muted">Loading…</p> : null}
        {data && shown.length === 0 ? (
          <p className="empty">{data.length ? 'No anomalies match these filters.' : 'No anomalies detected yet.'}</p>
        ) : null}

        <div className="stack">
          {shown.map((a) => (
            <AnomalyCard
              key={a.anomalyId}
              anomaly={a}
              actions={
                <div className="actions">
                  {STATUSES.filter((s) => s !== a.status).map((s) => (
                    <button key={s} className="btn small" onClick={() => void move(a.anomalyId, s)}>
                      Mark {statusLabel(s).toLowerCase()}
                    </button>
                  ))}
                  <span className="muted small" style={{ alignSelf: 'center' }}>
                    {SOURCE_LABELS[a.source]} · {a.threshold.source}
                  </span>
                </div>
              }
            />
          ))}
        </div>
      </div>
    </>
  )
}
