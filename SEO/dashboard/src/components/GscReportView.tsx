import type { GscOverview, GscReport } from '@seo/shared';
import { useEffect, useState } from 'react';
import { postJson, query } from '../api.ts';
import { dateTime, period } from '../format.ts';
import { currentLang, t } from '../i18n.ts';
import { scopeParam, type ImportContext } from '../context.ts';
import { Icon } from './Icon.tsx';
import { KPICard } from './KPICard.tsx';
import { ReportPreview } from './ReportPreview.tsx';
import { EmptyState, ErrorState, LoadingState } from './States.tsx';
import { useApi } from './useApi.ts';

function save(r: GscReport) {
  const url = URL.createObjectURL(new Blob([r.content], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = r.fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The standalone GSC Performance Report: built from the stored GSC data; no measurement run, no GA4 rules. */
export function GscReportView({ ctx, includeTest }: { ctx: ImportContext; includeTest: boolean }) {
  const uploadIds = scopeParam(ctx);
  const overview = useApi<GscOverview>(`/data/gsc-overview${query({ uploadIds, includeTestData: includeTest ? 1 : 0 })}`);
  const [report, setReport] = useState<GscReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const lang = currentLang();
  async function generate() {
    setBusy(true);
    setError(null);
    try {
      setReport(await postJson<GscReport>('/reports/gsc', { uploadIds: ctx.uploads }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => void generate(), [uploadIds, lang]);

  const o = overview.data;
  if (overview.error) return <ErrorState error={overview.error} onRetry={overview.reload} />;
  if (!o) return <LoadingState />;
  if (!o.uploads.length) return <EmptyState title={t('No Search Console data yet.')}>{t('Upload Search Console exports on the Data Import page to create the GSC Performance Report.')}</EmptyState>;
  const d = o.daily;
  const cmp = d.comparison;
  const kpi = (label: string, m: 'clicks' | 'impressions' | 'ctr' | 'position') => {
    const r = cmp?.rows.find((x) => x.metric === m);
    return <KPICard key={m} label={label} metric={m} current={d.totals[m]} previous={r?.previous ?? null} changeRate={r?.changeRate ?? null} absoluteChange={r?.absoluteChange ?? null} source={`GSC · ${d.range ? period(d.range) : ''}`} note={cmp ? t('Change: {current} vs {previous}', { current: period(cmp.current), previous: period(cmp.previous) }) : null} />;
  };
  return (
    <>
      <section className="card rp-header">
        <div className="rp-head-top">
          <div style={{ minWidth: 0 }}>
            <div className="rp-eyebrow">Google Search Console</div>
            <h2 className="rp-title">{t('GSC Performance Report')}</h2>
          </div>
          <div className="row report-actions">
            <button className="btn" onClick={() => void generate()} disabled={busy}><Icon name={busy ? 'loader' : 'refresh'} size={15} className={busy ? 'spin' : undefined} />{busy ? t('Generating…') : t('Regenerate')}</button>
            <button className="btn primary" disabled={!report} onClick={() => report && save(report)}><Icon name="download" size={16} />{t('Download TXT')}</button>
          </div>
        </div>
        <dl className="rp-meta fit">
          <div><dt><Icon name="calendar" size={13} />{t('Data coverage period')}</dt><dd>{d.range ? period(d.range) : t('unknown (no dates)')}</dd></div>
          <div><dt><Icon name="clock" size={13} />{t('Last generated')}</dt><dd>{report ? `${dateTime(report.generatedAt)} UTC` : '—'}</dd></div>
        </dl>
      </section>
      {d.available && <div className="grid kpis">{kpi(t('Clicks'), 'clicks')}{kpi(t('Impressions'), 'impressions')}{kpi(t('CTR'), 'ctr')}{kpi(t('Average position'), 'position')}</div>}
      {error != null && <ErrorState error={error} onRetry={() => void generate()} />}
      {busy && !report && <LoadingState lines={8} />}
      {report && <ReportPreview report={report} />}
    </>
  );
}
