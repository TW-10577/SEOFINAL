import type { Countermeasure, GscInvestigation, GscShareRow, GscSupportingEvidence, Measurement, MeasurementDetail, MeasurementRun, Report } from '@seo/shared';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, postJson, query } from '../api.ts';
import { PAGE_ACTIONS_ID } from '../components/Header.tsx';
import { Icon } from '../components/Icon.tsx';
import { ReportPreview } from '../components/ReportPreview.tsx';
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { useApi } from '../components/useApi.ts';
import { dateTime, metricValue, num, pct, period, signed } from '../format.ts';
import { currentLang, dataLabel, t } from '../i18n.ts';
import { useContextRun, type ImportContext } from '../context.ts';
import { useTestData } from '../components/TestData.tsx';

/**
 * Report of one measurement run, read top to bottom as: what happened → what was observed → what evidence is
 * available → the possible cause → the recommended action. Every value comes from the run's stored records and
 * the generated report; nothing is recalculated here.
 */
export function ReportPage({ ctx, onCtx, onBack }: { ctx: ImportContext; onCtx: (patch: Partial<ImportContext>) => void; onBack: () => void }) {
  // The report follows the active import context: its run (created automatically when missing).
  const [includeTest] = useTestData();
  const cr = useContextRun(ctx, includeTest);
  const hasContext = ctx.uploads.length > 0 || !!ctx.end;
  const runs = { data: cr.runs };
  const data = useApi<{ run: MeasurementRun | null; measurements: Measurement[] }>(cr.runId ? `/measurements${query({ runId: cr.runId })}` : hasContext ? null : '/measurements');
  const onSelectRun = (id: number) => {
    const r = cr.runs?.find((x) => x.id === id);
    if (r) onCtx({ uploads: r.scope.uploadIds, end: r.current.end, run: r.id });
  };
  const run = data.data?.run ?? null;
  const measurements = data.data?.measurements ?? [];
  const ng = measurements.filter((m) => m.status === 'NG');
  const details = useDetails(ng);
  const report = useReport(run?.id ?? null);

  return (
    <>
      {data.error != null && <ErrorState error={data.error} onRetry={data.reload} />}
      {cr.error != null && <ErrorState error={cr.error} />}
      {((data.loading && !data.data) || cr.running || (hasContext && !cr.runId && cr.error == null)) && <LoadingState />}
      {data.data && !run && <EmptyState title={t('No measurement run yet.')}>{t('Run the measurements before generating a report.')}</EmptyState>}

      {run && (
        <>
          <ReportHeader run={run} runs={runs.data ?? []} report={report.report} onSelectRun={onSelectRun} onBack={onBack} />
          <ExecutiveSummary measurements={measurements} report={report.report} />
          <DetectedChanges rows={ng} />
          {ng.length > 0 && (
            <>
              <Investigation rows={ng} details={details} />
              <Causes rows={ng} details={details} />
              <Actions rows={ng} details={details} />
              <TeamFeedback rows={ng} details={details} />
            </>
          )}
          <ReportSection runId={run.id} state={report} />
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

// ---------- helpers ----------

/** An increase of the judged figure is a positive change: shown as such, never as a problem. */
const isPositive = (m: Measurement) => (m.changeRate ?? m.absoluteChange ?? 0) > 0;
const changeKind = (m: Measurement) => (isPositive(m) ? t('Significant Positive Change') : t('Significant Negative Change'));
const shortName = (m: Measurement) => m.name.replace(/^[①②③④⑤]\s*/, '');
const threshold = (m: Measurement) =>
  m.thresholdValue === null ? '—' : m.thresholdUnit === 'percentage_points' ? `±${m.thresholdValue} pt` : `±${m.thresholdValue}%`;
const stripTest = (s: string) => s.replace(/^Based on data the export marks as not real — not a business result\.\s*/, '').replace(/^エクスポートで実データではないとされたデータに基づく結果です — 業務上の結果ではありません。/, '');
const fmtFigure = (metric: string, v: number | null) => (metric === 'cvr' && v !== null ? v.toFixed(3) : metricValue(metric, v));

function Section({ n, title, hint, children, count }: { n: number; title: string; hint?: string; children: React.ReactNode; count?: number }) {
  return (
    <section className="card report-block">
      <div className="card-head">
        <div>
          <h2><span className="report-n">{n}</span>{title}{count !== undefined && <span className="count">{count}</span>}</h2>
          {hint && <div className="hint">{hint}</div>}
        </div>
      </div>
      <div className="card-body">{children}</div>
    </section>
  );
}

function DetailState({ details }: { details: Details }) {
  if (details.error != null) return <ErrorState error={details.error} />;
  if (details.loading) return <LoadingState lines={3} />;
  return null;
}

function ChangeTag({ m }: { m: Measurement }) {
  return <span className={`badge ${isPositive(m) ? 'ok' : 'ng'}`}>{isPositive(m) ? '↑' : '↓'} {changeKind(m)}</span>;
}

// ---------- 1. Report header ----------

function ReportHeader({ run, runs, report, onSelectRun, onBack }: { run: MeasurementRun; runs: MeasurementRun[]; report: Report | null; onSelectRun: (id: number) => void; onBack: () => void }) {
  const meta = report?.doc.meta;
  return (
    <section className="card ds-header">
      <div className="ds-title">
        <span className="ds-eyebrow">{t('Run #{id}', { id: run.id })}</span>
        <h2>{t('SEO Performance Report')}</h2>
        <span className="hint">{t('What happened → what was observed → what evidence is available → the possible cause → the recommended action.')}</span>
      </div>
      <div>
        <dl className="ds-meta">
          <div><dt>{t('Analysis period')}</dt><dd className="nowrap">{period(run.current)}</dd></div>
          <div><dt>{t('Compared with')}</dt><dd className="nowrap">{period(run.previous)}</dd></div>
          <div><dt>{t('Run number')}</dt><dd>#{run.id}</dd></div>
          <div><dt>{t('Report generated')}</dt><dd className="nowrap">{report ? dateTime(report.generatedAt) : '…'}</dd></div>
          <div className="wide"><dt>{t('Data source')}</dt><dd>{meta ? dataLabel(meta.dataSources.join(' · ')) : '…'}</dd></div>
        </dl>
        <div className="row" style={{ marginTop: 'var(--space-4)' }}>
          {runs.length > 0 && (
            <label className="field">
              {t('Show run')}
              <select value={run.id} onChange={(e) => onSelectRun(Number(e.target.value))}>
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>#{r.id} · {period(r.current)} vs {period(r.previous)} · {dateTime(r.createdAt)}</option>
                ))}
              </select>
            </label>
          )}
          <span className="spacer" />
          <button className="btn" onClick={onBack}>{t('← Back to Measurements')}</button>
        </div>
      </div>
    </section>
  );
}

// ---------- 2. Executive summary ----------

function ExecutiveSummary({ measurements, report }: { measurements: Measurement[]; report: Report | null }) {
  const n = (s: string) => measurements.filter((m) => m.status === s).length;
  const overall = n('NG') ? 'NG' : n('OK') ? 'OK' : 'NOT_EVALUABLE';
  const meta = report?.doc.meta;
  return (
    <section className="card exec">
      <div className="exec-overall">
        <div className="stat-label">{t('Overall result')}</div>
        <div><StatusBadge status={overall} /></div>
        <div className="stat-sub">{n('NG') ? t('{n} significant change(s) detected', { n: n('NG') }) : t('No significant change detected')}</div>
      </div>
      <div className="exec-counts">
        <div><div className="stat-label">{t('Evaluated')}</div><div className="stat-value">{n('OK') + n('NG')}</div>{n('NOT_EVALUABLE') > 0 && <div className="stat-sub">{t('{n} not evaluable', { n: n('NOT_EVALUABLE') })}</div>}</div>
        <div><div className="stat-label">OK</div><div className="stat-value">{n('OK')}</div></div>
        <div><div className="stat-label">{t('NG / significant change')}</div><div className="stat-value">{n('NG')}</div></div>
      </div>
      <div className="exec-finding">
        <div className="stat-label">{t('Key finding')}</div>
        <p>{meta ? dataLabel(meta.keyFinding) : '…'}</p>
      </div>
    </section>
  );
}

// ---------- 3. Detected changes ----------

function DetectedChanges({ rows }: { rows: Measurement[] }) {
  return (
    <Section n={3} title={t('Detected Changes / Anomalies')} count={rows.length} hint={t('Measurements beyond their rules.yaml threshold this week.')}>
      {rows.length === 0 ? (
        <div className="secondary">{t('No significant change detected.')}</div>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 'none' }}>
          <table className="data">
            <thead>
              <tr>
                <th>{t('Measurement')}</th>
                <th className="num">{t('Current')}</th>
                <th className="num">{t('Previous')}</th>
                <th className="num">{t('Change')}</th>
                <th className="num">{t('Threshold')}</th>
                <th>{t('Result')}</th>
                <th>{t('Why it was detected')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td><strong>{shortName(m)}</strong></td>
                  <td className="num">{fmtFigure(m.metric, m.currentValue)}</td>
                  <td className="num">{fmtFigure(m.metric, m.previousValue)}</td>
                  <td className="num"><strong>{pct(m.changeRate)}</strong>{m.metric !== 'cvr' && <div className="small muted">{signed(m.metric, m.absoluteChange)}</div>}</td>
                  <td className="num">{threshold(m)}</td>
                  <td><div className="row" style={{ gap: 6 }}><StatusBadge status={m.status} /><ChangeTag m={m} /></div></td>
                  <td className="small" style={{ minWidth: 260 }}>{stripTest(m.reason).split(/(?<=[.。])\s/)[0]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ---------- 4. Investigation ----------

function Investigation({ rows, details }: { rows: Measurement[]; details: Details }) {
  return (
    <Section n={4} title={t('Investigation')} hint={t('What was observed and which evidence is available. Nothing here is inferred beyond the uploaded data.')}>
      <DetailState details={details} />
      <div className="report-items">
        {rows.map((m) => {
          const d = details.byId[m.id];
          const c = d?.cause ?? null;
          const a = c?.analysis ?? null;
          const inv = a?.investigation ?? null;
          const observed = a?.facts[0] ?? c?.supportingEvidence.items[0]?.value ?? stripTest(m.reason);
          const review = [...(inv ? inv.checks.filter((k) => !k.available).map((k) => `${k.id}: ${k.reason ?? ''}`) : []), ...(a?.missing ?? [])];
          return (
            <div key={m.id} className="report-item">
              <div className="report-item-head"><strong>{shortName(m)}</strong><ChangeTag m={m} /></div>
              <dl className="kv">
                <dt>{t('Observed')}</dt>
                <dd>{observed}</dd>
              </dl>
              <h4 className="report-sub">{t('GA4 evidence')}</h4>
              <BasisTable m={m} />
              {(a?.gscEvidence || inv) && <h4 className="report-sub">{t('GSC evidence')}</h4>}
              {inv && <GscFindings inv={inv} />}
              {a?.gscEvidence && <GscSnapshots g={a.gscEvidence} />}
              {a?.gscEvidence && !inv?.checks.some((k) => k.available) && (
                <div className="small secondary">{t('Search Console exports for the two measured weeks are not uploaded, so query / page changes cannot be shown.')}</div>
              )}
              {review.length > 0 && (
                <>
                  <h4 className="report-sub">{t('Data to review to understand the reason')}</h4>
                  <ul className="report-list small">{review.map((x) => <li key={x}>{dataLabel(x)}</li>)}</ul>
                </>
              )}
              {inv?.matched ? (
                <div className="notice info">{t('GSC investigation indicates')}: <strong>{inv.cause}</strong> ({t('confidence')}: {inv.confidence})</div>
              ) : (
                <div className="notice warn"><strong>{t('Cause not conclusively determined from available data.')}</strong></div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function BasisTable({ m }: { m: Measurement }) {
  if (!m.basis.length) return <div className="small muted">—</div>;
  return (
    <div className="table-wrap" style={{ maxHeight: 'none' }}>
      <table className="data">
        <thead><tr><th>{t('Figure')}</th><th className="num">{t('Previous')}</th><th className="num">{t('Current')}</th><th className="num">{t('Change')}</th></tr></thead>
        <tbody>
          {m.basis.map((b) => (
            <tr key={b.label}>
              <td>{b.status ? <strong>{dataLabel(b.label)}</strong> : <span className="secondary">{dataLabel(b.label)}</span>}</td>
              <td className="num">{fmtFigure(b.metric, b.previous)}</td>
              <td className="num">{fmtFigure(b.metric, b.current)}</td>
              <td className="num">{pct(b.changeRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** GSC_R01: queries / pages with the largest clicks decrease, with clicks, impressions, CTR and position. */
function GscFindings({ inv }: { inv: GscInvestigation }) {
  const checks = inv.checks.filter((k) => k.available && k.affected.length);
  const two = (a: number | null, b: number | null, suffix = '') => (a === null || b === null ? '—' : `${a.toFixed(2)}${suffix} → ${b.toFixed(2)}${suffix}`);
  return (
    <>
      {inv.siteChanges.length > 0 && (
        <div className="small secondary" style={{ marginBottom: 8 }}>
          {t('Site (Chart by Date)')}: {inv.siteChanges.map((x) => `${x.metric} ${x.metric === 'position' ? two(x.previous, x.current) : pct(x.changeRate)}`).join(' · ')}
        </div>
      )}
      {checks.map((k) => (
        <div key={k.id} style={{ marginBottom: 10 }}>
          <div className="small secondary" style={{ marginBottom: 4 }}>{inv.ruleId} · {k.id} — {k.files.previous} → {k.files.current}</div>
          <div className="table-wrap" style={{ maxHeight: 'none' }}>
            <table className="data">
              <thead><tr><th>{k.source === 'page' ? t('Page') : k.source === 'query' ? t('Query') : t('Key')}</th><th className="num">{t('Clicks')}</th><th className="num">{t('Impressions change')}</th><th className="num">CTR</th><th className="num">{t('Position')}</th></tr></thead>
              <tbody>
                {k.affected.slice(0, 5).map((r) => (
                  <tr key={r.key}>
                    <td style={{ wordBreak: 'break-all' }}>{dataLabel(r.key)}</td>
                    <td className="num">{num(r.clicksPrevious)} → {num(r.clicksCurrent)}</td>
                    <td className="num">{r.impressionsChange > 0 ? '+' : ''}{num(r.impressionsChange)}</td>
                    <td className="num">{two(r.ctrPrevious, r.ctrCurrent, '%')}</td>
                    <td className="num">{two(r.positionPrevious, r.positionCurrent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {(inv.affectedDevice || inv.affectedSearchAppearance) && (
        <div className="small">{t('Concentrated on')}: {[inv.affectedDevice, inv.affectedSearchAppearance].filter(Boolean).map((x) => dataLabel(x!)).join(' · ')}</div>
      )}
    </>
  );
}

/** Uploaded Search Console snapshots: period totals for context — they show where clicks are, not what changed. */
function GscSnapshots({ g }: { g: GscSupportingEvidence }) {
  const parts = [
    { key: 'q', title: t('Top queries'), s: g.queries },
    { key: 'p', title: t('Top pages'), s: g.pages },
  ].filter((x) => x.s.available && x.s.top.length);
  const chart = g.dateChart;
  return (
    <>
      <div className="small secondary">
        {t('Chart by Date')}: {chart.available ? chart.metrics.map((m) => `${m.metric} ${m.metric === 'position' ? `${m.previous.toFixed(2)} → ${m.current.toFixed(2)}` : pct(m.changeRate)}`).join(' · ') : (chart.reason ?? t('not available for the measured weeks'))}
      </div>
      {parts.map((x) => (
        <div key={x.key}>
          <div className="small secondary" style={{ margin: '6px 0 4px' }}>{x.title} — {t('{period} total, not week on week', { period: period(x.s.upload?.period) })}</div>
          <div className="table-wrap" style={{ maxHeight: 'none' }}>
            <table className="data">
              <thead><tr><th>{x.key === 'q' ? t('Query') : t('Page')}</th><th className="num">{t('Clicks')}</th><th className="num">{t('Impressions')}</th><th className="num">CTR</th><th className="num">{t('Position')}</th></tr></thead>
              <tbody>
                {x.s.top.slice(0, 3).map((r: GscShareRow) => (
                  <tr key={r.key}>
                    <td style={{ wordBreak: 'break-all' }}>{dataLabel(r.key)}</td>
                    <td className="num">{num(r.clicks)}</td>
                    <td className="num">{num(r.impressions)}</td>
                    <td className="num">{r.ctr === null ? '—' : `${r.ctr}%`}</td>
                    <td className="num">{r.position === null ? '—' : r.position.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}

// ---------- 5. Cause ----------

function Causes({ rows, details }: { rows: Measurement[]; details: Details }) {
  return (
    <Section n={5} title={t('Cause')} hint={t('A rule match shows the pattern in the numbers, not the business reason. The cause stays a hypothesis until the SEO team confirms it.')}>
      <DetailState details={details} />
      <div className="report-items">
        {rows.map((m) => {
          const c = details.byId[m.id]?.cause ?? null;
          const a = c?.analysis ?? null;
          const inv = a?.investigation ?? null;
          const text = c ? (c.amendments.length || !a ? c.causeText : a.title) : (m.why?.likelyCause ?? m.causeSummary);
          const evidence = a?.facts.slice(0, 2) ?? c?.supportingEvidence.items.slice(0, 2).map((i) => i.value) ?? [];
          return (
            <div key={m.id} className="report-item">
              <div className="report-item-head"><strong>{shortName(m)}</strong></div>
              <dl className="kv">
                <dt>{c?.reviewStatus === 'Confirmed' ? t('Confirmed cause') : t('Possible cause')}</dt>
                <dd><strong>{text ?? '—'}</strong></dd>
                {evidence.length > 0 && (<><dt>{t('Supporting evidence')}</dt><dd><ul className="report-list">{evidence.map((x) => <li key={x}>{x}</li>)}</ul></dd></>)}
                {c && (
                  <>
                    <dt>{t('Rule-match confidence')}</dt>
                    <dd><StatusBadge status={c.confidence} /> <span className="small muted">{t('calculation: the GA4 values match the rules.yaml pattern')}</span></dd>
                    <dt>{t('Cause confidence')}</dt>
                    <dd>{inv?.matched ? <><strong>{inv.confidence}</strong> <span className="small muted">— {inv.ruleId}</span></> : <span className="secondary">{t('Not determined — hypothesis until the SEO team reviews the evidence')}</span>}</dd>
                    <dt>{t('Review status')}</dt>
                    <dd><StatusBadge status={c.reviewStatus} /></dd>
                  </>
                )}
              </dl>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ---------- 6. Actions ----------

function Actions({ rows, details }: { rows: Measurement[]; details: Details }) {
  const items = rows.flatMap((m) => (details.byId[m.id]?.countermeasures ?? []).map((k) => ({ m, k })));
  return (
    <Section n={6} title={t('Recommended Action / Countermeasure')} count={items.length} hint={t('Positive changes get a recommended action; negative changes get a countermeasure. Only the SEO team approves or carries them out.')}>
      <DetailState details={details} />
      {!details.loading && items.length === 0 ? (
        <div className="secondary">{t('No action proposed.')}</div>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 'none' }}>
          <table className="data">
            <thead>
              <tr>
                <th>{t('Type')}</th>
                <th>{t('Action')}</th>
                <th>{t('Target')}</th>
                <th>{t('Responsible team')}</th>
                <th>{t('Approval status')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(({ m, k }) => (
                <tr key={k.id}>
                  <td className="nowrap">
                    <span className={`badge ${isPositive(m) ? 'ok' : 'info'}`}>{isPositive(m) ? t('Recommended Action') : t('Countermeasure')}</span>
                    <div className="small muted" style={{ marginTop: 4 }}>{shortName(m)}</div>
                  </td>
                  <td style={{ minWidth: 280 }}><strong>{k.actionText}</strong>{isInvestigation(k) && <div className="small muted">{k.reason.split(':')[0]}</div>}</td>
                  <td className="small">{dataLabel(k.target)}</td>
                  <td>{k.responsibleTeam ?? <span className="muted">{t('not assigned')}</span>}</td>
                  <td><StatusBadge status={k.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/** Countermeasures added by an investigation rule carry its id and finding as their reason (not team feedback). */
const isInvestigation = (k: Countermeasure) => /^GSC_R\d+/.test(k.reason);

// ---------- 7. Team feedback ----------

function TeamFeedback({ rows, details }: { rows: Measurement[]; details: Details }) {
  const items = rows.flatMap((m) => (details.byId[m.id]?.countermeasures ?? []).filter((k) => k.reason && !isInvestigation(k)).map((k) => ({ m, k })));
  return (
    <Section n={7} title={t('Team Feedback')} hint={t('The feedback rules.yaml defines for the matched result, addressed to the assigned team.')}>
      {items.length === 0 ? (
        <div className="secondary">{t('No team feedback for this run.')}</div>
      ) : (
        <div className="feedback-list">
          {items.map(({ m, k }) => (
            <div key={k.id} className="feedback">
              <div className="feedback-team">{k.responsibleTeam ?? t('No team assigned')}</div>
              <div>
                <div className="small muted">{shortName(m)}</div>
                <div>{k.reason}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
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

/**
 * Page actions in the header: Download TXT and Report Preview. The preview opens in a side panel; Download
 * saves exactly the previewed text.
 */
function ReportSection({ runId, state }: { runId: number; state: ReportState }) {
  const { report, busy, error, generate } = state;
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => setTarget(document.getElementById(PAGE_ACTIONS_ID)), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  async function download() {
    const r = report ?? (await generate());
    if (r) saveTxt(r);
  }
  const title = t('Weekly monitoring report generated from the database records of run #{id}.', { id: runId });
  const downloadButton = (
    <button className="btn primary" onClick={download} disabled={busy} title={title}>
      <Icon name={busy ? 'loader' : 'upload'} size={16} className={busy ? 'spin' : 'flip'} />
      {t('Download TXT')}
    </button>
  );
  const actions = (
    <div className="row">
      <button className="btn" onClick={() => setOpen(true)} title={title}>
        <Icon name="report" size={16} />
        {t('Report Preview')}
      </button>
      {downloadButton}
    </div>
  );
  return (
    <>
      {target ? createPortal(actions, target) : null}
      {open && (
        <>
          <div className="drawer-backdrop" onClick={() => setOpen(false)} />
          <aside className="drawer" role="dialog" aria-modal="true" aria-label={t('Report Preview')}>
            <div className="drawer-head">
              <Icon name="report" size={18} />
              <h2>{t('Report Preview')}</h2>
              <span className="hint small muted">#{runId}</span>
              <span className="spacer" />
              <button className="btn" onClick={() => void generate()} disabled={busy}>{busy ? t('Generating…') : t('Regenerate')}</button>
              {downloadButton}
              <button className="btn icon ghost" onClick={() => setOpen(false)} aria-label={t('Close')}><Icon name="x" size={16} /></button>
            </div>
            <div className="drawer-body">
              <div className="small muted">{t('The downloaded TXT contains exactly these sections and values.')}</div>
              {error != null && <ErrorState error={error} />}
              {busy && !report && <LoadingState lines={8} />}
              {report && <ReportPreview report={report} />}
            </div>
          </aside>
        </>
      )}
    </>
  );
}
