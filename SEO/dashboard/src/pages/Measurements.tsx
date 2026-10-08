import type { AnalysisResult, Measurement, MeasurementRun, Monitoring } from '@seo/shared';
import { useEffect, useState } from 'react';
import { query } from '../api.ts';
import { useContextRun, type ImportContext } from '../context.ts';
import { DataQualityWarnings } from '../components/DataQualityWarnings.tsx';
import { DataTable } from '../components/DataTable.tsx';
import { MeasurementDetailDrawer } from '../components/MeasurementDetailDrawer.tsx';
import { RuleChecks } from '../components/RuleChecks.tsx';
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { useApi } from '../components/useApi.ts';
import { PeriodPicker, type SourcePeriods } from '../components/PeriodPicker.tsx';
import { TestDataNotice, useTestData } from '../components/TestData.tsx';
import { dateTime, metricLabel, metricValue, pct, period, signed } from '../format.ts';
import { t } from '../i18n.ts';
import { dataLabel } from '../i18n.ts';

interface MeasurementsResponse {
  run: MeasurementRun | null;
  measurements: Measurement[];
  analysisResults: AnalysisResult[];
  dataUsed: { uploadId: number; fileName: string; source: string | null; values: number; rules: string[] }[];
  monitoring: Monitoring | null;
}

/**
 * Measurements of the active import context: the run made for the context's files and period is shown — and
 * created automatically when it does not exist yet. Changing the period or picking another run updates the context.
 */
export function MeasurementsPage({ ctx, onCtx, onContinue }: { ctx: ImportContext; onCtx: (patch: Partial<ImportContext>) => void; onContinue: (runId: number) => void }) {
  // Test data = dates the export itself marks as not real; one switch for Data and Measurements.
  const [includeTest] = useTestData();
  const cr = useContextRun(ctx, includeTest);
  const hasContext = ctx.uploads.length > 0 || !!ctx.end;
  const [lastRun, setLastRun] = useState<{ id: number; at: string; measurements: Measurement[] } | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  // With a context, only its own run is shown (never the latest run of other data).
  const data = useApi<MeasurementsResponse>(cr.runId ? `/measurements${query({ runId: cr.runId })}` : hasContext ? null : '/measurements');
  useEffect(() => data.reload(), [cr.runs]);

  async function run() {
    const res = await cr.rerun();
    if (res) {
      setLastRun({ id: res.run.id, at: res.run.createdAt, measurements: res.measurements as Measurement[] });
      onCtx({ run: undefined });
    }
  }
  /** Another run: the context becomes that run's files and period. */
  function showRun(r: MeasurementRun) {
    onCtx({ uploads: r.scope.uploadIds, end: r.current.end, run: r.id });
  }

  const current = data.data;
  const ga4 = cr.periods?.GA4;
  const files = cr.runs?.find((r) => r.id === current?.run?.id)?.scope.files ?? [];
  return (
    <>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>{t('Run measurements')}</h2>
            <div className="hint">{t('Week on week, detected from the uploaded GA4 data: the current week and the 7 days before it. OK / NG is calculated by the system.')}</div>
          </div>
        </div>
        <div className="card-body filters">
          <PeriodPicker title={t('Analysis period (GA4)')} data={ga4} value={cr.end} onChange={(end) => onCtx({ end, run: undefined })} />
          <button className="btn primary" onClick={run} disabled={cr.running}>{cr.running ? t('Running…') : t('Run measurements')}</button>
          <span className="spacer" />
          {cr.runs && cr.runs.length > 0 && (
            <label className="field">
              {t('Show run')}
              <select value={current?.run?.id ?? ''} onChange={(e) => { const r = cr.runs!.find((x) => x.id === Number(e.target.value)); if (r) showRun(r); }}>
                {!current?.run && <option value="">—</option>}
                {cr.runs.map((r) => (
                  <option key={r.id} value={r.id}>#{r.id} · {period(r.current)} vs {period(r.previous)}{r.scope.files.length ? ` · ${r.scope.files.join(', ')}` : ''} · {dateTime(r.createdAt)}</option>
                ))}
              </select>
            </label>
          )}
          <button className="btn primary" onClick={() => current?.run && onContinue(current.run.id)} disabled={!current?.run} title={current?.run ? undefined : t('Run the measurements before generating a report.')}>
            {t('Continue to Report →')}
          </button>
        </div>
        {hasContext && (
          <div className="card-body" style={{ paddingTop: 0 }}>
            <div className="small secondary">
              {t('Context')}: <strong>{files.length ? files.join(', ') : ctx.uploads.length ? ctx.uploads.map((id) => `#${id}`).join(', ') : t('all uploaded data')}</strong>
              {cr.end && <> · {t('analysis period')} <strong>{current?.run ? `${period(current.run.current)} vs ${period(current.run.previous)}` : cr.end}</strong></>}
            </div>
          </div>
        )}
        {(ga4?.synthetic?.length ?? 0) > 0 && <div className="card-body" style={{ paddingTop: 0 }}><TestDataNotice ga4={ga4} /></div>}
        {cr.error != null && <div className="card-body" style={{ paddingTop: 0 }}><ErrorState error={cr.error} /></div>}
        {lastRun && <RunOutcome run={lastRun} ga4={ga4} includeTest={includeTest} />}
      </section>

      {data.error != null && <ErrorState error={data.error} onRetry={data.reload} />}
      {(cr.running || (data.loading && !current) || (hasContext && !cr.runId && !cr.error)) && <LoadingState />}
      {!hasContext && current && !current.run && <EmptyState title="No measurement run yet.">{t('Choose the current week and press Run measurements.')}</EmptyState>}

      {current?.run && (
        <>
          {current.run.issues.length > 0 && (
            <section className="card"><div className="card-body"><DataQualityWarnings issues={current.run.issues} title="Run warnings" /></div></section>
          )}
          <RuleChecks run={current.run} rows={current.measurements} dataUsed={current.dataUsed} onReview={setDetailId} />
          {current.monitoring && (
            <section className="card"><div className="card-body"><MonitoringLine m={current.monitoring} /></div></section>
          )}
        </>
      )}

      {detailId !== null && <MeasurementDetailDrawer id={detailId} onClose={() => setDetailId(null)} onChanged={data.reload} />}
    </>
  );
}

const span = (dates: string[]) => (dates.length ? `${dates[0]} – ${dates[dates.length - 1]}` : '');

/** What the last click on Run measurements produced, and — when no rule could be applied — why. */
function RunOutcome({ run, ga4, includeTest }: { run: { id: number; at: string; measurements: Measurement[] }; ga4: SourcePeriods | undefined; includeTest: boolean }) {
  const n = (s: string) => run.measurements.filter((m) => m.status === s).length;
  const judged = n('OK') + n('NG');
  const realDays = ga4?.range ? Math.round((Date.parse(ga4.range.end) - Date.parse(ga4.range.start)) / 86400000) + 1 : 0;
  return (
    <div className="card-body" style={{ paddingTop: 0 }}>
      <div className={judged ? 'notice' : 'notice warn'}>
        <strong>{t('Run #{id} finished {time}', { id: run.id, time: dateTime(run.at) })}</strong> — OK {n('OK')} · NG {n('NG')} · {t('NOT EVALUABLE')} {n('NOT_EVALUABLE')}
        {n('NG') > 0 && <> · {t('Open Detail on the NG row to see the anomaly, cause and evidence.')}</>}
        {!judged && (
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            <li>{t('No rule could be applied: week on week needs 14 consecutive days of GA4 data (current week + previous week).')}</li>
            {ga4?.range && <li>{t('GA4 data used: {range} ({n} days).', { range: period(ga4.range), n: realDays })}</li>}
            {!includeTest && (ga4?.synthetic?.length ?? 0) > 0 && (
              <li>{t('{range} is marked as not real data in the uploaded file and is excluded.', { range: span(ga4!.synthetic!) })}</li>
            )}
            <li>{t('Search Console page / query files are 3-month totals: they are evidence for rule ①, not judged on their own.')}</li>
            <li>
              {t('Next: upload two complete weeks of real GA4 data')}
              {!includeTest && (ga4?.synthetic?.length ?? 0) > 0 ? t(', or tick "Include test data" to try the flow with the dummy dates.') : '.'}
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}

const CHANGE: Record<Monitoring['items'][number]['change'], string> = { new: 'New', continuing: 'Continuing', cleared: 'Cleared', unchanged: 'No change' };

/** Weekly monitoring: each rule's result compared with the previous week's run. */
function MonitoringLine({ m }: { m: Monitoring }) {
  return (
    <div className="small secondary" style={{ marginTop: 10 }}>
      <strong>{t('Since the previous week')}:</strong>{' '}
      {m.previousRun
        ? <>
            {t('run #{id} ({period})', { id: m.previousRun.id, period: period(m.previousRun.current) })} —{' '}
            {m.items.map((i) => `${i.name}: ${t(CHANGE[i.change])} (${i.previous ?? '—'} → ${i.current})`).join(' · ')}
          </>
        : t('no earlier week measured yet')}
      {' · '}{t('Open anomalies from earlier weeks: {n}', { n: m.openFromEarlier })}{' · '}{t('Resolved / dismissed: {n}', { n: m.closed })}
    </div>
  );
}
