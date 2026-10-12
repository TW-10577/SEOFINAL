import type { Ga4Overview, Measurement, MeasurementDetail, MeasurementRun, Report } from '@seo/shared';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, postJson, query } from '../api.ts';
import { Icon } from '../components/Icon.tsx';
import { PAGE_ACTIONS_ID } from '../components/Header.tsx';
import { ReportPreview } from '../components/ReportPreview.tsx';
import {
  ActionPlan,
  Attention,
  byPriority,
  dataSourcesOf,
  ExecutiveSummary,
  KpiOverview,
  MeasurementDetails,
  overallOf,
  ReportHeader,
  type Summary,
} from '../components/ReportSections.tsx';
import { BusinessInsights, type RuleSummary } from '../components/BusinessInsights.tsx';
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx';
import { useApi } from '../components/useApi.ts';
import { period } from '../format.ts';
import { currentLang, t } from '../i18n.ts';
import { useContextRun, type ImportContext } from '../context.ts';
import { useTestData } from '../components/TestData.tsx';
import { GscReportView } from '../components/GscReportView.tsx';

/** Report page: GA4 Report (from the GA4 measurements) or the standalone GSC Performance Report (from the GSC data). */
export function ReportPage({ ctx, onCtx, onBack }: { ctx: ImportContext; onCtx: (patch: Partial<ImportContext>) => void; onBack: () => void }) {
  const [includeTest] = useTestData();
  const gsc = ctx.report === 'gsc';
  return (
    <>
      <div className="segmented no-print" role="tablist" aria-label={t('Report source')} style={{ alignSelf: 'flex-start' }}>
        <button role="tab" aria-selected={!gsc} className={!gsc ? 'on' : ''} onClick={() => onCtx({ report: undefined })}>{t('GA4 Report')}</button>
        <button role="tab" aria-selected={gsc} className={gsc ? 'on' : ''} onClick={() => onCtx({ report: 'gsc' })}>{t('GSC Performance Report')}</button>
      </div>
      {gsc ? <GscReportView ctx={ctx} includeTest={includeTest} /> : <Ga4ReportView ctx={ctx} onCtx={onCtx} onBack={onBack} />}
    </>
  );
}

/**
 * Report of one measurement run: status and executive summary first, then KPIs, week-on-week charts, what needs
 * attention, the action plan and (collapsed) the technical details. Every value comes from the selected run's stored
 * records or from the data API scoped to that run's files, weeks and test-data setting; nothing is recalculated.
 */
function Ga4ReportView({ ctx, onCtx, onBack }: { ctx: ImportContext; onCtx: (patch: Partial<ImportContext>) => void; onBack: () => void }) {
  // The report follows the active import context: its run (created automatically when missing).
  const [includeTest] = useTestData();
  const cr = useContextRun(ctx, includeTest);
  const hasContext = ctx.uploads.length > 0 || !!ctx.end;
  const data = useApi<{ run: MeasurementRun | null; measurements: Measurement[] }>(cr.runId ? `/measurements${query({ runId: cr.runId })}` : hasContext ? null : '/measurements');
  // Switching runs keeps the chosen run in the context (URL), so a reload or the Measurements tab shows the same run.
  const onSelectRun = (id: number) => {
    const r = cr.runs?.find((x) => x.id === id);
    if (r) onCtx({ uploads: r.scope.uploadIds, end: r.current.end, run: r.id });
  };
  const run = data.data?.run ?? null;
  const measurements = data.data?.measurements ?? [];
  const ng = measurements.filter((m) => m.status === 'NG').sort(byPriority);
  const details = useDetails(ng);
  const report = useReport(run?.id ?? null);
  const [preview, setPreview] = useState(false);
  // The header (rendered by App above this page) owns the top-right action slot.
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setActionsSlot(document.getElementById(PAGE_ACTIONS_ID)), []);

  // KPI figures and charts for exactly this run: its files, its current week and its test-data setting.
  const runTest = run ? run.scope.includeTestData ?? includeTest : includeTest;
  const uploadIds = run?.scope.uploadIds.length ? run.scope.uploadIds.join(',') : undefined;
  const summary = useApi<Summary>(run ? `/data/summary${query({ ga4End: run.current.end, gscEnd: run.current.end, includeTestData: runTest ? 1 : 0, uploadIds })}` : null);
  const overview = useApi<Ga4Overview>(run ? `/data/ga4-overview${query({ includeTestData: runTest ? 1 : 0, uploadIds })}` : null);
  // rules.yaml rules (thresholds and cause patterns) for the business insights.
  const config = useApi<{ rules: RuleSummary[] }>('/config');
  const ga4 = summary.data?.periods.GA4;
  const periodMismatch = !!run && !!ga4 && (ga4.current.start !== run.current.start || ga4.previous.start !== run.previous.start);
  const overall = overallOf(measurements);
  // Stored M1 / M2 results: Business Insights reads OK / NG from them, as the Measurements page does.
  const results = useMemo(() => Object.fromEntries(measurements.map((m) => [m.ruleCode, m.status])), [measurements]);

  return (
    <>
      {data.error != null && <ErrorState error={data.error} onRetry={data.reload} />}
      {cr.error != null && <ErrorState error={cr.error} />}
      {((data.loading && !data.data) || cr.running || (hasContext && !cr.runId && cr.error == null)) && <LoadingState />}
      {data.data && !run && <EmptyState title={t('No measurement run yet.')}>{t('Run the measurements before generating a report.')}</EmptyState>}

      {run && (
        <>
          <ReportHeader
            run={run}
            runs={cr.runs ?? []}
            overall={overall}
            report={report.report}
            busy={report.busy}
            testData={measurements.some((m) => m.dataKind === 'test')}
            dataSources={dataSourcesOf(report.report, summary.data)}
            onSelectRun={onSelectRun}
            onBack={onBack}
          />
          {/* Report actions in the page's top-right corner (the header's page-actions slot). */}
          {actionsSlot &&
            createPortal(
              <div className="row report-actions">
                <button className="btn" onClick={() => void report.generate()} disabled={report.busy} title={t('Generate the report again from the run’s stored records.')}>
                  <Icon name={report.busy ? 'loader' : 'refresh'} size={15} className={report.busy ? 'spin' : undefined} />
                  {report.busy ? t('Generating…') : t('Regenerate')}
                </button>
                <button className="btn" onClick={() => setPreview(true)} disabled={!report.report && !report.busy}>
                  <Icon name="eye" size={15} />
                  {t('Report Preview')}
                </button>
                <DownloadTxt state={report} runId={run.id} />
              </div>,
              actionsSlot,
            )}
          {report.error != null && <ErrorState error={report.error} onRetry={() => void report.generate()} />}
          {periodMismatch && (
            <div className="notice warn">{t('The data for the charts covers {current} vs {previous}, which differs from this run’s weeks. Figures are shown from the run’s stored results.', { current: period(ga4!.current), previous: period(ga4!.previous) })}</div>
          )}
          {summary.error != null && <ErrorState error={summary.error} onRetry={summary.reload} />}
          <ExecutiveSummary measurements={measurements} overall={overall} />
          <KpiOverview summary={summary.data} overview={overview.data} measurements={measurements} />
          {summary.data && overview.data && config.data && (
            <BusinessInsights
              rows={summary.data.rows}
              weeks={summary.data.periods.GA4 ?? { current: run.current, previous: run.previous }}
              overview={overview.data}
              rules={config.data.rules}
              results={results}
              testData={measurements.some((m) => m.dataKind === 'test')}
              gscAvailable={!!summary.data.periods.GSC}
            />
          )}
          <Attention rows={ng} details={details} evaluated={measurements.filter((m) => m.status !== 'NOT_EVALUABLE').length} />
          <ActionPlan rows={ng} details={details} evaluated={measurements.filter((m) => m.status !== 'NOT_EVALUABLE').length} />
          <MeasurementDetails measurements={measurements} />
          {preview && <ReportDrawer runId={run.id} state={report} onClose={() => setPreview(false)} />}
        </>
      )}
    </>
  );
}

// ---------- data ----------

type Details = { byId: Record<number, MeasurementDetail>; loading: boolean; error: unknown };

/** Cause and countermeasures of each NG measurement, from the same detail records the Measurements drawer shows. */
function useDetails(rows: Measurement[]): Details {
  const ids = rows.map((m) => m.id).join(',');
  const [state, setState] = useState<Details>({ byId: {}, loading: false, error: null });
  const lang = currentLang();
  useEffect(() => {
    if (!ids) return setState({ byId: {}, loading: false, error: null });
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.all(ids.split(',').map((id) => api<MeasurementDetail>(`/measurements/${id}`)))
      .then((list) => live && setState({ byId: Object.fromEntries(list.map((d) => [d.measurement.id, d])), loading: false, error: null }))
      .catch((e) => live && setState({ byId: {}, loading: false, error: e }));
    return () => {
      live = false;
    };
  }, [ids, lang]);
  return state;
}

interface ReportState {
  report: Report | null;
  busy: boolean;
  error: unknown;
  generate: () => Promise<Report | null>;
}

/** The generated report of the run (existing report generation); regenerated when the run or language changes. */
function useReport(runId: number | null): ReportState {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const lang = currentLang();
  async function generate(): Promise<Report | null> {
    if (!runId) return null;
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<Report>('/reports/generate', { runId });
      setReport(r);
      return r;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setReport(null);
    void generate();
  }, [runId, lang]);
  return { report, busy, error, generate };
}


// ---------- Header actions: Download TXT and Report Preview ----------

function saveTxt(r: Report) {
  const url = URL.createObjectURL(new Blob([r.content], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = r.fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Download TXT: saves exactly the generated (previewed) report text; generates it first when needed. */
function DownloadTxt({ state, runId }: { state: ReportState; runId: number }) {
  const { report, busy, generate } = state;
  async function download() {
    const r = report ?? (await generate());
    if (r) saveTxt(r);
  }
  return (
    <button className="btn primary" onClick={download} disabled={busy} title={t('Weekly monitoring report generated from the database records of run #{id}.', { id: runId })}>
      <Icon name={busy ? 'loader' : 'download'} size={16} className={busy ? 'spin' : undefined} />
      {t('Download TXT')}
    </button>
  );
}

/** Report Preview in a side panel; Download saves exactly the previewed text. */
function ReportDrawer({ runId, state, onClose }: { runId: number; state: ReportState; onClose: () => void }) {
  const { report, busy, error, generate } = state;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={t('Report Preview')}>
        <div className="drawer-head">
          <Icon name="report" size={18} />
          <h2>{t('Report Preview')}</h2>
          <span className="hint small muted">#{runId}</span>
          <span className="spacer" />
          <button className="btn" onClick={() => void generate()} disabled={busy}>
            <Icon name={busy ? 'loader' : 'refresh'} size={15} className={busy ? 'spin' : undefined} />
            {busy ? t('Generating…') : t('Regenerate')}
          </button>
          <DownloadTxt state={state} runId={runId} />
          <button className="btn icon ghost" onClick={onClose} aria-label={t('Close')}><Icon name="x" size={16} /></button>
        </div>
        <div className="drawer-body">
          <div className="small muted">{t('The downloaded TXT contains exactly these sections and values.')}</div>
          {error != null && <ErrorState error={error} />}
          {busy && !report && <LoadingState lines={8} />}
          {report && <ReportPreview report={report} />}
        </div>
      </aside>
    </>
  );
}
