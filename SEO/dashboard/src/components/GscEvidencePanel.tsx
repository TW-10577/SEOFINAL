import type { GscShareRow, GscSnapshot, GscSupportingEvidence, MeasurementDetail } from '@seo/shared';
import { num, pct, period } from '../format.ts';
import { DataTable } from './DataTable.tsx';
import { dataLabel, t } from '../i18n.ts';

const METRIC: Record<string, string> = { clicks: 'Clicks', impressions: 'Impressions', ctr: 'CTR (%)', position: 'Avg. position' };
const DIRECTION: Record<string, string> = { down: '↓', up: '↑', same: '→ same', worse: '↓ worse', better: '↑ better' };

/**
 * Search Console supporting evidence for M1 (rule ①), shown only when M1 is NG and organic traffic
 * decreased. Never a measurement: GSC has no OK / NG. Chart by Date is the only week-on-week comparison;
 * pages, queries, devices and countries are period-total snapshots.
 */
export function GscEvidencePanel({ detail }: { detail: MeasurementDetail }) {
  const g = detail.cause?.analysis?.gscEvidence;
  return (
    <section className="card">
      <div className="card-head">
        <h2>{t('GSC Supporting Evidence')}</h2>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!g ? (
          <div className="secondary">{t('GSC is used only when M1 is NG and organic traffic decreased.')} {notUsedReason(detail)}</div>
        ) : (
          <>
            <DateChart g={g} />
            <Snapshot n={2} title={t('Pages — important pages')} s={g.pages} keyLabel={t('Page')} bottom />
            <Snapshot
              n={3}
              title={t('Queries — major queries')}
              s={g.queries}
              keyLabel={t('Query')}
              bottom
              extra={g.queries.brandShare !== null ? <>{t('Brand share of query clicks')}: <strong>{g.queries.brandShare}%</strong>{g.queries.brandCaveat && <span className="caveat"> ⚠ {g.queries.brandCaveat}</span>}</> : null}
            />
            <Distribution n={4} title={t('Devices — distribution')} s={g.devices} />
            <Distribution n={5} title={t('Countries — distribution')} s={g.countries} />
            <div className="small muted">{g.note}</div>
          </>
        )}
      </div>
    </section>
  );
}

function notUsedReason(d: MeasurementDetail): string {
  if (d.rule.metric !== 'sessions') return t('Rule ② uses GA4 only (Search Console has no sessions or CV).');
  if (d.measurement.status !== 'NG') return t('M1 is not NG in this run.');
  return t('Organic traffic did not decrease in this run.');
}

function DateChart({ g }: { g: GscSupportingEvidence }) {
  const d = g.dateChart;
  return (
    <div>
      <h3 className="sub">1. {t('Chart by Date — current week vs previous week')}</h3>
      {d.reason && <div className="caveat small">⚠ {d.reason}</div>}
      {d.reference && d.periods && (
        <div className="small secondary">{t('Reference only — latest chart weeks {period}; not used in the cause.', { period: `${d.periods.previous.start} – ${d.periods.current.end}` })}</div>
      )}
      {d.available && d.periods && <div className="small secondary">{t('Current {current} vs previous {previous}', { current: period(d.periods.current), previous: period(d.periods.previous) })}</div>}
      {d.metrics.length > 0 && (
        <DataTable
          rows={d.metrics}
          rowKey={(m) => m.metric}
          columns={[
            { key: 'm', label: t('Metric'), render: (m) => t(METRIC[m.metric]!) },
            { key: 'p', label: t('Previous'), num: true, render: (m) => fmt(m.metric, m.previous) },
            { key: 'c', label: t('Current'), num: true, render: (m) => fmt(m.metric, m.current) },
            { key: 'ch', label: t('Change'), num: true, render: (m) => (m.metric === 'position' ? `${m.change > 0 ? '+' : ''}${m.change.toFixed(2)}` : pct(m.changeRate)) },
            { key: 'd', label: '', render: (m) => <strong className={m.direction === 'down' || m.direction === 'worse' ? 'caveat' : ''}>{t(DIRECTION[m.direction]!)}</strong> },
          ]}
        />
      )}
      {d.summary && <div style={{ marginTop: 6, fontWeight: 600 }}>{d.summary}</div>}
      {d.indicationText && <div>{d.indicationText}</div>}
      {!d.available && <div className="small secondary" style={{ marginTop: 4 }}>{t('Upload the Search Console Chart by Date (daily) export that covers both measured weeks.')}</div>}
    </div>
  );
}

const fmt = (metric: string, v: number) => (metric === 'ctr' || metric === 'position' ? v.toFixed(2) : num(v));

function SnapshotHead({ n, title, s }: { n: number; title: string; s: GscSnapshot }) {
  return (
    <>
      <h3 className="sub">{n}. {title} <span className="muted small">({t('snapshot — no dates')})</span></h3>
      {!s.available && <div className="small secondary">{s.reason}</div>}
      {s.upload && <div className="small muted">#{s.upload.id} {s.upload.fileName}</div>}
    </>
  );
}

function rowsTable(rows: GscShareRow[], keyLabel: string, withClass: boolean) {
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.key}
      columns={[
        { key: 'k', label: keyLabel, render: (r) => <span style={{ wordBreak: 'break-all' }}>{dataLabel(r.key)}</span> },
        ...(withClass ? [{ key: 'b', label: t('Classification'), render: (r: GscShareRow) => r.classification ?? '' }] : []),
        { key: 'c', label: t('Clicks'), num: true, render: (r) => num(r.clicks) },
        { key: 's', label: t('Share'), num: true, render: (r) => (r.share === null ? '—' : `${r.share}%`) },
        { key: 'i', label: t('Impressions'), num: true, render: (r) => num(r.impressions) },
        { key: 'ctr', label: 'CTR', num: true, render: (r) => (r.ctr === null ? '—' : `${r.ctr}%`) },
        { key: 'p', label: t('Position'), num: true, render: (r) => (r.position === null ? '—' : r.position.toFixed(2)) },
      ]}
    />
  );
}

function Snapshot({ n, title, s, keyLabel, bottom, extra }: { n: number; title: string; s: GscSnapshot; keyLabel: string; bottom?: boolean; extra?: React.ReactNode }) {
  const withClass = s.top.some((r) => r.classification);
  return (
    <div>
      <SnapshotHead n={n} title={title} s={s} />
      {s.available && (
        <>
          {extra && <div className="small" style={{ margin: '4px 0' }}>{extra}</div>}
          <div className="small secondary">{t('Highest')}</div>
          {rowsTable(s.top, keyLabel, withClass)}
          {bottom && s.bottom.length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary className="small secondary">{t('Lowest')}</summary>
              {rowsTable(s.bottom, keyLabel, withClass)}
            </details>
          )}
          {s.note && <div className="small muted" style={{ marginTop: 4 }}>{s.note}</div>}
        </>
      )}
    </div>
  );
}

/** Device / country split as share bars (clicks share; impressions share alongside). */
function Distribution({ n, title, s }: { n: number; title: string; s: GscSnapshot }) {
  const rows = [...s.top, ...(s.other ? [s.other] : [])];
  return (
    <div>
      <SnapshotHead n={n} title={title} s={s} />
      {s.available && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
            {rows.map((r) => (
              <div key={r.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 160px) 1fr 150px', gap: 8, alignItems: 'center' }} className="small">
                <span>{dataLabel(r.key)}</span>
                <span style={{ background: 'var(--surface-2)', borderRadius: 4, height: 10, overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${Math.min(100, r.share ?? 0)}%`, background: 'var(--brand-700)', borderRadius: 4 }} />
                </span>
                <span className="nowrap secondary">
                  {r.share === null ? '—' : `${r.share}%`} {t('clicks')} · {r.impressionsShare == null ? '—' : `${r.impressionsShare}%`} {t('impr.')}
                </span>
              </div>
            ))}
          </div>
          {s.note && <div className="small muted" style={{ marginTop: 4 }}>{s.note}</div>}
        </>
      )}
    </div>
  );
}
