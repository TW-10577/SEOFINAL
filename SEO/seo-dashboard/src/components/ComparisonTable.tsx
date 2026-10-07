import { formatChange, formatThreshold, formatValue, isWorse, metricLabel, scopeLabel } from '../format'
import { useI18n } from '../i18n'
import type { Comparison } from '../types'

export default function ComparisonTable({ comparisons }: { comparisons: Comparison[] }) {
  const { t } = useI18n()
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>{t('cmp.metric')}</th>
            <th>{t('cmp.scope')}</th>
            <th className="num">{t('cmp.previous')}</th>
            <th className="num">{t('cmp.latest')}</th>
            <th className="num">{t('cmp.change')}</th>
            <th className="num">{t('cmp.condition')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {comparisons.map((c) => (
            <tr key={`${c.metricKey}-${c.scope}`}>
              <td>{metricLabel(c.metricKey, t)}</td>
              <td className="muted">{scopeLabel(c.scope, t)}</td>
              <td className="num">{formatValue(c.kind, c.metricKey, c.previous)}</td>
              <td className="num">{formatValue(c.kind, c.metricKey, c.current)}</td>
              <td className={`num change ${c.significant ? (isWorse(c.kind, c.absoluteChange) ? 'bad' : 'good') : ''}`}>
                {formatChange(c.kind, c.absoluteChange, c.changePercentage, t)}
              </td>
              <td className="num muted">
                {c.threshold ? (
                  <>
                    {formatThreshold(c.threshold.kind, c.threshold.value, t)}
                    {c.threshold.confirmed ? '' : ' *'}
                  </>
                ) : (
                  '—'
                )}
              </td>
              <td>{c.significant ? <span className="badge warn">{t('cmp.significant')}</span> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {comparisons.some((c) => c.threshold && !c.threshold.confirmed) ? <p className="muted small">{t('cmp.footnote')}</p> : null}
    </div>
  )
}
