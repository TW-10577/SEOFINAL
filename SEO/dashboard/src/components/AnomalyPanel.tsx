import { type Anomaly, type MeasurementRun } from '@seo/shared';
import { useNextTransitions } from './ontology.tsx';
import { metricLabel, metricValue, pct, period, signed } from '../format.ts';
import { Decision } from './Decision.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { t } from '../i18n.ts';
import { dataLabel } from '../i18n.ts';

export function AnomalyPanel({ anomaly, run, reviewer, onChanged }: { anomaly: Anomaly | null; run: MeasurementRun; reviewer: string; onChanged: () => void }) {
  const next = useNextTransitions('anomaly', anomaly?.state ?? '');
  return (
    <section className="card">
      <div className="card-head"><h2>{t('SEO Anomaly')}</h2></div>
      <div className="card-body">
        {!anomaly ? (
          <div className="secondary">{t('No anomaly detected.')}</div>
        ) : (
          <>
            <dl className="kv">
              <dt>{t('Anomaly ID')}</dt><dd>#{anomaly.id}</dd>
              <dt>{t('State')}</dt><dd><StatusBadge status={anomaly.state} /></dd>
              <dt>{t('Detection date')}</dt><dd>{anomaly.detectionDate}</dd>
              <dt>{t('Subject')}</dt><dd>{dataLabel(anomaly.subjectKey)} ({anomaly.subjectType})</dd>
              <dt>{t('Metric')}</dt><dd>{metricLabel(anomaly.metric)}</dd>
              <dt>{t('Values')}</dt>
              <dd>
                {metricValue(anomaly.metric, anomaly.previousValue)} → {metricValue(anomaly.metric, anomaly.currentValue)} ({signed(anomaly.metric, anomaly.change)}, {pct(anomaly.changeRate)})
              </dd>
              <dt>{t('Period')}</dt><dd>{t('Current')} {period(run.current)} / {t('Previous')} {period(run.previous)}</dd>
            </dl>
            <Decision path={`/anomalies/${anomaly.id}/state`} next={next} reviewer={reviewer} onDone={onChanged} label="state" blocked={anomaly.blocked} />
          </>
        )}
      </div>
    </section>
  );
}
