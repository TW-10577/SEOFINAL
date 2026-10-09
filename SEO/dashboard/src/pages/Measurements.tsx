import type { AnalysisResult, Measurement, MeasurementRun, Monitoring } from '@seo/shared';
import { useEffect, useState } from 'react';
import { query } from '../api.ts';
import { useContextRun, type ImportContext } from '../context.ts';
import { DataQualityWarnings } from '../components/DataQualityWarnings.tsx';
import { DataTable } from '../components/DataTable.tsx';
import { MeasurementDetailDrawer } from '../components/MeasurementDetailDrawer.tsx';
import { RuleChecks } from '../components/RuleChecks.tsx';
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx';
import { Icon } from '../components/Icon.tsx';
import { useApi } from '../components/useApi.ts';
import { PeriodPicker, type SourcePeriods } from '../components/PeriodPicker.tsx';
import { useTestData } from '../components/TestData.tsx';
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
  const [detailId, setDetailId] = useState<number | null>(null);
  // With a context, only its own run is shown (never the latest run of other data).
  const data = useApi<MeasurementsResponse>(cr.runId ? `/measurements${query({ runId: cr.runId })}` : hasContext ? null : '/measurements');
  useEffect(() => data.reload(), [cr.runs]);

  async function run() {
    const res = await cr.rerun();
    if (res) onCtx({ run: undefined });

  }
  /** Another run: the context becomes that run's files and period. */
  function showRun(r: MeasurementRun) {
    onCtx({ uploads: r.scope.uploadIds, end: r.current.end, run: r.id });
  }

  const current = data.data;
  const ga4 = cr.periods?.GA4;
  return (
    <>
      <section className="card toolbar">
        <div className="toolbar-row">
          <span className="spacer" />
          <button className="btn primary" onClick={() => current?.run && onContinue(current.run.id)} disabled={!current?.run} title={current?.run ? undefined : t('Run the measurements before generating a report.')}>
            {t('Continue to Report')}
            <Icon name="arrowRight" size={16} />
          </button>
        </div>
        <div className="toolbar-row filters">
          <PeriodPicker title={t('Analysis period (GA4)')} data={ga4} value={cr.end} onChange={(end) => onCtx({ end, run: undefined })} />
          {cr.runs && cr.runs.length > 1 && (
            <label className="field" style={{ flex: '1 1 320px' }}>
              {t('Show run')}
              <select value={current?.run?.id ?? ''} onChange={(e) => { const r = cr.runs!.find((x) => x.id === Number(e.target.value)); if (r) showRun(r); }}>
                {!current?.run && <option value="">—</option>}
                {cr.runs.map((r) => (
                  <option key={r.id} value={r.id}>#{r.id} · {period(r.current)} vs {period(r.previous)}{r.scope.files.length ? ` · ${r.scope.files.join(', ')}` : ''} · {dateTime(r.createdAt)}</option>
                ))}
              </select>
            </label>
          )}
          <span className="spacer" />
          <button className="btn" onClick={run} disabled={cr.running} title={t('Week on week, detected from the uploaded GA4 data: the current week and the 7 days before it. OK / NG is calculated by the system.')}>
            <Icon name={cr.running ? 'loader' : 'refresh'} size={15} className={cr.running ? 'spin' : undefined} />
            {cr.running ? t('Running…') : t('Run measurements')}
          </button>
        </div>
        {cr.error != null && (
          <div className="toolbar-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <ErrorState error={cr.error} />
          </div>
        )}
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
        </>
      )}

      {detailId !== null && <MeasurementDetailDrawer id={detailId} onClose={() => setDetailId(null)} onChanged={data.reload} />}
    </>
  );
}
