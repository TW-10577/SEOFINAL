import type { Measurement } from '@seo/shared';
import { metricLabel, metricValue, pct, signed } from '../format.ts';
import { DataTable } from './DataTable.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { t } from '../i18n.ts';

const UNIT_LABEL: Record<string, string> = { percent: '%', percentage_points: 'percentage points', unresolved: '% / pending confirmation' };

/** Anomaly status that follows from the result: NG creates an SEO Anomaly; OK / NOT EVALUABLE do not. */
function anomalyStatus(m: Measurement) {
  if (m.status === 'NG') return <span className="badge ng nowrap">{t('Anomaly Detected')}</span>;
  return <span className="secondary nowrap">{m.status === 'OK' ? t('No Anomaly') : t('No Anomaly (not evaluated)')}</span>;
}

export function MeasurementTable({ rows, onDetail, selectedId }: { rows: Measurement[]; onDetail: (m: Measurement) => void; selectedId: number | null }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(m) => m.id}
      selectedKey={selectedId}
      onRowClick={onDetail}
      empty={t('No measurements in this run.')}
      columns={[
        { key: 'name', label: t('Measurement'), render: (m) => <strong>{m.name}</strong> },
        { key: 'unit', label: t('Analysis unit'), render: (m) => m.analysisUnit },
        { key: 'metric', label: t('Metric'), render: (m) => metricLabel(m.metric) },
        { key: 'prev', label: t('Previous'), num: true, render: (m) => metricValue(m.metric, m.previousValue) },
        { key: 'cur', label: t('Current'), num: true, render: (m) => metricValue(m.metric, m.currentValue) },
        { key: 'chg', label: t('Change'), num: true, render: (m) => <>{pct(m.changeRate)}<br /><span className="small muted">{signed(m.metric, m.absoluteChange)}</span></> },
        { key: 'th', label: t('Threshold'), num: true, render: (m) => (m.thresholdValue === null ? '—' : `±${m.thresholdValue}`) },
        { key: 'thu', label: t('Threshold unit'), render: (m) => <span className={m.thresholdUnit === 'unresolved' ? 'caveat nowrap' : 'nowrap'}>{t(UNIT_LABEL[m.thresholdUnit] ?? m.thresholdUnit)}</span> },
        {
          key: 'res',
          label: t('Result'),
          render: (m) => (
            <>
              <StatusBadge status={m.status} title={m.result} />
              {m.result.startsWith('[TEST DATA]') || m.result.startsWith('［テストデータ］') ? <div className="small caveat nowrap">{t('TEST DATA')}</div> : null}
              {m.caveats.length > 0 && <div className="small caveat nowrap" title={m.caveats.join('\n')}>⚠ {t('Unconfirmed mapping')}</div>}
            </>
          ),
        },
        { key: 'status', label: t('Status'), render: anomalyStatus },
        { key: 'rule', label: t('Rule'), render: (m) => <span className="mono">{m.ruleId}</span> },
        { key: 'reason', label: t('Reason'), render: (m) => <span className="small">{m.reason}</span> },
        { key: 'cause', label: t('Cause'), render: (m) => <span className="small">{m.status === 'NG' && m.causeSummary ? m.causeSummary : '—'}</span> },
        { key: 'detail', label: t('Detail'), render: (m) => <button className="btn small" onClick={(e) => (e.stopPropagation(), onDetail(m))}>{t('Detail')}</button> },
      ]}
    />
  );
}
