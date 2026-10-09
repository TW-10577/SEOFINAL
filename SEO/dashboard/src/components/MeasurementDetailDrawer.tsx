import type { MeasurementDetail } from '@seo/shared';
import { useEffect, useState } from 'react';
import { metricLabel, metricValue, pct, period, signed } from '../format.ts';
import { AnomalyPanel } from './AnomalyPanel.tsx';
import { CauseHypothesisPanel } from './CauseHypothesisPanel.tsx';
import { CountermeasurePanel } from './CountermeasurePanel.tsx';
import { readReviewer, saveReviewer } from './Decision.tsx';
import { EvidencePanel } from './EvidencePanel.tsx';
import { GscEvidencePanel } from './GscEvidencePanel.tsx';
import { GscInvestigationPanel } from './GscInvestigationPanel.tsx';
import { ErrorState, LoadingState } from './States.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { useApi } from './useApi.ts';
import { t } from '../i18n.ts';
import { dataLabel } from '../i18n.ts';

export function MeasurementDetailDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const res = useApi<MeasurementDetail>(`/measurements/${id}`);
  const [reviewer, setReviewer] = useState(readReviewer);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const changed = () => (res.reload(), onChanged());
  const d = res.data;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={t('Measurement detail')}>
        <div className="drawer-head">
          <h2>{d?.measurement.name ?? t('Measurement')}</h2>
          {d && <StatusBadge status={d.measurement.status} />}
          <span className="spacer" />
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center' }}>
            {t('Reviewer')}
            <input type="text" placeholder={t('Your name')} value={reviewer} onChange={(e) => (setReviewer(e.target.value), saveReviewer(e.target.value))} />
          </label>
          <button className="btn" onClick={onClose}>{t('Close')}</button>
        </div>
        <div className="drawer-body">
          {res.error != null && <ErrorState error={res.error} />}
          {!d && !res.error && <LoadingState />}
          {d && (
            <>
              <section className="card">
                <div className="card-head"><h2>{t('Measurement')}</h2></div>
                <div className="card-body">
                  <dl className="kv">
                    <dt>{t('Measurement name')}</dt><dd>{d.measurement.name}</dd>
                    <dt>{t('Rule')}</dt>
                    <dd>
                      <span className="mono">{d.rule.id}</span> — {d.rule.criteria}
                      <div className="small secondary">{t('Primary judgment: {text}', { text: d.rule.primaryJudgment })}</div>
                      <div className="small secondary">{t('What to check next: {text}', { text: d.rule.whatToCheckNext })}</div>
                    </dd>
                    <dt>{t('Analysis unit')}</dt><dd>{d.measurement.analysisUnit} <span className="muted small">({dataLabel(d.measurement.subjectKey)})</span></dd>
                    <dt>{t('Metric')}</dt><dd>{metricLabel(d.measurement.metric)}</dd>
                    <dt>{t('Previous period')}</dt><dd>{period(d.run.previous)}</dd>
                    <dt>{t('Current period')}</dt><dd>{period(d.run.current)}</dd>
                    <dt>{t('Previous value')}</dt><dd>{metricValue(d.measurement.metric, d.measurement.previousValue)}</dd>
                    <dt>{t('Current value')}</dt><dd>{metricValue(d.measurement.metric, d.measurement.currentValue)}</dd>
                    <dt>{t('Absolute change')}</dt><dd>{signed(d.measurement.metric, d.measurement.absoluteChange)}</dd>
                    <dt>{t('Change rate')}</dt><dd>{pct(d.measurement.changeRate)}</dd>
                    <dt>{t('Threshold')}</dt><dd>{d.measurement.thresholdValue === null ? t('not configured') : `±${d.measurement.thresholdValue}`}</dd>
                    <dt>{t('Threshold unit')}</dt>
                    <dd>
                      {t(d.measurement.thresholdUnit)}
                      {d.rule.thresholdNote && <div className="small secondary">{d.rule.thresholdNote}</div>}
                    </dd>
                    <dt>{t('Result')}</dt><dd><StatusBadge status={d.measurement.status} /> {d.measurement.result}</dd>
                    <dt>{t('Reason')}</dt><dd>{d.measurement.reason}</dd>
                    <dt>{t('Status')}</dt>
                    <dd>{d.measurement.status === 'NG' ? <strong>{t('Anomaly Detected')}</strong> : d.measurement.status === 'OK' ? t('No Anomaly') : t('No Anomaly (not evaluated)')}</dd>
                  </dl>
                </div>
              </section>
              {/* GA4 evidence → GSC supporting evidence → cause → countermeasure → anomaly decisions */}
              <EvidencePanel evidence={d.evidence} sources={d.sources} />
              {d.rule.metric === 'sessions' && <GscEvidencePanel detail={d} />}
              {d.cause?.analysis?.investigation && <GscInvestigationPanel inv={d.cause.analysis.investigation} />}
              <CauseHypothesisPanel cause={d.cause} reviewer={reviewer} onChanged={changed} />
              <CountermeasurePanel cause={d.cause} countermeasures={d.countermeasures} reviewer={reviewer} onChanged={changed} />
              <AnomalyPanel anomaly={d.anomaly} run={d.run} reviewer={reviewer} onChanged={changed} />
              {d.events.length > 0 && (
                <section className="card">
                  <div className="card-head"><h2>{t('SEO team decisions')}</h2></div>
                  <div className="card-body">
                    <ul className="warnings-list">
                      {d.events.map((e) => (
                        <li key={e.id}>
                          <span className="muted nowrap">{e.at.slice(0, 16).replace('T', ' ')}</span>
                          <span><strong>{e.actor}</strong>: {t(e.entity)} #{e.entityId} {t(e.fromState)} → {t(e.toState)}{e.note ? ` — ${e.note}` : ''}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
