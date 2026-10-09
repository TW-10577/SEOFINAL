import type { ComparisonRow, DataFilters, Ga4Overview, ImportedRow, Period, Series, Source, TopRow, Upload } from '@seo/shared';
import { WowCharts } from '../components/ReportSections.tsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { query } from '../api.ts';
import { BarChart, ChartCard, LineChart, SERIES_COLORS, SeriesTable, type ChartSeries } from '../components/ChartCard.tsx';
import { DataTable, ShowMore } from '../components/DataTable.tsx';
import { PeriodPicker, type SourcePeriods } from '../components/PeriodPicker.tsx';
import { useTestData } from '../components/TestData.tsx';
import { KPICard } from '../components/KPICard.tsx';
import { Ga4Dashboard } from '../components/Ga4Dashboard.tsx';
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx';
import { Icon } from '../components/Icon.tsx';
import { SectionTitle } from '../components/Header.tsx';
import { useApi } from '../components/useApi.ts';
import { compact, metricLabel, metricValue, num, pct, period, signed } from '../format.ts';
import { t } from '../i18n.ts';
import { defaultEnd, scopeParam, type ImportContext } from '../context.ts';
import { dataLabel } from '../i18n.ts';

interface Summary {
  periods: Record<Source, { current: Period; previous: Period } | null>;
  rows: ComparisonRow[];
}

interface TopResult {
  upload: { id: number; fileName: string; period: Period | null } | null;
  siteClicks: number | null;
  total: number;
  rows: TopRow[];
}


const TAB_DIM: Record<string, Dim> = { 'gsc-page': 'page', 'gsc-query': 'query', 'gsc-device': 'device', 'gsc-country': 'country', 'gsc-appearance': 'appearance' };

/** Current week ending on `end` and the 7 days before it (same rule as the API). */
function weekOf(end: string) {
  const day = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  return { current: { start: day(end, -6), end }, previous: { start: day(end, -13), end: day(end, -7) } };
}

/** The one source every imported file of the active context was detected as (upload metadata, never the file name); null for an empty or mixed context. */
function sharedSource(uploads: Upload[] | null, ids: number[]): Source | null {
  const sources = new Set((uploads ?? []).filter((u) => ids.includes(u.id) && u.importStatus === 'imported').map((u) => u.source));
  const [only] = sources;
  return sources.size === 1 && only ? only : null;
}

/**
 * Data of the active import context (the uploaded / selected files). The GA4 period comes from those files' own
 * data; changing it updates the context, so Measurements and Report follow. Without a context: all data, newest week.
 */
export function DataPage({ ctx, onCtx, onContinue, onShowAll, onGscReport }: { ctx: ImportContext; onCtx: (patch: Partial<ImportContext>) => void; onContinue: () => void; onShowAll: () => void; onGscReport: () => void }) {
  const uploadIds = scopeParam(ctx);
  const uploadId = ctx.uploads.length === 1 ? ctx.uploads[0] : undefined;
  const filters = useApi<DataFilters>(`/data/filters${query({ uploadIds })}`);
  // One file in the context: its details (source, structure, undated tabs).
  const focus = useApi<Upload>(uploadId ? `/uploads/${uploadId}` : null);
  const firstRow = useApi<{ rows: ImportedRow[] }>(uploadId ? `/data${query({ uploadId, limit: 1 })}` : null);
  // Periods are detected from the context's own data; each source defaults to its newest valid week.
  const [includeTest] = useTestData();
  const testParam = includeTest ? 1 : 0;
  const periods = useApi<Record<Source, SourcePeriods>>(`/periods${query({ uploadIds, includeTestData: testParam })}`);
  const ga4End = ctx.end ?? defaultEnd(periods.data?.GA4);
  // Carry the derived period in the context, so Measurements and Report use the same week.
  useEffect(() => {
    if (!ctx.end && ga4End && ctx.uploads.length) onCtx({ end: ga4End });
  }, [ctx.end, ga4End, ctx.uploads.length]);
  const setGa4End = (end: string | undefined) => onCtx({ end, run: undefined });
  // A period chosen with or without test data does not carry over to the other mode: derive it again.
  const firstTest = useRef(includeTest);
  useEffect(() => {
    if (firstTest.current === includeTest) return;
    firstTest.current = includeTest;
    onCtx({ end: undefined, run: undefined });
  }, [includeTest]);
  const [gscEnd, setGscEnd] = useState<string | undefined>();
  const [source, setSource] = useState<'' | Source>('');
  const [page, setPage] = useState('');
  const [q, setQ] = useState('');

  const summary = useApi<Summary>(`/data/summary${query({ ga4End, gscEnd, includeTestData: testParam, uploadIds })}`);
  // Week-on-week charts: the selected GA4 period (current week + the 7 days before), same files and test-data setting.
  const overview = useApi<Ga4Overview>(`/data/ga4-overview${query({ includeTestData: testParam, uploadIds })}`);
  const f = filters.data;
  const fu = uploadId ? focus.data : null;
  // The Source filter follows the active dataset: the detected source of the one file, or of all files when they share a source.
  const allUploads = useApi<Upload[]>('/uploads');
  const ctxSource = fu?.source ?? sharedSource(allUploads.data, ctx.uploads);
  useEffect(() => {
    if (ctxSource) setSource(ctxSource);
  }, [ctxSource]);
  // A period-total file (e.g. Search Console page / query tabs) has no dates: no week-on-week view for it.
  const undated = !!fu && !!firstRow.data && !firstRow.data.rows[0]?.dataDate;
  const tabDims = fu ? (fu.structure ?? '').split(', ').map((s) => TAB_DIM[s]).filter((d): d is Dim => !!d) : [];

  if (filters.error) return <ErrorState error={filters.error} onRetry={filters.reload} />;
  if (!f) return <LoadingState />;
  if (!f.sources.length)
    return <EmptyState title="No data imported yet.">Upload GA4 or Search Console exports on the Data Import page.</EmptyState>;

  // Fixed color per GA4 segment (entity), independent of filtering.
  // The site-total segment is not in the traffic-source list; it keeps the slot after the channels.
  const segColor = (s: string) => {
    const i = f.segments.indexOf(s);
    return SERIES_COLORS[(i < 0 ? f.segments.length : i) % SERIES_COLORS.length]!;
  };
  // Filters follow the selected source: each shows only what that source's data has.
  const showPage = source ? f.pageSources.includes(source) : f.pageSources.length > 0;
  const showQuery = source ? f.querySources.includes(source) : f.querySources.length > 0;
  function changeSource(next: '' | Source) {
    setSource(next);
    if (next && !f!.pageSources.includes(next)) setPage('');
    if (next && !f!.querySources.includes(next)) setQ('');
  }
  const showGa4 = source !== 'GSC' && !!f.dateRange.GA4;
  const showGsc = source !== 'GA4' && !!f.dateRange.GSC;
  // The GSC Performance Report button only while the active source is explicitly GSC: hidden for GA4, "All sources" and no dataset.
  const showGscReport = source === 'GSC' && f.sources.includes('GSC');
  const showContinue = f.sources.includes('GA4');

  return (
    <>
      <section className="card toolbar">
        {(ctx.uploads.length > 0 || showGscReport || showContinue) && (
          <div className="toolbar-row">
            <div className="context">
              {ctx.uploads.length > 0 && <button className="btn small ghost" onClick={onShowAll}>{t('Show all data')}</button>}
            </div>
            {(showGscReport || showContinue) && (
              <div className="row">
                {showGscReport && <button className="btn" onClick={onGscReport}><Icon name="report" size={15} />{t('GSC Performance Report')}</button>}
                {showContinue && <button className="btn primary" onClick={onContinue}>{t('Continue to Measurements')}<Icon name="arrowRight" size={16} /></button>}
              </div>
            )}
          </div>
        )}
        <div className="toolbar-row filters">
          {source !== 'GSC' && <PeriodPicker title={t('GA4 analysis period')} data={periods.data?.GA4} value={ga4End} onChange={setGa4End} hideSingle />}
          {source !== 'GA4' && f.sources.includes('GSC') && (
            <PeriodPicker
              title={t('Search Console analysis period')}
              data={periods.data?.GSC}
              value={gscEnd}
              onChange={setGscEnd}
            />
          )}
          <label className="field">
            {t('Source')}
            <select value={source} onChange={(e) => changeSource(e.target.value as Source | '')}>
              <option value="">{t('All sources')}</option>
              {f.sources.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {showPage && (
            <label className="field">
              {t('Page')}
              <input type="search" placeholder={t('URL contains…')} value={page} onChange={(e) => setPage(e.target.value)} />
            </label>
          )}
          {showQuery && (
            <label className="field">
              {t('Query')}
              <input type="search" placeholder={t('Query contains…')} value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
          )}
        </div>
      </section>
      {undated && (
        <div className="notice warn">
          {t('This file is a period total with no dates, so it has no week-on-week comparison or daily trend. Its ranking and records are shown below.')}
        </div>
      )}
      {uploadId && focus.error != null && <ErrorState error={focus.error} />}
      {summary.error != null && <ErrorState error={summary.error} />}
      {/* GA4: dataset overview → KPIs → traffic / CVR → traffic source → purchases + dataset health */}
      {!undated && showGa4 && (
        <Ga4Dashboard
          includeTest={includeTest}
          colorOf={segColor}
          uploadIds={uploadIds}
          comparison={ga4End && summary.data?.periods.GA4 ? { rows: summary.data.rows, ...summary.data.periods.GA4 } : null}
          beforeHealth={
            ga4End && periods.data?.GA4.range ? (
              <WowCharts weeks={weekOf(ga4End)} uploadIds={uploadIds} summary={summary.data ?? null} overview={overview.data ?? null} includeTest={includeTest} />
            ) : null
          }
        />
      )}
      {!undated && showGsc && (f.dateRange.GSC || f.pageSources.includes('GSC')) && (
        <SectionTitle title="Search performance" />
      )}
      {!undated && showGsc && summary.data && <Kpis summary={summary.data} source="GSC" />}
      {!undated && showGsc && (
        <div className="grid two">
          <Trend title="Clicks trend" subtitle="GSC daily chart" source="GSC" metric="clicks" uploadIds={uploadIds} colorOf={() => SERIES_COLORS[0]!} />
          <Trend title="Impressions trend" subtitle="GSC daily chart" source="GSC" metric="impressions" uploadIds={uploadIds} colorOf={() => SERIES_COLORS[0]!} />
          <Trend title="CTR trend" subtitle="GSC daily chart · Clicks ÷ Impressions × 100" source="GSC" metric="ctr" uploadIds={uploadIds} colorOf={() => SERIES_COLORS[0]!} format={(v) => `${v.toFixed(2)}%`} zeroBased={false} />
          <Trend title="Average position trend" subtitle="GSC daily chart · lower is better (drawn at the top)" source="GSC" metric="position" uploadIds={uploadIds} colorOf={() => SERIES_COLORS[0]!} format={(v) => v.toFixed(2)} zeroBased={false} invert />
        </div>
      )}
      {fu ? (
        tabDims.length > 0 && (
          <div className="grid two">
            {tabDims.map((d) => <TopPerformance key={d} dim={d} title={DIM_TITLE[d]} search={d === 'page' ? page : d === 'query' ? q : ''} uploadId={fu.id} />)}
          </div>
        )
      ) : (
        source !== 'GA4' && (f.pageSources.includes('GSC') || f.querySources.includes('GSC')) && (
          <div className="grid two">
            {f.pageSources.includes('GSC') && <TopPerformance dim="page" title="Page performance" search={page} uploadIds={uploadIds} />}
            {f.querySources.includes('GSC') && <TopPerformance dim="query" title="Query performance" search={q} uploadIds={uploadIds} />}
          </div>
        )
      )}
      <SectionTitle title="Data tables" />
      {!undated && summary.data && <Comparison summary={summary.data} source={source} />}
    </>
  );
}

function Kpis({ summary, source }: { summary: Summary; source: '' | Source }) {
  const pick = (src: Source, m: string) => summary.rows.find((r) => r.source === src && r.subjectType === 'site' && r.metric === m);
  const cards: { label: string; row: ComparisonRow }[] = [];
  const add = (label: string, src: Source, m: string) => {
    const r = pick(src, m);
    if (r && (source === '' || source === src)) cards.push({ label, row: r });
  };
  add('Sessions', 'GA4', 'sessions');
  add('Ecommerce purchases (used as CV — unconfirmed)', 'GA4', 'ecommerce_purchases');
  add('CVR', 'GA4', 'cvr');
  add('Clicks', 'GSC', 'clicks');
  add('Impressions', 'GSC', 'impressions');
  add('CTR', 'GSC', 'ctr');
  add('Average position', 'GSC', 'position');
  if (!cards.length) return null;
  return (
    <div className="grid kpis">
      {cards.map(({ label, row }) => {
        const p = summary.periods[row.source];
        return (
          <KPICard
            key={label}
            label={label}
            metric={row.metric}
            current={row.current}
            previous={row.previous}
            changeRate={row.changeRate}
            absoluteChange={row.absoluteChange}
            source={`${row.source} · ${p ? period(p.current) : ''}`}
            note={row.note}
          />
        );
      })}
    </div>
  );
}

/** Rows shown in the week-on-week comparison before "Show more". */
const COMPARISON_PREVIEW = 5;

function Comparison({ summary, source }: { summary: Summary; source: '' | Source }) {
  const rows = summary.rows.filter(
    (r) => (!source || r.source === source),
  );
  // First rows only until expanded; the full list stays loaded, so toggling never reloads data.
  const [showAllRows, setShowAllRows] = useState(false);
  const hidden = Math.max(0, rows.length - COMPARISON_PREVIEW);
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{t('Week-on-week comparison')} <span className="count">{rows.length}</span></h2>
          <div className="hint">
            {(['GA4', 'GSC'] as Source[]).filter((s) => summary.periods[s]).map((s) => t('{source}: current {current} vs previous {previous}', { source: s, current: period(summary.periods[s]!.current), previous: period(summary.periods[s]!.previous) })).join(' · ')}
          </div>
        </div>
      </div>
      <div className="card-body">
        <DataTable
          rows={showAllRows ? rows : rows.slice(0, COMPARISON_PREVIEW)}
          rowKey={(r) => `${r.source}|${r.subjectKey}|${r.metric}`}
          empty={t('No dated data for the selected filters. Undated GSC totals (query, page, device…) cannot be compared week on week.')}
          columns={[
            { key: 'src', label: t('Source'), render: (r) => r.source },
            { key: 'subject', label: t('Subject'), render: (r) => <>{dataLabel(r.subjectKey)}<span className="cell-sub">{r.subjectType}</span></> },
            { key: 'metric', label: t('Metric'), render: (r) => <span className="nowrap">{metricLabel(r.metric)}</span> },
            { key: 'prev', label: t('Previous'), num: true, render: (r) => metricValue(r.metric, r.previous) },
            { key: 'cur', label: t('Current'), num: true, render: (r) => <strong>{metricValue(r.metric, r.current)}</strong> },
            { key: 'abs', label: t('Absolute change'), num: true, render: (r) => signed(r.metric, r.absoluteChange) },
            { key: 'rate', label: t('Change rate'), num: true, render: (r) => <span className={r.changeRate == null || r.changeRate === 0 ? '' : r.changeRate > 0 ? 'trend-up' : 'trend-down'}>{pct(r.changeRate)}</span> },
            { key: 'note', label: t('Note'), className: 'cell-note', render: (r) => r.note || <span className="muted">—</span> },
          ]}
        />
        {hidden > 0 && (
          <div className="show-more">
            <ShowMore hidden={hidden} expanded={showAllRows} onToggle={() => setShowAllRows((v) => !v)} one="Show more (1 row)" many="Show more ({n} rows)" />
          </div>
        )}
      </div>
    </section>
  );
}

function Trend({ title, subtitle, source, metric, colorOf, format, zeroBased, invert, uploadIds }: {
  uploadIds?: string;
  title: string;
  subtitle: string;
  source: Source;
  metric: string;
  colorOf: (key: string) => string;
  format?: (v: number) => string;
  zeroBased?: boolean;
  invert?: boolean;
}) {
  const [includeTest] = useTestData();
  const res = useApi<Series[]>(`/data/trends${query({ source, metric, includeTestData: includeTest ? 1 : 0, uploadIds })}`);
  const series: ChartSeries[] = useMemo(() => (res.data ?? []).map((s) => ({ ...s, color: colorOf(s.key) })), [res.data, colorOf]);
  if (res.data && !res.data.length) return null; // no graph without data
  return (
    <ChartCard title={title} subtitle={subtitle} legend={series.map((s) => ({ label: s.label, color: s.color }))} table={<SeriesTable series={series} format={format} />}>
      {res.error ? <ErrorState error={res.error} /> : !res.data ? <LoadingState /> : <LineChart series={series} format={format} zeroBased={zeroBased} invert={invert} />}
    </ChartCard>
  );
}

type Dim = 'page' | 'query' | 'device' | 'country' | 'appearance';
const DIM_TITLE: Record<Dim, string> = { page: 'Page performance', query: 'Query performance', device: 'Device performance', country: 'Country performance', appearance: 'Search appearance performance' };
const DIM_LABEL: Record<Dim, string> = { page: 'Page', query: 'Query', device: 'Device', country: 'Country', appearance: 'Search appearance' };

function TopPerformance({ dim, title, search, uploadId, uploadIds }: { dim: Dim; title: string; search: string; uploadId?: number; uploadIds?: string }) {
  const res = useApi<TopResult>(`/data/top/${dim}${query({ limit: 10, search, uploadId, uploadIds })}`);
  if (res.error) return <ErrorState error={res.error} />;
  if (!res.data) return <LoadingState />;
  const d = res.data;
  if (!d.upload) return null;
  return (
    <ChartCard
      title={t('{title} — top 10 by clicks', { title: t(title) })}
      subtitle={t('GSC upload #{id} · {period} total · no WoW dimension', { id: d.upload.id, period: period(d.upload.period) })}
      table={
        <DataTable rows={d.rows} rowKey={(r) => r.key} columns={[
          { key: 'k', label: t(DIM_LABEL[dim]), render: (r) => <span style={{ wordBreak: 'break-all' }}>{dataLabel(r.key)}</span> },
          ...(dim === 'query' ? [{ key: 'c', label: t('Brand division'), render: (r: TopRow) => r.classification ?? '' }] : []),
          { key: 'cl', label: t('Clicks'), num: true, render: (r) => num(r.clicks) },
          { key: 'sh', label: t('Share'), num: true, render: (r) => (r.share === null ? '—' : `${r.share.toFixed(1)}%`) },
          { key: 'im', label: t('Impressions'), num: true, render: (r) => num(r.impressions) },
          { key: 'ctr', label: t('CTR'), num: true, render: (r) => (r.ctr === null ? '—' : `${r.ctr}%`) },
          { key: 'pos', label: t('Position'), num: true, render: (r) => (r.position === null ? '—' : r.position.toFixed(2)) },
        ]} />
      }
    >
      <BarChart
        rows={d.rows.map((r) => ({
          label: dim === 'page' ? r.key.replace(/^https?:\/\/[^/]+/, '') || '/' : r.key,
          value: r.clicks,
          detail: `${r.share === null ? '' : `${r.share.toFixed(1)}% of site clicks · `}CTR ${r.ctr ?? '—'}% · position ${r.position ?? '—'}${r.classification ? ` · ${r.classification} (provisional)` : ''}`,
        }))}
        format={(v) => compact(v)}
      />
    </ChartCard>
  );
}
