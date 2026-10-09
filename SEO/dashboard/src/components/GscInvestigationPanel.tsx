import type { GscInvestigation, GscMetricChange } from '@seo/shared';
import { num, pct } from '../format.ts';
import { dataLabel, t } from '../i18n.ts';
import { DataTable } from './DataTable.tsx';

const CONFIDENCE: Record<GscInvestigation['confidence'], { cls: string; label: string }> = {
  high: { cls: 'ok', label: 'High' },
  medium: { cls: 'info', label: 'Medium' },
  low: { cls: 'warn', label: 'Low' },
  insufficient_data: { cls: '', label: 'Insufficient data' },
};

const METRIC: Record<GscMetricChange['metric'], string> = { clicks: 'Clicks', impressions: 'Impressions', ctr: 'CTR', position: 'Avg. position' };

function changeText(m: GscMetricChange) {
  if (m.metric === 'position') return `${m.previous.toFixed(2)} → ${m.current.toFixed(2)}`;
  if (m.metric === 'ctr') return `${m.previous.toFixed(2)}% → ${m.current.toFixed(2)}%`;
  return `${num(m.previous)} → ${num(m.current)} (${pct(m.changeRate)})`;
}

/**
 * rules.yaml GSC_R01: runs when GA4_R01 is NG with organic sessions decreasing. Shows each check (query, page,
 * device, search appearance) on the two measured weeks, the matched cause and the mapped countermeasure.
 */
export function GscInvestigationPanel({ inv }: { inv: GscInvestigation }) {
  const conf = CONFIDENCE[inv.confidence];
  return (
    <section className="card">
      <div className="card-head">
        <h2>{inv.ruleId} · {inv.name}</h2>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <dl className="kv">
          <dt>{t('Possible cause')}</dt>
          <dd><strong>{inv.cause}</strong></dd>
          <dt>{t('Matched condition')}</dt>
          <dd className="mono small">{inv.matched ?? t('none (fallback)')}</dd>
          <dt>{t('Confidence')}</dt>
          <dd><span className={`badge ${conf.cls}`}>{t(conf.label)}</span></dd>
          <dt>{t('Countermeasure')}</dt>
          <dd>{inv.countermeasure} <span className="small muted">({inv.countermeasureKey})</span></dd>
          {inv.affectedQueries.length > 0 && (<><dt>{t('Affected queries')}</dt><dd>{inv.affectedQueries.slice(0, 5).join(', ')}</dd></>)}
          {inv.affectedPages.length > 0 && (<><dt>{t('Affected pages')}</dt><dd className="small">{inv.affectedPages.slice(0, 5).join(', ')}</dd></>)}
          {inv.affectedDevice && (<><dt>{t('Affected device')}</dt><dd>{dataLabel(inv.affectedDevice)}</dd></>)}
          {inv.affectedSearchAppearance && (<><dt>{t('Affected search appearance')}</dt><dd>{dataLabel(inv.affectedSearchAppearance)}</dd></>)}
        </dl>

        {inv.siteChanges.length > 0 && (
          <div className="small secondary">
            <strong>{t('Site (Chart by Date)')}:</strong> {inv.siteChanges.map((m) => `${t(METRIC[m.metric])} ${changeText(m)}`).join(' · ')}
          </div>
        )}

        {inv.checks.map((c) => (
          <div key={c.id} className="facts">
            <div className="row" style={{ marginBottom: 6 }}>
              <strong>{c.id}</strong>
              <span className={`badge ${c.available ? 'ok' : ''}`}>{c.available ? t('Checked') : t('Not checked')}</span>
              {c.available && <span className="small muted">{c.files.previous} → {c.files.current}</span>}
            </div>
            {c.reason && <div className="small secondary">{c.reason}</div>}
            {c.available && (
              <>
                <div className="small" style={{ margin: '4px 0' }}>{c.totals.map((m) => `${t(METRIC[m.metric])} ${changeText(m)}`).join(' · ')}</div>
                {c.interpretations.length > 0 && <ul className="small" style={{ margin: '4px 0', paddingLeft: 18 }}>{c.interpretations.map((x) => <li key={x}>{x}</li>)}</ul>}
                {c.affected.length > 0 && (
                  <DataTable
                    rows={c.affected}
                    rowKey={(r) => r.key}
                    columns={[
                      { key: 'k', label: t('Key'), render: (r) => dataLabel(r.key) },
                      { key: 'c', label: t('Clicks'), num: true, render: (r) => `${num(r.clicksPrevious)} → ${num(r.clicksCurrent)}` },
                      { key: 'ch', label: t('Change'), num: true, render: (r) => num(r.clicksChange) },
                      { key: 's', label: t('Share of decrease'), num: true, render: (r) => (r.share == null ? '—' : `${r.share.toFixed(1)}%`) },
                      { key: 'i', label: t('Impressions change'), num: true, render: (r) => num(r.impressionsChange) },
                      { key: 'p', label: t('Avg. position'), num: true, render: (r) => (r.positionPrevious == null || r.positionCurrent == null ? '—' : `${r.positionPrevious.toFixed(2)} → ${r.positionCurrent.toFixed(2)}`) },
                    ]}
                  />
                )}
              </>
            )}
          </div>
        ))}

        {inv.definitions.length > 0 && (
          <details className="small secondary">
            <summary>{t('How the signals are read')}</summary>
            <ul style={{ margin: '4px 0', paddingLeft: 18 }}>{inv.definitions.map((x) => <li key={x}>{x}</li>)}</ul>
          </details>
        )}
      </div>
    </section>
  );
}
