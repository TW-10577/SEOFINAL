import { useState } from 'react'
import { api } from '../api/client'
import type { CountermeasureStatus } from '../types'
import { useApi } from '../useApi'

// Must match COUNTERMEASURE_TRANSITIONS in seo-api/src/service.ts
const NEXT: Record<CountermeasureStatus, { status: CountermeasureStatus; label: string; primary?: boolean }[]> = {
  Proposed: [
    { status: 'Approved', label: 'Approve', primary: true },
    { status: 'Rejected', label: 'Reject' },
  ],
  Approved: [
    { status: 'Implemented', label: 'Mark implemented', primary: true },
    { status: 'Rejected', label: 'Reject' },
  ],
  Implemented: [{ status: 'Verified', label: 'Mark verified', primary: true }],
  Verified: [],
  Rejected: [{ status: 'Proposed', label: 'Reopen' }],
}

const STATUSES = Object.keys(NEXT) as CountermeasureStatus[]

export default function CountermeasuresPage() {
  const { data, error, loading, reload } = useApi(api.countermeasures)
  const [status, setStatus] = useState('')
  const [owner, setOwner] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  const owners = [...new Set((data ?? []).map((c) => c.ownerTeam))]
  const shown = (data ?? []).filter((c) => (!status || c.status === status) && (!owner || c.ownerTeam === owner))

  async function move(id: string, next: CountermeasureStatus) {
    try {
      await api.setCountermeasureStatus(id, next)
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
          <div className="eyebrow">Steps 7 & 10 · Suggest and decide</div>
          <h1>Countermeasures</h1>
          <p className="lead">The system proposes; the SEO team approves, rejects and tracks each action. Nothing is executed automatically.</p>
        </div>
      </div>

      <div className="panel">
        <div className="toolbar">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">All teams</option>
            {owners.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </div>

        {error || actionError ? <div className="notice error">{error ?? actionError}</div> : null}
        {loading && !data ? <p className="muted">Loading…</p> : null}
        {data && shown.length === 0 ? (
          <p className="empty">{data.length ? 'No countermeasures match these filters.' : 'No countermeasures yet. They are proposed for each detected anomaly.'}</p>
        ) : null}

        <div className="stack">
          {shown.map((c) => (
            <div className="item" key={c.countermeasureId}>
              <div className="item-head">
                <div className="item-title">{c.description}</div>
                <div className="actions">
                  <span className={`badge ${c.priority === 'High' ? 'bad' : c.priority === 'Medium' ? 'warn' : ''}`}>{c.priority}</span>
                  <span className={`badge ${c.status === 'Rejected' ? 'bad' : c.status === 'Proposed' ? 'warn' : 'good'}`}>{c.status}</span>
                </div>
              </div>
              <p>{c.reason}</p>
              <div className="item-meta">
                <span className="mono">{c.countermeasureId}</span>
                <span>For {c.relatedAnomalyId}</span>
                <span>Owner: {c.ownerTeam}</span>
                <span>
                  Rule: {c.rule} {c.ruleConfirmed ? null : <span className="badge warn plain">unconfirmed</span>}
                </span>
              </div>
              {NEXT[c.status].length ? (
                <div className="actions">
                  {NEXT[c.status].map((n) => (
                    <button key={n.status} className={`btn small ${n.primary ? 'primary' : ''}`} onClick={() => void move(c.countermeasureId, n.status)}>
                      {n.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
