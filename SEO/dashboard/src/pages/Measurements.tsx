import type { AnalysisResult, ConfigSummary, Measurement, MeasurementRun, Report } from '@seo/shared';
import { useEffect, useState } from 'react';
import { api, postJson, query } from '../api.ts';
import { DataQualityWarnings } from '../components/DataQualityWarnings.tsx';
import { DataTable } from '../components/DataTable.tsx';
import { MeasurementDetailDrawer } from '../components/MeasurementDetailDrawer.tsx';
import { MeasurementTable } from '../components/MeasurementTable.tsx';
import { ReportPreview } from '../components/ReportPreview.tsx';
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { useApi } from '../components/useApi.ts';
import { dateTime, metricLabel, metricValue, pct, period, signed } from '../format.ts';
import { currentLang, t } from '../i18n.ts';

interface MeasurementsResponse {
  run: MeasurementRun | null;
  measurements: Measurement[];
  analysisResults: AnalysisResult[];
}

export function MeasurementsPage() {
  const config = useApi<ConfigSummary>('/config');
  const runs = useApi<MeasurementRun[]>('/measurement-runs');
  const defaults = useApi<{ latestGa4Date: string | null }>('/measurements/defaults');
  const [runId, setRunId] = useState<number | null>(null);
  const [currentEnd, setCurrentEnd] = useState('');
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<unknown>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const data = useApi<MeasurementsResponse>(`/measurements${query({ runId })}`);

  useEffect(() => {
    if (!currentEnd && defaults.data?.latestGa4Date) setCurrentEnd(defaults.data.latestGa4Date);
  }, [defaults.data, currentEnd]);

  async function run() {
    setRunning(true);
    setRunError(null);
    try {
      const res = await postJson<{ run: MeasurementRun }>('/measurements/run', { currentEnd: currentEnd || undefined });
      setRunId(res.run.id);
      runs.reload();
      data.reload();
    } catch (e) {
      setRunError(e);
    } finally {
      setRunning(false);
    }
  }

  const current = data.data;
  return (
    <>
      {config.data && <RulesPanel config={config.data} />}

      <section className="card">
        <div className="card-head">
          <div>
            <h2>{t('Run measurements')}</h2>
            <div className="hint">{t('Week on week: current week ends on the selected date; previous week is the 7 days before it. OK / NG is calculated by the system.')}</div>
          </div>
        </div>
        <div className="card-body filters">
          <label className="field">
            {t('Current week ending')}
            <input type="date" value={currentEnd} onChange={(e) => setCurrentEnd(e.target.value)} />
          </label>
          <button className="btn primary" onClick={run} disabled={running}>{running ? t('Running…') : t('Run measurements')}</button>
          <span className="spacer" />
          {runs.data && runs.data.length > 0 && (
            <label className="field">
              {t('Show run')}
              <select value={current?.run?.id ?? ''} onChange={(e) => setRunId(Number(e.target.value))}>
                {runs.data.map((r) => (
                  <option key={r.id} value={r.id}>#{r.id} · {period(r.current)} vs {period(r.previous)} · {dateTime(r.createdAt)}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {runError != null && <div className="card-body" style={{ paddingTop: 0 }}><ErrorState error={runError} /></div>}
      </section>

      {data.error != null && <ErrorState error={data.error} onRetry={data.reload} />}
      {data.loading && !current && <LoadingState />}
      {current && !current.run && <EmptyState title="No measurement run yet.">{t('Choose the current week and press Run measurements.')}</EmptyState>}

      {current?.run && (
        <>
          <section className="card">
            <div className="card-head">
              <div>
                <h2>{t('Measurement results — run #{id}', { id: current.run.id })}</h2>
                <div className="hint">
                  {t('Current {current} vs previous {previous} · run {time}', { current: period(current.run.current), previous: period(current.run.previous), time: dateTime(current.run.createdAt) })}
                </div>
              </div>
              <div className="row">
                {(['OK', 'NG', 'NOT_EVALUABLE'] as const).map((s) => (
                  <span key={s} className="row small"><StatusBadge status={s} /> {current.measurements.filter((m) => m.status === s).length}</span>
                ))}
              </div>
            </div>
            <div className="card-body">
              <MeasurementTable rows={current.measurements} onDetail={(m) => setDetailId(m.id)} selectedId={detailId} />
              <div className="small muted" style={{ marginTop: 8 }}>
                {t('NG = significant change under the client rule (an SEO Anomaly is created). It does not mean the uploaded file is invalid.')}{' '}
                {t('NOT EVALUABLE = the rule could not be applied; the reason says why.')}
              </div>
            </div>
          </section>

          {current.run.issues.length > 0 && (
            <section className="card"><div className="card-body"><DataQualityWarnings issues={current.run.issues} title="Run warnings" /></div></section>
          )}

          <AnalysisResults rows={current.analysisResults} />
          <ReportSection runId={current.run.id} />
        </>
      )}

      {detailId !== null && <MeasurementDetailDrawer id={detailId} onClose={() => setDetailId(null)} onChanged={data.reload} />}
    </>
  );
}

function RulesPanel({ config }: { config: ConfigSummary }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>{t('Judgment rules (client: SEO.txt)')}</h2>
        <span className="hint">{t('Only these rules are evaluated. Edit thresholds in config/rules.yaml.')}</span>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <DataTable
          rows={config.rules}
          rowKey={(r) => r.id}
          columns={[
            { key: 'id', label: t('Rule'), render: (r) => <><span className="mono">{r.id}</span> {r.number}</> },
            { key: 'criteria', label: t('Judgment criteria'), render: (r) => r.criteria },
            { key: 'primary', label: t('Primary judgment'), render: (r) => <span className="small">{r.primaryJudgment}</span> },
            { key: 'next', label: t('What to check next'), render: (r) => <span className="small">{r.whatToCheckNext}</span> },
            { key: 'th', label: t('Threshold'), render: (r) => `±${r.thresholdValue ?? '?'} ${r.thresholdUnit === 'unresolved' ? '' : t(r.thresholdUnit === 'percent' ? '% (relative)' : 'percentage points')}` },
            { key: 'status', label: t('Configuration'), render: (r) => (r.thresholdUnit === 'unresolved' || r.thresholdValue === null ? <StatusBadge status="NOT_EVALUABLE" title={t('Unresolved')} /> : <StatusBadge status="Confirmed" />) },
          ]}
        />
        {config.unresolved.length > 0 && (
          <div className="notice warn">
            <strong>{t('Unresolved — waiting for the client ({n})', { n: config.unresolved.length })}</strong>
            <ul>{config.unresolved.map((u) => <li key={u.key}>{u.description}</li>)}</ul>
          </div>
        )}
      </div>
    </section>
  );
}

function AnalysisResults({ rows }: { rows: AnalysisResult[] }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>{t('Analysis results — current vs previous period')}</h2>
        <span className="hint">{t('Calculated values stored with this run.')}</span>
      </div>
      <div className="card-body">
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          columns={[
            { key: 'src', label: t('Source'), render: (r) => r.source },
            { key: 'subj', label: t('Subject'), render: (r) => <>{r.subjectKey} <span className="muted small">({r.subjectType})</span></> },
            { key: 'm', label: t('Metric'), render: (r) => metricLabel(r.metric) },
            { key: 'p', label: t('Previous'), num: true, render: (r) => metricValue(r.metric, r.previousValue) },
            { key: 'c', label: t('Current'), num: true, render: (r) => metricValue(r.metric, r.currentValue) },
            { key: 'a', label: t('Absolute change'), num: true, render: (r) => signed(r.metric, r.absoluteChange) },
            { key: 'r', label: t('Change rate'), num: true, render: (r) => pct(r.changeRate) },
            { key: 'n', label: t('Note'), render: (r) => <span className="small muted">{r.note}</span> },
          ]}
        />
      </div>
    </section>
  );
}

function ReportSection({ runId }: { runId: number }) {
  const [report, setReport] = useState<Report | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const lang = currentLang();
  // A report is generated in one language; switching language asks for a new one.
  useEffect(() => (setReport(null), setPreview(false)), [runId, lang]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      setReport(await postJson<Report>('/reports/generate', { runId }));
      setPreview(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (report) setReport(await api<Report>(`/reports/${report.id}`));
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{t('Report')}</h2>
          <div className="hint">{t('Weekly monitoring report generated from the database records of run #{id}.', { id: runId })}</div>
        </div>
        <div className="row">
          <button className="btn primary" onClick={generate} disabled={busy}>{busy ? t('Generating…') : t('Generate Report')}</button>
          <button className="btn" disabled={!report} onClick={() => (setPreview(!preview), refresh())}>{preview ? t('Hide Preview') : t('Preview Report')}</button>
          <a className={`btn${report ? '' : ' disabled'}`} href={report ? `/api/reports/${report.id}/download` : undefined} aria-disabled={!report} onClick={(e) => !report && e.preventDefault()} style={report ? undefined : { opacity: 0.5, pointerEvents: 'none' }}>
            {t('Download TXT')}
          </a>
        </div>
      </div>
      {error != null && <div className="card-body"><ErrorState error={error} /></div>}
      {report && preview && <div className="card-body"><ReportPreview report={report} /></div>}
      {!report && <div className="card-body small muted">{t('Generate the report to preview or download it.')}</div>}
    </section>
  );
}
