import { t } from '../i18n.ts';
import { Delta, fmtValue } from './ReportSections.tsx';

/** Week-on-week KPI: current value, previous value, and the change (coloured by what the metric means). */
export function KPICard({ label, metric, current, previous, changeRate, absoluteChange, source, note }: {
  label: string;
  metric: string;
  current: number | null;
  previous: number | null;
  changeRate: number | null;
  absoluteChange?: number | null;
  source: string;
  note?: string | null;
}) {
  const abs = absoluteChange ?? (current !== null && previous !== null ? current - previous : null);
  return (
    <div className="card kpi">
      <div className="label">{t(label)}</div>
      <div className="value">{fmtValue(metric, current)}</div>
      <div className="stat-prev">{t('Previous week')}: <strong>{fmtValue(metric, previous)}</strong></div>
      <Delta metric={metric} abs={abs} rate={changeRate} />
      <div className="src">{source}{note ? ` · ${note}` : ''}</div>
    </div>
  );
}
