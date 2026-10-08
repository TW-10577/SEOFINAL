import type { Measurement, MeasurementDetail, MeasurementRun, SourceRef } from '@seo/shared';
import { Fragment, useState } from 'react';
import { metricValue, num, pct } from '../format.ts';
import { dataLabel, t } from '../i18n.ts';
import { DataTable } from './DataTable.tsx';
import { ErrorState, LoadingState } from './States.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { useApi } from './useApi.ts';

type ResultFilter = '' | 'NG' | 'OK' | 'NOT_EVALUABLE';
export interface DataUsed {
  uploadId: number;
  fileName: string;
  source: string | null;
  values: number;
  rules: string[];
}

/** 2026-09-17 → 17-09 */
const dm = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}`;
const span = (p: { start: string; end: string }) => `${dm(p.start)} – ${dm(p.end)}`;

/** Change of the judged figure: relative % (CVR also in percentage points). */
function change(metric: string, rate: number | null, abs: number | null) {
  if (metric === 'cvr') return <>{pct(rate)}<div className="small muted">{abs === null ? '' : `${abs > 0 ? '+' : ''}${abs.toFixed(3)} pt`}</div></>;
  return pct(rate, metric === 'sessions' ? 2 : 1);
}

function limit(m: Measurement) {
  if (m.thresholdValue === null) return '—';
  if (m.thresholdUnit === 'percent') return `±${m.thresholdValue}%`;
  if (m.thresholdUnit === 'percentage_points') return `±${m.thresholdValue} pt`;
  return <>±{m.thresholdValue}<div className="small caveat nowrap">{t('unit pending')}</div></>;
}

function ResultBadge({ status }: { status: string }) {
  if (status === 'NOT_EVALUABLE') return <span className="badge">{t('Not checked')}</span>;
  return <StatusBadge status={status} />;
}

/**
 * Measurements as rule checks (one row per rule and week). A row opens in place: the rule, the result,
 * the figures it was based on and — for NG — why (likely cause) and the suggested next step.
 */
export function RuleChecks({ run, rows, dataUsed, onReview }: { run: MeasurementRun; rows: Measurement[]; dataUsed: DataUsed[]; onReview: (id: number) => void }) {
  const [rule, setRule] = useState('');
  const [result, setResult] = useState<ResultFilter>('');
  const [open, setOpen] = useState<Set<number>>(() => new Set(rows.filter((m) => m.status === 'NG').map((m) => m.id)));
  const shown = rows.filter((m) => (!rule || m.ruleCode === rule) && (!result || m.status === result));
  const count = (s: string) => rows.filter((m) => m.status === s).length;
  const judged = dataUsed.filter((u) => u.source !== 'GSC');
  const evidence = dataUsed.filter((u) => u.source === 'GSC');
  const toggle = (id: number) => setOpen((o) => {
    const n = new Set(o);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  return (
    <section className="card">
      <div className="card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
        <h2>{t('Rule checks')}</h2>
        <select value={rule} onChange={(e) => setRule(e.target.value)}>
          <option value="">{t('All rules')}</option>
          {[...new Set(rows.map((m) => m.ruleCode))].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={result} onChange={(e) => setResult(e.target.value as ResultFilter)}>
          <option value="">{t('All results')}</option>
          <option value="NG">NG</option>
          <option value="OK">OK</option>
          <option value="NOT_EVALUABLE">{t('Not checked')}</option>
        </select>
        <span className="secondary">
          {t('{shown} of {total} · {ng} NG · {ok} OK · {nc} not checked', { shown: shown.length, total: rows.length, ng: count('NG'), ok: count('OK'), nc: count('NOT_EVALUABLE') })}
        </span>
      </div>
      <div className="card-body">
        {judged.length > 0 && (
          <div style={{ marginBottom: 6 }}>
            {t('Results for')} <strong>{judged.map((u) => u.fileName).join(', ')}</strong>
            {evidence.length > 0 && <span className="secondary"> · {t('Search Console evidence')}: {evidence.map((u) => u.fileName).join(', ')}</span>}.
          </div>
        )}
        <div className="secondary" style={{ marginBottom: 12 }}>
          {t('The current week is compared with the week before under rules {rules}, and the system decides:', { rules: [...new Set(rows.map((m) => m.ruleCode))].join(' and ') })}{' '}
          <StatusBadge status="NG" /> {t('a change went beyond the rule’s limit (an SEO anomaly is created),')}{' '}
          <StatusBadge status="OK" /> {t('the change stayed within the limit,')}{' '}
          <span className="badge">{t('Not checked')}</span> {t('the rule could not be applied (GA4 data missing).')}{' '}
          {t('Click a row for the basis.')}
        </div>
        <div className="table-wrap" style={{ maxHeight: 'none' }}>
          <table className="data">
            <thead>
              <tr>
                <th />
                <th>{t('Week')}</th>
                <th>{t('Rule')}</th>
                <th>{t('What is checked')}</th>
                <th className="num">{t('Before → After')}</th>
                <th className="num">{t('Change')}</th>
                <th className="num">{t('Limit')}</th>
                <th>{t('Data')}</th>
                <th>{t('Result')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <Fragment key={m.id}>
                  <tr className="clickable" onClick={() => toggle(m.id)}>
                    <td className="muted">{open.has(m.id) ? '▾' : '▸'}</td>
                    <td className="nowrap">
                      {span(run.current)}
                      <div className="small muted">vs {span(run.previous)}</div>
                    </td>
                    <td><span className="badge info">{m.ruleCode}</span></td>
                    <td>{m.name.replace(/^[①②③④⑤]\s*/, '')}</td>
                    <td className="num">{metricValue(m.metric, m.previousValue)} → {metricValue(m.metric, m.currentValue)}</td>
                    <td className="num"><strong>{change(m.metric, m.changeRate, m.absoluteChange)}</strong></td>
                    <td className="num">{limit(m)}</td>
                    <td><span className={m.dataKind === 'test' ? 'badge warn' : 'badge ok'}>{m.dataKind === 'test' ? t('test') : t('real')}</span></td>
                    <td><ResultBadge status={m.status} /></td>
                  </tr>
                  {open.has(m.id) && (
                    <tr>
                      <td />
                      <td colSpan={8} style={{ background: 'var(--surface-2)' }}>
                        <Expanded m={m} run={run} onReview={onReview} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {!shown.length && <div className="state">{t('No rule checks match the filters.')}</div>}
      </div>
    </section>
  );
}

function Expanded({ m, run, onReview }: { m: Measurement; run: MeasurementRun; onReview: (id: number) => void }) {
  const [sources, setSources] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '6px 4px 10px' }}>
      <div className="grid two">
        <div>
          <div className="small secondary" style={{ fontWeight: 600, textTransform: 'uppercase' }}>{t('Rule')}</div>
          <div>{m.criteria}</div>
          <div className="small muted">{m.ruleId} · {t('Analysis unit')}: {m.analysisUnit}</div>
        </div>
        <div>
          <div className="small secondary" style={{ fontWeight: 600, textTransform: 'uppercase' }}>{t('Result')}</div>
          <div><ResultBadge status={m.status} /> {m.reason}</div>
          {m.caveats.length > 0 && <div className="small caveat">⚠ {m.caveats.join(' · ')}</div>}
        </div>
      </div>

      <div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('Basis')}</div>
        <DataTable
          rows={m.basis}
          rowKey={(b) => b.label}
          columns={[
            { key: 'f', label: t('Figure'), render: (b) => (b.status ? <strong>{dataLabel(b.label)}</strong> : <span className="secondary">{dataLabel(b.label)}</span>) },
            { key: 'p', label: t('{week} week', { week: span(run.previous) }), num: true, render: (b) => metricValue(b.metric, b.previous) },
            { key: 'c', label: t('{week} week', { week: span(run.current) }), num: true, render: (b) => metricValue(b.metric, b.current) },
            { key: 'ch', label: t('Change'), num: true, render: (b) => <strong>{change(b.metric, b.changeRate, b.absoluteChange)}</strong> },
            { key: 'r', label: t('Result'), render: (b) => (b.status ? <ResultBadge status={b.status} /> : '') },
          ]}
        />
      </div>

      {m.why && (
        <div style={{ borderLeft: '3px solid var(--critical)', background: 'var(--surface)', padding: '10px 14px', borderRadius: 4 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{m.why.title}</div>
          <div>
            <strong>{t('Likely cause')}:</strong> {m.why.likelyCause}
            {m.why.confidence && <span className="small secondary"> ({t('confidence')}: {t(m.why.confidence)} — {t('hypothesis, not confirmed')})</span>}
          </div>
          <div style={{ marginTop: 4 }}>
            <strong>{t('Suggested next step')}:</strong> {m.why.nextStep}
          </div>
          {m.why.feedback && (
            <div style={{ marginTop: 4 }}>
              <strong>{m.why.team ? t('Feedback to {team}', { team: m.why.team }) : t('Feedback')}:</strong> {m.why.feedback}
            </div>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn link" onClick={() => setSources(!sources)}>{sources ? '▾' : '▸'} {t('Source cells in the uploaded file')}</button>
            <span className="spacer" />
            <button className="btn small" onClick={() => onReview(m.id)}>{t('GSC evidence & SEO team review →')}</button>
          </div>
          {sources && <SourceCells id={m.id} />}
        </div>
      )}
      {!m.why && (
        <div className="row">
          <button className="btn link" onClick={() => setSources(!sources)}>{sources ? '▾' : '▸'} {t('Source cells in the uploaded file')}</button>
        </div>
      )}
      {!m.why && sources && <SourceCells id={m.id} />}
    </div>
  );
}

/** The exact uploaded cells (file, row, date, segment, column, value) the result was calculated from. */
function SourceCells({ id }: { id: number }) {
  const res = useApi<MeasurementDetail>(`/measurements/${id}`);
  if (res.error) return <ErrorState error={res.error} />;
  if (!res.data) return <LoadingState />;
  const refs = res.data.sources;
  return (
    <div style={{ marginTop: 6 }}>
      <div className="small secondary">{t('{n} values used', { n: refs.length })}</div>
      <DataTable
        rows={refs.slice(0, 200)}
        rowKey={(r: SourceRef) => `${r.sourceRecordId}-${r.metricName}-${r.segment}`}
        columns={[
          { key: 'f', label: t('File'), render: (r) => `#${r.uploadId} ${r.fileName}` },
          { key: 'row', label: t('Row'), num: true, render: (r) => r.rowNumber },
          { key: 'd', label: t('Date'), render: (r) => r.dataDate ?? '—' },
          { key: 's', label: t('Segment / key'), render: (r) => dataLabel(r.segment ?? '—') },
          { key: 'm', label: t('Column'), render: (r) => r.metricName },
          { key: 'v', label: t('Value'), num: true, render: (r) => num(r.metricValue) },
        ]}
      />
    </div>
  );
}
