import type { Measurement, MeasurementDetail, MeasurementRun, SourceRef } from '@seo/shared';
import { Fragment, useState } from 'react';
import { metricValue, num, pct } from '../format.ts';
import { dataLabel, t } from '../i18n.ts';
import { DataTable } from './DataTable.tsx';
import { ErrorState, LoadingState } from './States.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { Icon, type IconName } from './Icon.tsx';
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

/** The result in a few words: OK — within threshold, NG — threshold exceeded, or not evaluable. */
const HEADLINE: Record<string, string> = { OK: 'OK — Within threshold', NG: 'NG — Threshold exceeded', NOT_EVALUABLE: 'Not evaluable' };

/** A measured value with its unit: "675,290 sessions", "0.877%". */
function measured(metric: string, v: number | null) {
  if (v === null) return '—';
  if (metric === 'sessions') return t('{n} sessions', { n: metricValue(metric, v) });
  return metric === 'cvr' || metric === 'ctr' ? `${metricValue(metric, v)}%` : metricValue(metric, v);
}

function ResultBadge({ status }: { status: string }) {
  if (status === 'NOT_EVALUABLE') return <span className="badge">{t('Not checked')}</span>;
  return <StatusBadge status={status} />;
}

/**
 * Measurements as rule checks (one row per rule and week). A row opens in place: the rule, the result,
 * the figures it was based on and — for NG — why (likely cause) and the suggested next step.
 */
export function RuleChecks({ run, rows, onReview }: { run: MeasurementRun; rows: Measurement[]; dataUsed: DataUsed[]; onReview: (id: number) => void }) {
  const [rule, setRule] = useState('');
  const [result, setResult] = useState<ResultFilter>('');
  const [open, setOpen] = useState<Set<number>>(() => new Set(rows.filter((m) => m.status === 'NG').map((m) => m.id)));
  const shown = rows.filter((m) => (!rule || m.ruleCode === rule) && (!result || m.status === result));
  const count = (s: string) => rows.filter((m) => m.status === s).length;
  const toggle = (id: number) => setOpen((o) => {
    const n = new Set(o);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const cards: { key: ResultFilter; cls: string; icon: IconName; label: string; n: number; sub: string }[] = [
    { key: '', cls: '', icon: 'gauge', label: t('Rule checks'), n: rows.length, sub: t('Week {current} vs {previous}', { current: span(run.current), previous: span(run.previous) }) },
    { key: 'NG', cls: 'ng', icon: 'x', label: 'NG', n: count('NG'), sub: t('Beyond the limit — anomaly created') },
    { key: 'OK', cls: 'ok', icon: 'check', label: 'OK', n: count('OK'), sub: t('Within the limit') },
    { key: 'NOT_EVALUABLE', cls: 'ne', icon: 'minus', label: t('NOT EVALUABLE'), n: count('NOT_EVALUABLE'), sub: t('Rule could not be applied (GA4 data missing)') },
  ];

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{t('Rule checks')} <span className="count">{t('{shown} of {total}', { shown: shown.length, total: rows.length })}</span></h2>
        </div>
        <div className="card-actions">
          <select value={rule} onChange={(e) => setRule(e.target.value)} aria-label={t('Rule')}>
            <option value="">{t('All rules')}</option>
            {[...new Set(rows.map((m) => m.ruleCode))].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={result} onChange={(e) => setResult(e.target.value as ResultFilter)} aria-label={t('Result')}>
            <option value="">{t('All results')}</option>
            <option value="NG">NG</option>
            <option value="OK">OK</option>
            <option value="NOT_EVALUABLE">{t('Not checked')}</option>
          </select>
        </div>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="status-cards" role="group" aria-label={t('Filter by result')}>
          {cards.map((c) => (
            <button key={c.key || 'all'} className={`status-card ${c.cls}`} aria-pressed={result === c.key} onClick={() => setResult(c.key)}>
              <span className="sc-icon"><Icon name={c.icon} size={13} /></span>
              <span className="sc-label">{c.label}</span>
              <span className="sc-count">{c.n}</span>
              <span className="sc-sub">{c.sub}</span>
            </button>
          ))}
        </div>
        <div className="table-wrap" style={{ maxHeight: 'none' }}>
          <table className="data rule-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}><span className="visually-hidden">{t('Detail')}</span></th>
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
                  <tr className={`clickable${open.has(m.id) ? ' selected' : ''}`} onClick={() => toggle(m.id)} aria-expanded={open.has(m.id)}>
                    <td><span className={`expand-toggle${open.has(m.id) ? ' open' : ''}`}><Icon name="chevronRight" size={16} /></span></td>
                    <td className="nowrap tabular">
                      {span(run.current)}
                      <span className="cell-sub">vs {span(run.previous)}</span>
                    </td>
                    <td><span className="badge info">{m.ruleCode}</span></td>
                    <td><strong>{m.name.replace(/^[①②③④⑤]\s*/, '')}</strong></td>
                    <td className="num">{metricValue(m.metric, m.previousValue)} → {metricValue(m.metric, m.currentValue)}</td>
                    <td className="num"><strong>{change(m.metric, m.changeRate, m.absoluteChange)}</strong></td>
                    <td className="num">{limit(m)}</td>
                    <td><span className={m.dataKind === 'test' ? 'badge warn' : 'badge ok'}>{m.dataKind === 'test' ? t('test') : t('real')}</span></td>
                    <td><ResultBadge status={m.status} /></td>
                  </tr>
                  {open.has(m.id) && (
                    <tr className="detail-row">
                      <td colSpan={9}>
                        <Expanded m={m} run={run} onReview={onReview} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {!shown.length && <div className="state">{t('No rule checks match the filters.')}</div>}
        </div>
      </div>
    </section>
  );
}

function Expanded({ m, run, onReview }: { m: Measurement; run: MeasurementRun; onReview: (id: number) => void }) {
  const [sources, setSources] = useState(false);
  return (
    <div className="detail-panel">
      <div className="detail-grid">
        <div className="detail-block">
          <span className="detail-label">{t('Rule')}</span>
          <div>{m.criteria}</div>
          <div className="small muted"><span className="mono">{m.ruleId}</span> · {t('Analysis unit')}: {m.analysisUnit}</div>
        </div>
        <div className="detail-block">
          <span className="detail-label">{t('Result')}</span>
          <div className="result-head"><ResultBadge status={m.status} /> <strong>{t(HEADLINE[m.status] ?? m.status)}</strong></div>
          <div>{m.reason}</div>
          {m.status !== 'NOT_EVALUABLE' && (
            <dl className="result-figures">
              <dt>{t('Previous week')} <span className="muted">({span(run.previous)})</span></dt><dd>{measured(m.metric, m.previousValue)}</dd>
              <dt>{t('Current week')} <span className="muted">({span(run.current)})</span></dt><dd>{measured(m.metric, m.currentValue)}</dd>
              <dt>{t('Change')}</dt><dd>{pct(m.changeRate, 2)}</dd>
              <dt>{t('Allowed threshold')}</dt><dd>{limit(m)}</dd>
            </dl>
          )}
          {m.caveats.length > 0 && <div className="small caveat">⚠ {m.caveats.join(' · ')}</div>}
        </div>
      </div>

      {m.dataKind === 'test' && (
        <div className="notice warn small" role="note">
          <strong>{t('TEST DATA')}</strong> — {t('This result uses dates the uploaded file marks as not real (test data). It is not a business result.')}
        </div>
      )}

      <div className="detail-block">
        <span className="detail-label">{t('Basis')}</span>
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

      {m.status === 'NG' && m.why && (
        <div className="detail-block">
          <span className="detail-label">{m.why.title}</span>
          <div className="detail-why">
            <div className="cause">
              <span className="detail-label">{t('Cause hypothesis')}</span>
              <div>{m.why.likelyCause}</div>
              {m.why.confidence && <div className="small secondary">{t('confidence')}: {t(m.why.confidence)} — {t('hypothesis, not confirmed')}</div>}
            </div>
            <div className="action">
              <span className="detail-label">{t('Proposed countermeasure')}</span>
              <div>{m.why.nextStep}</div>
            </div>
            {m.why.feedback && (
              <div className="feedback">
                <span className="detail-label">{m.why.team ? t('Feedback to {team}', { team: m.why.team }) : t('Feedback')}</span>
                <div>{m.why.feedback}</div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="row">
        <button className="btn link small" onClick={() => setSources(!sources)} aria-expanded={sources}>
          <Icon name={sources ? 'chevronDown' : 'chevronRight'} size={14} />
          {t('Source cells in the uploaded file')}
        </button>
        <span className="spacer" />
        <button className="btn small" onClick={() => onReview(m.id)}>
          <Icon name="search" size={14} />
          {m.status === 'NG' && m.why ? t('Evidence, GSC supporting evidence & SEO team review') : t('Evidence & detail')}
          <Icon name="arrowRight" size={14} />
        </button>
      </div>
      {sources && <SourceCells id={m.id} />}
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
