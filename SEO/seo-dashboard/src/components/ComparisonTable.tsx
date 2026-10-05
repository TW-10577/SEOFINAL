import { formatChange, formatThreshold, formatValue, isWorse } from '../format'
import type { Comparison } from '../types'

export default function ComparisonTable({ comparisons }: { comparisons: Comparison[] }) {
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Scope</th>
            <th className="num">Previous week</th>
            <th className="num">Latest week</th>
            <th className="num">Change</th>
            <th className="num">Threshold</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {comparisons.map((c) => (
            <tr key={`${c.metricKey}-${c.scope}`}>
              <td>{c.label}</td>
              <td className="muted">{c.scope}</td>
              <td className="num">{formatValue(c.kind, c.metricKey, c.previous)}</td>
              <td className="num">{formatValue(c.kind, c.metricKey, c.current)}</td>
              <td className={`num change ${c.significant ? (isWorse(c.kind, c.absoluteChange) ? 'bad' : 'good') : ''}`}>
                {formatChange(c.kind, c.absoluteChange, c.changePercentage)}
              </td>
              <td className="num muted">
                {c.threshold ? (
                  <>
                    {formatThreshold(c.threshold.kind, c.threshold.value)}
                    {c.threshold.confirmed ? '' : ' *'}
                  </>
                ) : (
                  '—'
                )}
              </td>
              <td>{c.significant ? <span className="badge warn">Significant</span> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {comparisons.some((c) => c.threshold && !c.threshold.confirmed) ? (
        <p className="muted small">* Threshold not yet confirmed by the SEO team.</p>
      ) : null}
    </div>
  )
}
