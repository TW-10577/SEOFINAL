import { useState } from 'react'
import { api } from '../api/client'
import ErrorNotice from '../components/ErrorNotice'
import MeasurementsOverview from '../components/MeasurementsOverview'
import { scopeLabel } from '../format'
import { useI18n } from '../i18n'
import type { CountermeasureStatus } from '../types'
import { useApi } from '../useApi'

// Moves that end a countermeasure without carrying it out are shown as secondary buttons.
const SECONDARY = new Set(['Dismissed', 'VerifiedIneffective'])

export default function CountermeasuresPage() {
  const { t, enumLabel, next, ontology } = useI18n()
  const { data, error, loading, reload } = useApi(api.countermeasures)
  const [status, setStatus] = useState('')
  const [owner, setOwner] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  const statuses = ontology?.enums['logos.seo.value.countermeasure-status']?.map((e) => e.value) ?? []
  const owners = [...new Set((data ?? []).map((c) => c.ownerTeam))]
  const shown = (data ?? []).filter((c) => (!status || c.status === status) && (!owner || c.ownerTeam === owner))

  async function move(id: string, to: string) {
    try {
      await api.setCountermeasureStatus(id, to as CountermeasureStatus)
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
          <div className="eyebrow">{t('cm.eyebrow')}</div>
          <h1>{t('tab.countermeasures')}</h1>
          <p className="lead">{t('cm.lead')}</p>
        </div>
      </div>

      <div className="stack">
        <MeasurementsOverview />

        <div className="panel">
          <div className="panel-head">
            <h2>{t('ms.actions')}</h2>
          </div>
          <div className="toolbar">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('an.allStatuses')}</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {enumLabel('countermeasure-status', s)}
                </option>
              ))}
            </select>
            <select value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">{t('cm.allTeams')}</option>
              {owners.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </div>

          <ErrorNotice message={error ?? actionError} />
          {loading && !data ? <p className="muted">{t('loading')}</p> : null}
          {data && shown.length === 0 ? <p className="empty">{data.length ? t('cm.noMatch') : t('cm.none')}</p> : null}

          <div className="stack">
            {shown.map((c) => {
              const moves = next('countermeasure-status', c.status)
              return (
                <div className="item" key={c.countermeasureId}>
                  <div className="item-head">
                    <div className="item-title">{c.description}</div>
                    <div className="actions">
                      <span className={`badge ${c.priority === 'High' ? 'bad' : c.priority === 'Medium' ? 'warn' : ''}`}>
                        {enumLabel('priority-level', c.priority)}
                      </span>
                      <span className={`badge ${c.status === 'Dismissed' || c.status === 'VerifiedIneffective' ? 'bad' : c.status === 'Proposed' ? 'warn' : 'good'}`}>
                        {enumLabel('countermeasure-status', c.status)}
                      </span>
                    </div>
                  </div>
                  <p>{c.reason}</p>
                  <div className="item-meta">
                    <span className="mono">{c.countermeasureId}</span>
                    <span>{t('cm.for', { anomaly: c.anomalyId, cause: c.causeId })}</span>
                    <span>{t('cm.target', { target: scopeLabel(c.target, t) })}</span>
                    <span>{t('cm.owner', { owner: c.ownerTeam })}</span>
                    <span>
                      {t('an.rule')}: {c.rule} {c.ruleConfirmed ? null : <span className="badge warn plain">{t('unconfirmed')}</span>}
                    </span>
                  </div>
                  {moves.length ? (
                    <div className="actions">
                      {moves.map((s) => (
                        <button key={s} className={`btn small ${SECONDARY.has(s) ? '' : 'primary'}`} onClick={() => void move(c.countermeasureId, s)}>
                          {t('an.moveTo', { status: enumLabel('countermeasure-status', s) })}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="muted small">{t('cm.final')}</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}
