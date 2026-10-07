import type { Measurement } from '@seo/shared';
import { metricLabel, metricValue, pct, signed } from '../format.ts';
import { DataTable } from './DataTable.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { t } from '../i18n.ts';

const UNIT_LABEL: Record<string, string> = { percent: '% (relative)', percentage_points: 'percentage points', unresolved: 'unresolved' };

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
        { key: 'unit', label: t('Analysis unit'), render: (m) => <>{m.subjectKey} <span className="muted small">({m.subjectType})</span></> },
        { key: 'metric', label: t('Metric'), render: (m) => metricLabel(m.metric) },
        { key: 'prev', label: t('Previous'), num: true, render: (m) => metricValue(m.metric, m.previousValue) },
        { key: 'cur', label: t('Current'), num: true, render: (m) => metricValue(m.metric, m.currentValue) },
        { key: 'chg', label: t('Change'), num: true, render: (m) => <>{signed(m.metric, m.absoluteChange)}<br /><span className="small">{pct(m.changeRate)}</span></> },
        { key: 'th', label: t('Threshold'), num: true, render: (m) => (m.thresholdValue === null ? '—' : `±${m.thresholdValue}`) },
        { key: 'thu', label: t('Threshold unit'), render: (m) => (m.thresholdUnit === 'unresolved' ? <StatusBadge status="NOT_EVALUABLE" title={t('Unit not confirmed by the client')} /> : t(UNIT_LABEL[m.thresholdUnit] ?? m.thresholdUnit)) },
        { key: 'res', label: t('Result'), render: (m) => <span className="nowrap">{m.result}</span> },
        { key: 'status', label: t('Status'), render: (m) => <StatusBadge status={m.status} /> },
        { key: 'rule', label: t('Rule'), render: (m) => <span className="mono">{m.ruleId}</span> },
        { key: 'reason', label: t('Reason'), render: (m) => <span className="small">{m.reason}</span> },
        { key: 'cause', label: t('Cause (hypothesis)'), render: (m) => <span className="small">{m.causeSummary ?? (m.status === 'NG' ? '—' : t('No anomaly'))}</span> },
        { key: 'detail', label: t('Detail'), render: (m) => <button className="btn small" onClick={(e) => (e.stopPropagation(), onDetail(m))}>{t('Detail')}</button> },
      ]}
    />
  );
}
