import type { ComparisonRow, DataFilters, ImportedRow, Period, Series, Source, TopRow } from '@seo/shared';
import { useEffect, useMemo, useState } from 'react';
import { query } from '../api.ts';
import { BarChart, ChartCard, LineChart, SERIES_COLORS, SeriesTable, type ChartSeries } from '../components/ChartCard.tsx';
import { DataTable, Pager } from '../components/DataTable.tsx';
import { KPICard } from '../components/KPICard.tsx';
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx';
import { useApi } from '../components/useApi.ts';
import { compact, metricLabel, metricValue, num, pct, period, signed } from '../format.ts';
import { t } from '../i18n.ts';

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

const LIMIT = 100;

export function DataPage({ onContinue }: { onContinue: () => void }) {
  const filters = useApi<DataFilters>('/data/filters');
  const [currentEnd, setCurrentEnd] = useState('');
  const [source, setSource] = useState<'' | Source>('');
  const [segment, setSegment] = useState('');
  const [page, setPage] = useState('');
  const [q, setQ] = useState('');
  const [metric, setMetric] = useState('');

  const summary = useApi<Summary>(`/data/summary${query({ currentEnd })}`);
  const f = filters.data;

  if (filters.error) return <ErrorState error={filters.error} onRetry={filters.reload} />;
  if (!f) return <LoadingState />;
  if (!f.sources.length)
    return <EmptyState title="No data imported yet.">Upload GA4 or Search Console exports on the Data Import page.</EmptyState>;

  // Fixed color per GA4 segment (entity), independent of filtering.
  const segColor = (s: string) => SERIES_COLORS[f.segments.indexOf(s) % SERIES_COLORS.length]!;
  const showGa4 = source !== 'GSC' && !!f.dateRange.GA4;
  const showGsc = source !== 'GA4' && !!f.dateRange.GSC;

  return (
    <>
      <section className="card">
        <div className="card-body filters">
          <label className="field">
            {t('Analysis period — current week ending')}
            <input type="date" value={currentEnd} onChange={(e) => setCurrentEnd(e.target.value)} />
          </label>
          <label className="field">
            {t('Source')}
            <select value={source} onChange={(e) => setSource(e.target.value as Source | '')}>
              <option value="">{t('All sources')}</option>
              {f.sources.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="field">
            {t('Traffic source (GA4 segment)')}
            <select value={segment} onChange={(e) => setSegment(e.target.value)}>
              <option value="">{t('All segments')}</option>
              {f.segments.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {f.hasPages && (
            <label className="field">
              {t('Page')}
              <input type="search" placeholder={t('URL contains…')} value={page} onChange={(e) => setPage(e.target.value)} />
            </label>
          )}
          {f.hasQueries && (
            <label className="field">
              {t('Query')}
              <input type="search" placeholder={t('Query contains…')} value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
          )}
          <label className="field">
            {t('Metric')}
            <select value={metric} onChange={(e) => setMetric(e.target.value)}>
              <option value="">{t('All metrics')}</option>
              {[...new Set(f.metrics.map((m) => m.metric))].map((m) => <option key={m} value={m}>{metricLabel(m)}</option>)}
            </select>
          </label>
          <span className="spacer" />
          <button className="btn primary" onClick={onContinue}>{t('Continue to Measurements →')}</button>
        </div>
        <div className="card-body small secondary" style={{ paddingTop: 0 }}>
          {t('Data available — GA4: {ga4} · GSC daily: {gsc}.', { ga4: period(f.dateRange.GA4), gsc: period(f.dateRange.GSC) })}
          {!currentEnd && t(' Without a date, each source uses its own latest week.')}
        </div>
      </section>

      {summary.error != null && <ErrorState error={summary.error} />}
      {summary.data && <Kpis summary={summary.data} source={source} />}
      {summary.data && <Comparison summary={summary.data} source={source} segment={segment} metric={metric} />}

      {showGa4 && (
        <div className="grid two">
          <Trend title="Sessions trend by traffic source" subtitle="GA4 · daily sessions per segment" source="GA4" metric="sessions" segment={segment} colorOf={segColor} />
          <Trend title="CVR trend" subtitle="GA4 · CV ÷ Sessions × 100 per day (CV column mapping unconfirmed)" source="GA4" metric="cvr" segment={segment} colorOf={segColor} format={(v) => `${v.toFixed(3)}%`} zeroBased={false} />
        </div>
      )}
      {showGa4 && summary.data && <TrafficSourcePerformance summary={summary.data} />}
      {showGsc && (
        <div className="grid two">
          <Trend title="Clicks trend" subtitle="GSC daily chart" source="GSC" metric="clicks" colorOf={() => SERIES_COLORS[0]!} />
          <Trend title="Impressions trend" subtitle="GSC daily chart" source="GSC" metric="impressions" colorOf={() => SERIES_COLORS[0]!} />
          <Trend title="CTR trend" subtitle="GSC daily chart · Clicks ÷ Impressions × 100" source="GSC" metric="ctr" colorOf={() => SERIES_COLORS[0]!} format={(v) => `${v.toFixed(2)}%`} zeroBased={false} />
          <Trend title="Average position trend" subtitle="GSC daily chart · lower is better (drawn at the top)" source="GSC" metric="position" colorOf={() => SERIES_COLORS[0]!} format={(v) => v.toFixed(2)} zeroBased={false} invert />
        </div>
      )}
      {source !== 'GA4' && (f.hasPages || f.hasQueries) && (
        <div className="grid two">
          {f.hasPages && <TopPerformance dim="page" title="Page performance" search={page} />}
          {f.hasQueries && <TopPerformance dim="query" title="Query performance" search={q} />}
        </div>
      )}
      <Records source={source} segment={segment} page={page} q={q} metric={metric} />
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
  add('e コマース購入数 (used as CV — unconfirmed)', 'GA4', 'ecommerce_purchases');
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
            source={`${row.source} · ${p ? period(p.current) : ''}`}
            note={row.note}
          />
        );
      })}
    </div>
  );
}

function Comparison({ summary, source, segment, metric }: { summary: Summary; source: '' | Source; segment: string; metric: string }) {
  const rows = summary.rows.filter(
    (r) => (!source || r.source === source) && (!segment || r.source !== 'GA4' || r.subjectKey === segment) && (!metric || r.metric === metric),
  );
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{t('Period comparison')}</h2>
          <div className="hint">
            {(['GA4', 'GSC'] as Source[]).filter((s) => summary.periods[s]).map((s) => t('{source}: current {current} vs previous {previous}', { source: s, current: period(summary.periods[s]!.current), previous: period(summary.periods[s]!.previous) })).join(' · ')}
          </div>
        </div>
        <span className="hint">{t('Absolute change = current − previous · Change rate = (current − previous) ÷ previous × 100')}</span>
      </div>
      <div className="card-body">
        <DataTable
          rows={rows}
          rowKey={(r) => `${r.source}|${r.subjectKey}|${r.metric}`}
          empty={t('No dated data for the selected filters. Undated GSC totals (query, page, device…) cannot be compared week on week.')}
          columns={[
            { key: 'src', label: t('Source'), render: (r) => r.source },
            { key: 'subject', label: t('Subject'), render: (r) => <>{r.subjectKey} <span className="muted small">({r.subjectType})</span></> },
            { key: 'metric', label: t('Metric'), render: (r) => metricLabel(r.metric) },
            { key: 'prev', label: t('Previous'), num: true, render: (r) => metricValue(r.metric, r.previous) },
            { key: 'cur', label: t('Current'), num: true, render: (r) => metricValue(r.metric, r.current) },
            { key: 'abs', label: t('Absolute change'), num: true, render: (r) => signed(r.metric, r.absoluteChange) },
            { key: 'rate', label: t('Change rate'), num: true, render: (r) => pct(r.changeRate) },
            { key: 'note', label: t('Note'), render: (r) => <span className="small muted">{r.note}</span> },
          ]}
        />
      </div>
    </section>
  );
}

function Trend({ title, subtitle, source, metric, segment, colorOf, format, zeroBased, invert }: {
  title: string;
  subtitle: string;
  source: Source;
  metric: string;
  segment?: string;
  colorOf: (key: string) => string;
  format?: (v: number) => string;
  zeroBased?: boolean;
  invert?: boolean;
}) {
  const res = useApi<Series[]>(`/data/trends${query({ source, metric, segment })}`);
  const series: ChartSeries[] = useMemo(() => (res.data ?? []).map((s) => ({ ...s, color: colorOf(s.key) })), [res.data, colorOf]);
  if (res.data && !res.data.length) return null; // no graph without data
  return (
    <ChartCard title={title} subtitle={subtitle} legend={series.map((s) => ({ label: s.label, color: s.color }))} table={<SeriesTable series={series} format={format} />}>
      {res.error ? <ErrorState error={res.error} /> : !res.data ? <LoadingState /> : <LineChart series={series} format={format} zeroBased={zeroBased} invert={invert} />}
    </ChartCard>
  );
}

function TrafficSourcePerformance({ summary }: { summary: Summary }) {
  const rows = summary.rows.filter((r) => r.source === 'GA4' && r.metric === 'sessions' && r.subjectType !== 'site' && r.current !== null);
  if (!rows.length) return null;
  const p = summary.periods.GA4;
  return (
    <ChartCard
      title="Traffic-source performance"
      subtitle={t('GA4 sessions, current week {period} · change vs previous week in the tooltip', { period: period(p?.current) })}
      table={
        <DataTable rows={rows} rowKey={(r) => r.subjectKey} columns={[
          { key: 's', label: t('Segment'), render: (r) => r.subjectKey },
          { key: 'p', label: t('Previous'), num: true, render: (r) => num(r.previous) },
          { key: 'c', label: t('Current'), num: true, render: (r) => num(r.current) },
          { key: 'r', label: t('Change rate'), num: true, render: (r) => pct(r.changeRate) },
        ]} />
      }
    >
      <BarChart
        rows={rows.map((r) => ({ label: r.subjectKey, value: r.current!, detail: `${t('Previous')} ${num(r.previous)} · ${pct(r.changeRate)}` }))}
        format={(v) => compact(v)}
      />
    </ChartCard>
  );
}

function TopPerformance({ dim, title, search }: { dim: 'page' | 'query'; title: string; search: string }) {
  const res = useApi<TopResult>(`/data/top/${dim}${query({ limit: 10, search })}`);
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
          { key: 'k', label: dim === 'page' ? t('Page') : t('Query'), render: (r) => <span style={{ wordBreak: 'break-all' }}>{r.key}</span> },
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

function Records({ source, segment, page, q, metric }: { source: string; segment: string; page: string; q: string; metric: string }) {
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [source, segment, page, q, metric]);
  const res = useApi<{ total: number; rows: ImportedRow[] }>(`/data${query({ source, segment, page, query: q, metric, limit: LIMIT, offset })}`);
  return (
    <section className="card">
      <div className="card-head">
        <h2>{t('SEO data records')}</h2>
        <span className="hint">{t('Valid normalized rows from the database, filtered as above.')}</span>
      </div>
      <div className="card-body">
        {res.error != null && <ErrorState error={res.error} />}
        {res.data && (
          <>
            <DataTable
              rows={res.data.rows}
              rowKey={(r) => r.id}
              columns={[
                { key: 'up', label: t('Upload'), num: true, render: (r) => `#${r.uploadId}` },
                { key: 'src', label: t('Source'), render: (r) => r.source },
                { key: 'date', label: t('Date / period'), render: (r) => r.dataDate ?? <span className="muted">{period(r.periodStart ? { start: r.periodStart, end: r.periodEnd! } : null)}</span> },
                { key: 'subject', label: t('Subject'), render: (r) => <span style={{ wordBreak: 'break-all' }}>{r.segment ?? r.query ?? r.pageUrl ?? r.device ?? r.country ?? r.searchAppearance ?? 'site'}</span> },
                { key: 'm', label: t('Metric'), render: (r) => metricLabel(r.metricName) },
                { key: 'v', label: t('Value'), num: true, render: (r) => metricValue(r.metricName, r.metricValue) },
              ]}
            />
            <Pager total={res.data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
          </>
        )}
      </div>
    </section>
  );
}
