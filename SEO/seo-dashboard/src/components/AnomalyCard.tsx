import type { ReactNode } from 'react'
import { formatChange, formatPeriod, formatThreshold, formatValue, isWorse, SOURCE_LABELS, statusLabel } from '../format'
import type { Anomaly } from '../types'

interface AnomalyCardProps {
  anomaly: Anomaly
  actions?: ReactNode
}

export default function AnomalyCard({ anomaly: a, actions }: AnomalyCardProps) {
  const worse = isWorse(a.kind, a.absoluteChange)
  return (
    <div className="item">
      <div className="item-head">
        <div>
          <div className="item-title">
            {a.metricName} <span className="muted">· {a.scope}</span>
          </div>
          <div className="item-meta">
            <span className="mono">{a.anomalyId}</span>
            <span>{SOURCE_LABELS[a.source]}</span>
            <span>
              {formatPeriod(a.previousPeriod)} → {formatPeriod(a.currentPeriod)}
            </span>
          </div>
        </div>
        <span className={`badge ${a.status === 'Resolved' ? 'good' : a.status === 'Detected' ? 'warn' : ''}`}>{statusLabel(a.status)}</span>
      </div>

      <div className="item-meta">
        <span>
          {formatValue(a.kind, a.metricKey, a.previousValue)} → {formatValue(a.kind, a.metricKey, a.currentValue)}
        </span>
        <span className={`change ${worse ? 'bad' : 'good'}`}>{formatChange(a.kind, a.absoluteChange, a.changePercentage)}</span>
        <span>
          Threshold {formatThreshold(a.threshold.kind, a.threshold.value)}{' '}
          {a.threshold.confirmed ? null : <span className="badge warn plain">unconfirmed</span>}
        </span>
      </div>

      <p>{a.possibleCause}</p>
      {actions}
    </div>
  )
}
