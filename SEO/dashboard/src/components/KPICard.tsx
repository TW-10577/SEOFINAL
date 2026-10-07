import { metricValue, pct } from '../format.ts';
import { t } from '../i18n.ts';

export function KPICard({ label, metric, current, previous, changeRate, source, note }: {
  label: string;
  metric: string;
  current: number | null;
  previous: number | null;
  changeRate: number | null;
  source: string;
  note?: string | null;
}) {
  return (
    <div className="card kpi">
      <div className="label">{t(label)}</div>
      <div className="value">{metricValue(metric, current)}</div>
      <div className="delta">
        {pct(changeRate)} {t('vs previous')} ({metricValue(metric, previous)})
      </div>
      <div className="src">{source}{note ? ` · ${note}` : ''}</div>
    </div>
  );
}
