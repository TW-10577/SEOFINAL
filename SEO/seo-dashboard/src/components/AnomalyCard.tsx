import type { ReactNode } from 'react'
import { formatChange, formatPeriod, formatThreshold, formatValue, isWorse, metricLabel, scopeLabel, sourceLabel } from '../format'
import { useI18n } from '../i18n'
import type { AnomalyView } from '../types'

interface AnomalyCardProps {
  anomaly: AnomalyView
  actions?: ReactNode
  children?: ReactNode
}

export default function AnomalyCard({ anomaly: a, actions, children }: AnomalyCardProps) {
  const { t, enumLabel } = useI18n()
  const worse = isWorse(a.kind, a.absoluteChange)
  const done = a.status === 'Resolved' || a.status === 'Dismissed'
  return (
    <div className="item">
      <div className="item-head">
        <div>
          <div className="item-title">
            {metricLabel(a.metricKey, t)} <span className="muted">· {scopeLabel(a.scope, t)}</span>
          </div>
          <div className="item-meta">
            <span className="mono">{a.anomalyId}</span>
            <span>{sourceLabel(a.source, t)}</span>
            <span>
              {formatPeriod(a.previousPeriod)} → {formatPeriod(a.currentPeriod)}
            </span>
          </div>
        </div>
        <span className={`badge ${done ? 'good' : a.status === 'Detected' ? 'warn' : ''}`}>{enumLabel('anomaly-status', a.status)}</span>
      </div>

      <div className="item-meta">
        <span>
          {formatValue(a.kind, a.metricKey, a.previousValue)} → {formatValue(a.kind, a.metricKey, a.currentValue)}
        </span>
        <span className={`change ${worse ? 'bad' : 'good'}`}>{formatChange(a.kind, a.absoluteChange, a.changePercentage, t)}</span>
        <span>
          {t('an.condition', { id: a.judgmentConditionId, threshold: formatThreshold(a.threshold.kind, a.threshold.value, t) })}{' '}
          {a.threshold.confirmed ? null : <span className="badge warn plain">{t('unconfirmed')}</span>}
        </span>
      </div>

      {a.cause ? <p>{a.cause.hypothesis}</p> : null}
      {children}
      {actions}
    </div>
  )
}
