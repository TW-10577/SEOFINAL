import type { ComparisonRow, Countermeasure, Ga4Overview, GscInvestigation, GscShareRow, GscSupportingEvidence, Measurement, MeasurementDetail, MeasurementRun, Period, Report, Series, Source } from '@seo/shared';
import { useMemo, type ReactNode } from 'react';
import { query } from '../api.ts';
import { dayLabel, dateTime, fmtDiff, fmtRate, fmtValue, metricLabel, num, pct, period } from '../format.ts';
import { currentLang, dataLabel, t } from '../i18n.ts';
import { ChartCard, LineChart, SeriesTable, type ChartSeries } from './ChartCard.tsx';
import { Icon, type IconName } from './Icon.tsx';
import { ErrorState, LoadingState } from './States.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { useApi } from './useApi.ts';

// The report reads top to bottom: status → executive summary → KPIs → week-on-week charts → what needs attention →
// action plan → technical details. Every figure comes from the selected run (its stored measurements, or the data
// API scoped to the run's files, weeks and test-data setting); nothing is estimated or invented here.

export type Details = { byId: Record<number, MeasurementDetail>; loading: boolean; error: unknown };

interface Summary {
  periods: Record<Source, { current: Period; previous: Period } | null>;
  rows: ComparisonRow[];
}

// ---------- shared helpers ----------

export const shortName = (m: Measurement) => m.name.replace(/^[①②③④⑤]\s*/, '');
const stripTest = (s: string) => s.replace(/^Based on data the export marks as not real — not a business result\.\s*/, '').replace(/^エクスポートで実データではないとされたデータに基づく結果です — 業務上の結果ではありません。/, '');
/** An increase of the judged figure: a significant positive change, never shown as a violation. */
const isUp = (m: Measurement) => (m.changeRate ?? m.absoluteChange ?? 0) > 0;
const isRatio = (metric: string) => metric === 'cvr' || metric === 'ctr';

export { fmtDiff, fmtRate, fmtValue };

/** Metrics where a lower value is the better outcome (Search Console average position). */
const LOWER_IS_BETTER = new Set(['position']);

/**
 * Week-on-week change of one figure: arrow + percentage and the absolute difference. The colour follows what the
 * metric means (a higher position number is worse), and the arrow carries the direction, never colour alone.
 */
export function Delta({ metric, abs, rate }: { metric: string; abs: number | null; rate: number | null }) {
  const dir = rate ?? abs ?? 0;
  const tone = !dir ? '' : (dir > 0) !== LOWER_IS_BETTER.has(metric) ? 'delta-good' : 'delta-bad';
  return (
    <span className={`delta-line ${tone}`} title={tone ? t(tone === 'delta-good' ? 'Favourable change' : 'Unfavourable change') : undefined}>
      <span className={!dir ? '' : dir > 0 ? 'trend-up' : 'trend-down'}>{fmtRate(rate)}</span>
      <span className="delta-abs">{fmtDiff(metric, abs)}</span>
    </span>
  );
}

/** Configured threshold with its unit: percent = relative change, percentage_points = absolute points. */
export function fmtThreshold(m: Measurement): string {
  if (m.thresholdValue === null) return t('not configured');
  if (m.thresholdUnit === 'percent') return t('±{v}% (relative change)', { v: m.thresholdValue });
  if (m.thresholdUnit === 'percentage_points') return t('±{v} pt (percentage points)', { v: m.thresholdValue });
  return `±${m.thresholdValue}`;
}

/** Negative NG first, then by how far the change went past its threshold. */
function severity(m: Measurement): number {
  const over = m.thresholdValue ? Math.abs(m.changeRate ?? 0) / m.thresholdValue : 0;
  return (m.status === 'NG' && !isUp(m) ? 1000 : m.status === 'NG' ? 500 : 0) + over;
}
export const byPriority = (a: Measurement, b: Measurement) => severity(b) - severity(a);

// ---------- overall status ----------

type Overall = 'passed' | 'attention' | 'critical' | 'none';

/**
 * From the run's own OK / NG results: all evaluated OK → passed; every evaluated rule NG with a decline → critical;
 * any other NG → attention; nothing evaluable → none.
 */
export function overallOf(ms: Measurement[]): Overall {
  const evaluated = ms.filter((m) => m.status === 'OK' || m.status === 'NG');
  const ng = ms.filter((m) => m.status === 'NG');
  if (!evaluated.length) return 'none';
  if (!ng.length) return 'passed';
  if (ng.length === evaluated.length && ng.every((m) => !isUp(m))) return 'critical';
  return 'attention';
}

const OVERALL: Record<Overall, { label: string; cls: string; icon: IconName; rule: string }> = {
  passed: { label: 'All Checks Passed', cls: 'ok', icon: 'checkCircle', rule: 'Every evaluated measurement is within its configured threshold.' },
  attention: { label: 'Attention Required', cls: 'warn', icon: 'alert', rule: 'At least one measurement exceeded its configured threshold.' },
  critical: { label: 'Critical Issue', cls: 'ng', icon: 'xCircle', rule: 'Every evaluated measurement exceeded its threshold with a decline.' },
  none: { label: 'Not Evaluated', cls: '', icon: 'minus', rule: 'No rule could be applied to this period.' },
};

export function OverallPill({ overall }: { overall: Overall }) {
  const o = OVERALL[overall];
  return (
    <span className={`rp-status ${o.cls}`} title={t(o.rule)}>
      <Icon name={o.icon} size={16} />
      {t(o.label)}
    </span>
  );
}

// ---------- section frame ----------

function Section({ title, count, hint, children, id }: { title: string; count?: number; hint?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="card rp-section" id={id}>
      <div className="card-head">
        <div>
          <h2>{title}{count !== undefined && <span className="count">{count}</span>}</h2>
          {hint && <div className="hint">{hint}</div>}
        </div>
      </div>
      <div className="card-body">{children}</div>
    </section>
  );
}

// ---------- 1. Header ----------

export function ReportHeader({ run, runs, overall, report, busy, testData, dataSources, onSelectRun, onBack }: {
  run: MeasurementRun;
  runs: MeasurementRun[];
  overall: Overall;
  report: Report | null;
  busy: boolean;
  testData: boolean;
  dataSources: string;
  onSelectRun: (id: number) => void;
  onBack: () => void;
}) {
  return (
    <section className="card rp-header">
      <div className="rp-head-top">
        <div style={{ minWidth: 0 }}>
          <div className="rp-eyebrow">
            {t('Run #{id}', { id: run.id })}
            {testData && <span className="badge warn" title={t('Based on dates the uploaded file marks as not real — not business results.')}>{t('TEST DATA')}</span>}
          </div>
          <h2 className="rp-title">{t('SEO Performance Report')}</h2>
        </div>
        <OverallPill overall={overall} />
      </div>
      <dl className="rp-meta">
        <div><dt><Icon name="calendar" size={13} />{t('Analysis period')}</dt><dd>{period(run.current)}</dd></div>
        <div><dt>{t('Comparison period')}</dt><dd>{period(run.previous)}</dd></div>
        <div><dt><Icon name="database" size={13} />{t('Data source')}</dt><dd>{dataSources}</dd></div>
        <div>
          <dt><Icon name="clock" size={13} />{t('Last generated')}</dt>
          <dd>{busy ? <span className="muted">{t('Generating…')}</span> : report ? `${dateTime(report.generatedAt)} UTC` : '—'}</dd>
        </div>
      </dl>
      <div className="rp-toolbar no-print">
        {runs.length > 1 && (
          <label className="field rp-run">
            {t('Run history')}
            <select value={run.id} onChange={(e) => onSelectRun(Number(e.target.value))}>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>#{r.id} · {period(r.current)} vs {period(r.previous)} · {dateTime(r.createdAt)}</option>
              ))}
            </select>
          </label>
        )}
        <button className="btn ghost rp-back" onClick={onBack}><Icon name="arrowLeft" size={15} />{t('Back to Measurements')}</button>
      </div>
    </section>
  );
}

// ---------- 2. Executive summary ----------

const TOPIC: Record<string, string> = { sessions: 'Traffic', cvr: 'Conversion Rate', ecommerce_purchases: 'Purchases' };
const SUBJECT: Record<string, string> = { sessions: 'Sessions', cvr: 'The conversion rate (CVR)', ecommerce_purchases: 'Purchases' };

/** Plain-English statement of one NG result, built only from its stored values and threshold. */
export function explain(m: Measurement): string {
  const vars = {
    name: shortName(m),
    subject: t(SUBJECT[m.metric] ?? metricLabel(m.metric)),
    prev: fmtValue(m.metric, m.previousValue),
    cur: fmtValue(m.metric, m.currentValue),
    rate: m.changeRate === null ? '—' : `${Math.abs(m.changeRate).toFixed(2)}%`,
    pp: isRatio(m.metric) && m.absoluteChange !== null ? t(' ({pp} percentage points)', { pp: `${m.absoluteChange > 0 ? '+' : m.absoluteChange < 0 ? '−' : ''}${Math.abs(m.absoluteChange).toFixed(3)}` }) : '',
    threshold: fmtThreshold(m),
  };
  return isUp(m)
    ? t('{name} increased compared with the previous week. {subject} rose from {prev} to {cur}, a relative increase of {rate}{pp}. This exceeds the configured {threshold} threshold and should be reviewed to confirm what drove it.', vars)
    : t('{name} decreased compared with the previous week. {subject} fell from {prev} to {cur}, a relative decrease of {rate}{pp}. This exceeds the configured {threshold} threshold and requires investigation.', vars);
}

/** Why the business should care — what the metric's direction means, without estimating revenue or impact. */
export function interpret(m: Measurement): string {
  const up = isUp(m);
  if (m.metric === 'cvr') return up ? t('A larger share of visits ended in a purchase. Confirm what drove it so it can be repeated.') : t('A smaller share of visits ended in a purchase, so the site is converting its traffic less efficiently.');
  if (m.metric === 'sessions') return up ? t('More visits reached the site. Check that the additional traffic also converts.') : t('Fewer visits reached the site, which means fewer opportunities to purchase.');
  return t('{metric} moved beyond its configured threshold.', { metric: metricLabel(m.metric) });
}

export function ExecutiveSummary({ measurements, overall }: { measurements: Measurement[]; overall: Overall }) {
  const n = (s: string) => measurements.filter((m) => m.status === s).length;
  const ng = measurements.filter((m) => m.status === 'NG').sort(byPriority);
  const down = ng.filter((m) => !isUp(m)).length;
  const top = ng[0];
  const o = OVERALL[overall];
  const headline = top
    ? `${t(o.label)} — ${t(TOPIC[top.metric] ?? metricLabel(top.metric))} ${isUp(top) ? t('Increased') : t('Declined')}${ng.length > 1 ? ` ${t('(+{n} more)', { n: ng.length - 1 })}` : ''}`
    : overall === 'passed' ? `${t(o.label)} — ${t('All measurements within their thresholds')}` : `${t(o.label)} — ${t('No rule could be applied')}`;
  const tiles: { label: string; value: number; sub?: string; cls?: string }[] = [
    { label: 'Measurements evaluated', value: n('OK') + n('NG'), sub: n('NOT_EVALUABLE') ? t('{n} not evaluable', { n: n('NOT_EVALUABLE') }) : t('of {n} rules', { n: measurements.length }) },
    { label: 'OK', value: n('OK'), sub: t('Within threshold'), cls: 'ok' },
    { label: 'NG', value: n('NG'), sub: t('Threshold exceeded'), cls: n('NG') ? 'ng' : '' },
    { label: 'Significant changes', value: ng.length, sub: t('{down} decline · {up} increase', { down, up: ng.length - down }) },
  ];
  return (
    <Section title={t('Executive Summary')}>
      <div className="rp-exec">
        <div className={`rp-finding ${o.cls}`}>
          <div className="rp-finding-label">{t('Key finding')}</div>
          <h3 className="rp-finding-title">{headline}</h3>
          {top ? (
            <>
              <p>{explain(top)}</p>
              <p className="rp-why"><strong>{t('Why it matters')}:</strong> {interpret(top)}</p>
            </>
          ) : overall === 'passed' ? (
            <p>{t('All {n} evaluated measurements stayed within their configured thresholds week on week. No threshold was exceeded in this period.', { n: n('OK') })}</p>
          ) : (
            <p>{t('No rule could be applied for this period, so there is no OK / NG result. See the measurement details for the reason.')}</p>
          )}
        </div>
        <div className="rp-tiles">
          {tiles.map((x) => (
            <div key={x.label} className={`rp-tile ${x.cls ?? ''}`}>
              <div className="rp-tile-label">{t(x.label)}</div>
              <div className="rp-tile-value">{x.value}</div>
              {x.sub && <div className="rp-tile-sub">{x.sub}</div>}
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ---------- 3. KPI overview ----------

type KpiStatus = { cls: string; icon: IconName; label: string; title?: string };

function kpiStatus(m: Measurement | undefined, informational: string): KpiStatus {
  if (!m) return { cls: '', icon: 'info', label: informational };
  if (m.status === 'OK') return { cls: 'ok', icon: 'check', label: t('OK · within threshold'), title: `${m.ruleCode} · ${fmtThreshold(m)}` };
  if (m.status === 'NG' && isUp(m)) return { cls: 'info', icon: 'alert', label: t('NG · significant increase'), title: `${m.ruleCode} · ${fmtThreshold(m)}` };
  if (m.status === 'NG') return { cls: 'ng', icon: 'x', label: t('NG · threshold exceeded'), title: `${m.ruleCode} · ${fmtThreshold(m)}` };
  return { cls: '', icon: 'minus', label: t('Not evaluated'), title: m.ruleCode };
}

function KpiCard({ label, metric, previous, current, abs, rate, status }: { label: string; metric: string; previous: number | null; current: number | null; abs: number | null; rate: number | null; status: KpiStatus }) {
  return (
    <div className={`card rp-kpi ${status.cls}`}>
      <div className="rp-kpi-head">
        <span className="rp-kpi-label">{t(label)}</span>
        <span className={`badge ${status.cls}`} title={status.title}><Icon name={status.icon} size={12} />{status.label}</span>
      </div>
      <div className="rp-kpi-value">{fmtValue(metric, current)}</div>
      <div className="rp-kpi-prev">{t('Previous week')}: <strong>{fmtValue(metric, previous)}</strong></div>
      <div className="rp-kpi-change">
        <span className={rate === null || rate === 0 ? '' : rate > 0 ? 'trend-up' : 'trend-down'}>{fmtRate(rate)}</span>
        <span className="muted">{fmtDiff(metric, abs)}</span>
      </div>
    </div>
  );
}

export function KpiOverview({ summary, overview, measurements }: { summary: Summary | null; overview: Ga4Overview | null; measurements: Measurement[] }) {
  if (!summary || !overview) return <Section title={t('Key Metrics')}><LoadingState lines={3} /></Section>;
  const row = (source: Source, key: string, metric: string) => summary.rows.find((r) => r.source === source && r.subjectKey === key && r.metric === metric);
  const total = overview.segments.total;
  const ga4 = [
    { label: 'Total Sessions', metric: 'sessions', subject: total },
    { label: 'Organic Sessions', metric: 'sessions', subject: overview.segments.organic },
    { label: 'Purchases', metric: overview.purchasesMetric ?? 'ecommerce_purchases', subject: total },
    { label: 'Conversion Rate (CVR)', metric: 'cvr', subject: total },
  ];
  const cards = ga4.flatMap((k) => {
    const m = measurements.find((x) => x.metric === k.metric && x.subjectKey === k.subject);
    const r = row('GA4', k.subject, k.metric);
    // The judged figure comes from the measurement itself, so the card always matches the OK / NG decision.
    const v = m ? { previous: m.previousValue, current: m.currentValue, abs: m.absoluteChange, rate: m.changeRate } : r ? { previous: r.previous, current: r.current, abs: r.absoluteChange, rate: r.changeRate } : null;
    return v && (v.current !== null || v.previous !== null) ? [{ label: k.label, metric: k.metric, ...v, status: kpiStatus(m, t('Informational')) }] : [];
  });
  const gscSite = summary.periods.GSC ? summary.rows.filter((r) => r.source === 'GSC' && r.subjectType === 'site') : [];
  const gsc = (['clicks', 'impressions', 'ctr', 'position'] as const).flatMap((metric) => {
    const r = gscSite.find((x) => x.metric === metric);
    return r && (r.current !== null || r.previous !== null) ? [{ label: { clicks: 'Clicks', impressions: 'Impressions', ctr: 'CTR', position: 'Average position' }[metric], metric, previous: r.previous, current: r.current, abs: r.absoluteChange, rate: r.changeRate }] : [];
  });
  return (
    <Section title={t('Key Metrics')} hint={t('Current week {current} vs previous week {previous}', { current: period(summary.periods.GA4?.current), previous: period(summary.periods.GA4?.previous) })}>
      {cards.length ? (
        <div className="rp-kpis">{cards.map((c) => <KpiCard key={c.label} {...c} />)}</div>
      ) : (
        <div className="secondary">{t('No GA4 figures are available for this run’s weeks.')}</div>
      )}
      {gsc.length > 0 && (
        <>
          <h3 className="rp-sub">{t('Search Console')} <span className="muted">· {period(summary.periods.GSC?.current)} vs {period(summary.periods.GSC?.previous)}</span></h3>
          <div className="rp-kpis">{gsc.map((c) => <KpiCard key={c.label} {...c} status={kpiStatus(undefined, t('Supporting evidence'))} />)}</div>
        </>
      )}
    </Section>
  );
}

// ---------- 4. Week-on-week charts ----------

const shiftDay = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const weekday = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return currentLang() === 'ja' ? '日月火水木金土'[d.getUTCDay()]! : d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
};

/** Previous week drawn over the current week, day by day (weekday-aligned), from the run's own daily rows. */
function WowChart({ title, subtitle, path, weeks, metric, format, tick, zeroBased, prevValue, curValue }: {
  title: string;
  subtitle: string;
  path: string;
  weeks: Weeks;
  metric: string;
  format: (v: number) => string;
  tick?: (v: number) => string;
  zeroBased?: boolean;
  prevValue?: string;
  curValue?: string;
}) {
  const res = useApi<Series[]>(path);
  const s = res.data?.[0];
  const series: ChartSeries[] = useMemo(() => {
    const pts = s?.points ?? [];
    const inRange = (p: Period) => pts.filter((x) => x.date >= p.start && x.date <= p.end);
    return [
      { key: 'previous', label: t('Previous week ({period})', { period: period(weeks.previous) }), color: 'var(--text-muted)', dashed: true, points: inRange(weeks.previous).map((x) => ({ date: shiftDay(x.date, 7), value: x.value })) },
      { key: 'current', label: t('Current week ({period})', { period: period(weeks.current) }), color: 'var(--brand-700)', points: inRange(weeks.current) },
    ];
  }, [s, weeks.previous.start, weeks.current.end]);
  const missing = !series[0]!.points.length || !series[1]!.points.length;
  const days = (p: Period) => Math.round((Date.parse(p.end) - Date.parse(p.start)) / 86400000) + 1;
  const incomplete = !missing && (series[0]!.points.length < days(weeks.previous) || series[1]!.points.length < days(weeks.current));
  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      legend={series.map((x, i) => ({ label: x.label, color: x.color, dashed: x.dashed, value: i === 0 ? prevValue : curValue }))}
      table={missing ? undefined : <SeriesTable series={series} format={format} />}
    >
      {res.error ? <ErrorState error={res.error} /> : !res.data ? <LoadingState /> : missing ? (
        <div className="state">{t('Daily data for both weeks is not available for this metric, so no trend is drawn.')}</div>
      ) : (
        <>
          <LineChart
            series={series}
            format={format}
            tickFormat={tick}
            zeroBased={zeroBased}
            xLabel={(d) => weekday(d)}
            xTitle={(d) => `${weekday(d)} · ${dayLabel(d)} ${t('vs')} ${dayLabel(shiftDay(d, -7))}`}
            tooltipExtra={(d) => {
              // Same weekday of both weeks: the difference current − previous, absolute and relative.
              const cur = series[1]!.points.find((x) => x.date === d)?.value;
              const prev = series[0]!.points.find((x) => x.date === d)?.value;
              if (cur === undefined || prev === undefined) return null;
              const diff = cur - prev;
              return (
                <div className="t-row t-diff">
                  <span>{t('Difference')}</span>
                  <strong>{fmtDiff(metric, diff)} ({fmtRate(prev ? (diff / prev) * 100 : null)})</strong>
                </div>
              );
            }}
          />
          {incomplete && <div className="small caveat" style={{ marginTop: 6 }}>{t('Some days have no data; the line skips them.')}</div>}
        </>
      )}
    </ChartCard>
  );
}

/** The two weeks compared: the current week and the 7 days before it. */
export type Weeks = { current: Period; previous: Period };

/** Week-on-week charts for one pair of weeks, from the data API scoped to the given files and test-data setting. */
export function WowCharts({ weeks, uploadIds, summary, overview, includeTest }: { weeks: Weeks; uploadIds?: string; summary: Summary | null; overview: Ga4Overview | null; includeTest: boolean }) {
  if (!overview || !summary) return null;
  const total = overview.segments.total;
  const trend = (metric: string, segment: string) =>
    `/data/trends${query({ source: 'GA4', metric, segment, from: weeks.previous.start, to: weeks.current.end, includeTestData: includeTest ? 1 : 0, uploadIds })}`;
  const kpi = (metric: string, key = total) => summary.rows.find((r) => r.source === 'GA4' && r.subjectKey === key && r.metric === metric);
  const purchases = overview.purchasesMetric ?? 'ecommerce_purchases';
  const legend = (metric: string) => {
    const r = kpi(metric);
    return { prevValue: r ? `${t('week')}: ${fmtValue(metric, r.previous)}` : undefined, curValue: r ? `${t('week')}: ${fmtValue(metric, r.current)}` : undefined };
  };
  const channels = summary.rows.filter((r) => r.source === 'GA4' && r.metric === 'sessions' && r.subjectKey !== total && overview.segments.all.includes(r.subjectKey) && (r.current !== null || r.previous !== null));
  const totals = kpi('sessions');
  if (!totals || (totals.current === null && totals.previous === null))
    return (
      <Section title={t('Week-on-Week Comparison')}>
        <div className="secondary">{t('No daily GA4 data covers this run’s weeks, so no charts are drawn.')}</div>
      </Section>
    );
  return (
    <Section title={t('Week-on-Week Comparison')} hint={t('Each day of the current week next to the same weekday of the previous week.')}>
      <div className="rp-charts">
        <WowChart title={t('Sessions per day')} subtitle={t('All traffic sources (site total)')} path={trend('sessions', total)} weeks={weeks} metric="sessions" format={(v) => num(v)} {...legend('sessions')} />
        <WowChart title={t('Purchases per day')} subtitle={t('E-commerce purchases (site total)')} path={trend(purchases, total)} weeks={weeks} metric={purchases} format={(v) => num(v)} {...legend(purchases)} />
        <WowChart title={t('Conversion rate per day')} subtitle={t('CVR = purchases ÷ sessions × 100')} path={trend('cvr', total)} weeks={weeks} metric="cvr" format={(v) => `${v.toFixed(3)}%`} tick={(v) => `${v.toFixed(2)}%`} zeroBased={false} {...legend('cvr')} />
        {channels.length > 0 && <ChannelBreakdown rows={channels} total={kpi('sessions')} totalKey={total} />}
      </div>
    </Section>
  );
}

/** Sessions per traffic source, previous vs current week, from the run's own week totals. */
function ChannelBreakdown({ rows, total, totalKey }: { rows: ComparisonRow[]; total: ComparisonRow | undefined; totalKey: string }) {
  const max = Math.max(...rows.flatMap((r) => [r.previous ?? 0, r.current ?? 0]), 1);
  // A channel segment is "<site total> <channel>": show only the channel part.
  const name = (key: string) => {
    const own = key.startsWith(totalKey) ? key.slice(totalKey.length).trim() : '';
    if (own) return dataLabel(own);
    const shown = dataLabel(key);
    return shown.includes(' – ') ? shown.split(' – ').slice(1).join(' – ') : shown;
  };
  return (
    <section className="card rp-channels">
      <div className="card-head">
        <div>
          <h2>{t('Sessions by traffic source')}</h2>
          <div className="hint">{t('Week totals per traffic source (GA4 segments)')}</div>
        </div>
      </div>
      <div className="card-body">
      <div className="rp-channel-legend">
        <span><span className="key" style={{ background: 'var(--text-muted)' }} />{t('Previous week')}</span>
        <span><span className="key" style={{ background: 'var(--brand-700)' }} />{t('Current week')}</span>
      </div>
      {rows.map((r) => (
        <div key={r.subjectKey} className="rp-channel">
          <div className="rp-channel-name" title={dataLabel(r.subjectKey)}>{name(r.subjectKey)}</div>
          <div className="rp-channel-bars">
            <div className="bar prev" style={{ width: `${((r.previous ?? 0) / max) * 100}%` }} />
            <div className="bar cur" style={{ width: `${((r.current ?? 0) / max) * 100}%` }} />
          </div>
          <div className="rp-channel-vals">
            <span className="muted">{num(r.previous)}</span> → <strong>{num(r.current)}</strong>
            <span className={r.changeRate === null || r.changeRate === 0 ? '' : r.changeRate > 0 ? 'trend-up' : 'trend-down'}>{fmtRate(r.changeRate)}</span>
            {total?.current ? <span className="muted small">{t('{share}% of sessions', { share: (((r.current ?? 0) / total.current) * 100).toFixed(1) })}</span> : null}
          </div>
        </div>
      ))}
      </div>
    </section>
  );
}

// ---------- 5. What needs attention ----------

function DetailState({ details }: { details: Details }) {
  if (details.error != null) return <ErrorState error={details.error} />;
  if (details.loading) return <LoadingState lines={3} />;
  return null;
}

export function Attention({ rows, details, evaluated }: { rows: Measurement[]; details: Details; evaluated: number }) {
  return (
    <Section title={t('What Needs Attention?')} count={rows.length} id="attention">
      {rows.length === 0 && !evaluated ? (
        <div className="secondary">{t('No measurement could be evaluated for this period, so there is no result to review.')}</div>
      ) : rows.length === 0 ? (
        <div className="rp-empty-ok"><Icon name="checkCircle" size={18} />{t('Nothing needs attention: no measurement exceeded its threshold.')}</div>
      ) : (
        <div className="rp-issues">
          <DetailState details={details} />
          {rows.map((m) => <IssueCard key={m.id} m={m} d={details.byId[m.id]} />)}
        </div>
      )}
    </Section>
  );
}

function IssueCard({ m, d }: { m: Measurement; d: MeasurementDetail | undefined }) {
  const up = isUp(m);
  const c = d?.cause ?? null;
  const a = c?.analysis ?? null;
  const inv = a?.investigation ?? null;
  const confirmed = c?.reviewStatus === 'Confirmed';
  const causeText = c ? (c.amendments.length || !a ? c.causeText : a.title) : m.why?.likelyCause ?? m.causeSummary;
  const team = m.why?.team ?? d?.countermeasures.find((k) => k.responsibleTeam)?.responsibleTeam ?? null;
  const over = m.thresholdValue && m.changeRate !== null ? Math.abs(m.changeRate) / m.thresholdValue : null;
  return (
    <article className={`rp-issue ${up ? 'up' : 'down'}`}>
      <header className="rp-issue-head">
        <h3>{shortName(m)}</h3>
        <StatusBadge status="NG" />
        <span className={`badge ${up ? 'info' : 'ng'}`}>{up ? '↑' : '↓'} {up ? t('Significant increase') : t('Significant decrease')}</span>
        <span className="badge" title={t('The threshold violation is confirmed by the rule; the cause is not.')}>{t('Confirmed anomaly')}</span>
        <span className="spacer" />
        <span className="mono small muted">{m.ruleCode} · {m.ruleId}</span>
      </header>
      <div className="rp-issue-figs">
        <div><span>{t('Current')}</span><strong>{fmtValue(m.metric, m.currentValue)}</strong></div>
        <div><span>{t('Previous')}</span><strong>{fmtValue(m.metric, m.previousValue)}</strong></div>
        <div><span>{t('Relative change')}</span><strong>{fmtRate(m.changeRate)}</strong></div>
        <div><span>{isRatio(m.metric) ? t('Change in percentage points') : t('Absolute change')}</span><strong>{fmtDiff(m.metric, m.absoluteChange)}</strong></div>
        <div><span>{t('Threshold')}</span><strong>{fmtThreshold(m)}</strong></div>
      </div>
      <dl className="rp-issue-dl">
        <dt>{t('Why the rule was triggered')}</dt>
        <dd>
          {t('The {direction} of {rate} is beyond the configured {threshold}{times}.', {
            direction: up ? t('increase') : t('decrease'),
            rate: m.changeRate === null ? '—' : `${Math.abs(m.changeRate).toFixed(2)}%`,
            threshold: fmtThreshold(m),
            times: over ? t(' ({x}× the threshold)', { x: over.toFixed(1) }) : '',
          })}
          <div className="small muted">{t('Rule')}: {m.criteria}</div>
        </dd>
        <dt>{t('Business interpretation')}</dt>
        <dd>{interpret(m)}</dd>
        <dt>{confirmed ? t('Confirmed cause') : t('Suspected cause')}</dt>
        <dd>
          {causeText ? <>{causeText} {!confirmed && <span className="badge warn">{t('Hypothesis — not confirmed')}</span>}</> : <span className="secondary">{t('Not determined from the available data.')}</span>}
          {a && !a.determined && <div className="small muted">{t('The root cause has not been established from the available data.')}</div>}
          {inv?.matched && <div className="small secondary">{t('Search Console investigation ({rule}) indicates: {cause} (confidence: {confidence})', { rule: inv.ruleId, cause: inv.cause, confidence: inv.confidence })}</div>}
        </dd>
        <dt>{t('Recommended investigation')}</dt>
        <dd>{m.why?.nextStep ?? t('Investigate the change before concluding a cause.')}</dd>
        {team && (<><dt>{t('Responsible team')}</dt><dd>{team}{m.why?.feedback && <div className="small secondary">{m.why.feedback}</div>}</dd></>)}
      </dl>
      <details className="rp-more">
        <summary>{t('View supporting evidence')}</summary>
        <div className="rp-more-body">
          <BasisTable m={m} />
          {inv && <GscFindings inv={inv} />}
          {a?.gscEvidence && <GscSnapshots g={a.gscEvidence} />}
          {stripTest(m.reason) && <div className="small secondary">{stripTest(m.reason)}</div>}
        </div>
      </details>
    </article>
  );
}

// ---------- 6. Action plan ----------

const isInvestigation = (k: Countermeasure) => /^GSC_R\d+/.test(k.reason);

export function ActionPlan({ rows, details, evaluated }: { rows: Measurement[]; details: Details; evaluated: number }) {
  const items = rows.flatMap((m) => {
    const priority = isUp(m) ? 'Medium' : 'High';
    const reason = t('{name}: {rate} vs threshold {threshold}', { name: shortName(m), rate: fmtRate(m.changeRate), threshold: fmtThreshold(m) });
    const ks = details.byId[m.id]?.countermeasures ?? [];
    if (!ks.length)
      // No countermeasure record (e.g. the cause is not determined): recommend investigating, never assert a cause.
      return [{ key: `m${m.id}`, priority, action: m.why?.nextStep ?? t('Investigate the change before concluding a cause.'), kind: t('Investigation'), reason, team: m.why?.team ?? null, status: null as string | null }];
    return ks.map((k) => ({
      key: `k${k.id}`,
      priority,
      action: k.actionText,
      kind: isInvestigation(k) ? t('Investigation') : isUp(m) ? t('Recommended action') : t('Countermeasure'),
      reason: isInvestigation(k) ? `${reason} · ${k.reason.split(':')[0]}` : reason,
      team: k.responsibleTeam,
      status: k.status as string | null,
    }));
  });
  return (
    <Section title={t('Action Plan')} count={items.length} hint={t('High = a decline beyond its threshold · Medium = an increase beyond its threshold. Only the SEO team approves or carries out actions.')}>
      {rows.length > 0 && <DetailState details={details} />}
      {items.length === 0 ? (
        <div className="secondary">{evaluated ? t('No action needed: every measurement is within its threshold.') : t('No actions: no measurement could be evaluated for this period.')}</div>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 'none' }}>
          <table className="data rp-actions">
            <thead>
              <tr>
                <th>{t('Priority')}</th>
                <th>{t('Recommended Action')}</th>
                <th>{t('Reason')}</th>
                <th>{t('Responsible Team')}</th>
                <th>{t('Status')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.key}>
                  <td><span className={`badge ${x.priority === 'High' ? 'ng' : 'warn'}`}>{t(x.priority)}</span></td>
                  <td className="rp-action-text"><strong>{x.action}</strong><span className="cell-sub">{x.kind}</span></td>
                  <td className="small">{x.reason}</td>
                  <td>{x.team ?? <span className="muted">{t('not assigned')}</span>}</td>
                  <td>{x.status ? <StatusBadge status={x.status} /> : <span className="badge">{t('To investigate')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ---------- 7. Measurement details (technical, collapsed) ----------

export function MeasurementDetails({ measurements }: { measurements: Measurement[] }) {
  return (
    <section className="card rp-section">
      <details className="rp-all">
        <summary className="card-head">
          <Icon name="chevronRight" size={16} className="rp-chevron" />
          <h2>{t('View all measurement results')} <span className="count">{measurements.length}</span></h2>
        </summary>
        <div className="card-body rp-all-body">
          {measurements.map((m) => <MeasurementRow key={m.id} m={m} />)}
        </div>
      </details>
    </section>
  );
}

function MeasurementRow({ m }: { m: Measurement }) {
  const judged = m.basis.find((b) => b.status) ?? m.basis[0];
  return (
    <details className="rp-calc">
      <summary>
        <Icon name="chevronRight" size={14} className="rp-chevron" />
        <span className="badge info">{m.ruleCode}</span>
        <strong className="rp-calc-name">{shortName(m)}</strong>
        <span className="tabular">{fmtValue(m.metric, m.previousValue)} → {fmtValue(m.metric, m.currentValue)}</span>
        <span className="tabular">{fmtRate(m.changeRate)}</span>
        <StatusBadge status={m.status} />
        <span className="rp-calc-link">{t('View calculation details')}</span>
      </summary>
      <div className="rp-calc-body">
        <dl className="kv">
          <dt>{t('Rule')}</dt><dd>{m.name} <span className="mono small muted">({m.ruleId})</span><div className="small secondary">{m.criteria}</div></dd>
          <dt>{t('Formula')}</dt><dd>{judged ? dataLabel(judged.label) : metricLabel(m.metric)}</dd>
          <dt>{t('Previous value')}</dt><dd>{fmtValue(m.metric, m.previousValue)}</dd>
          <dt>{t('Current value')}</dt><dd>{fmtValue(m.metric, m.currentValue)}</dd>
          <dt>{t('Absolute change')}</dt><dd>{fmtDiff(m.metric, m.absoluteChange)}</dd>
          <dt>{t('Relative change')}</dt><dd>{fmtRate(m.changeRate)}</dd>
          <dt>{t('Threshold')}</dt><dd>{fmtThreshold(m)}</dd>
          <dt>{t('Calculation result')}</dt><dd className="mono small">{m.result}</dd>
          <dt>{t('Decision')}</dt><dd><StatusBadge status={m.status} /></dd>
          <dt>{t('Reason')}</dt><dd>{stripTest(m.reason)}</dd>
          <dt>{t('Recommended action')}</dt><dd>{m.why?.nextStep ?? (m.status === 'OK' ? t('None — within threshold.') : '—')}</dd>
        </dl>
        <BasisTable m={m} />
      </div>
    </details>
  );
}

// ---------- evidence tables (shared with the attention cards) ----------

function BasisTable({ m }: { m: Measurement }) {
  if (!m.basis.length) return null;
  return (
    <div className="table-wrap" style={{ maxHeight: 'none' }}>
      <table className="data">
        <thead><tr><th>{t('Figure')}</th><th className="num">{t('Previous')}</th><th className="num">{t('Current')}</th><th className="num">{t('Change')}</th></tr></thead>
        <tbody>
          {m.basis.map((b) => (
            <tr key={b.label}>
              <td>{b.status ? <strong>{dataLabel(b.label)}</strong> : <span className="secondary">{dataLabel(b.label)}</span>}</td>
              <td className="num">{fmtValue(b.metric, b.previous)}</td>
              <td className="num">{fmtValue(b.metric, b.current)}</td>
              <td className="num">{fmtRate(b.changeRate)}</td>
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
      <h4 className="rp-sub">{t('Search Console evidence')}</h4>
      {inv.siteChanges.length > 0 && (
        <div className="small secondary">{t('Site (Chart by Date)')}: {inv.siteChanges.map((x) => `${x.metric} ${x.metric === 'position' ? two(x.previous, x.current) : pct(x.changeRate)}`).join(' · ')}</div>
      )}
      {checks.map((k) => (
        <div key={k.id}>
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
    </>
  );
}

/** Uploaded Search Console snapshots: period totals for context — they show where clicks are, not what changed. */
function GscSnapshots({ g }: { g: GscSupportingEvidence }) {
  const parts = [
    { key: 'q', title: t('Top queries'), s: g.queries },
    { key: 'p', title: t('Top pages'), s: g.pages },
  ].filter((x) => x.s.available && x.s.top.length);
  if (!parts.length) return null;
  return (
    <>
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

/** Data sources of the run: from the generated report when available, else from the data the run covers. */
export function dataSourcesOf(report: Report | null, summary: Summary | null): string {
  if (report?.doc.meta?.dataSources?.length) return dataLabel(report.doc.meta.dataSources.join(' · '));
  return summary?.periods.GSC ? 'Google Analytics 4 (GA4) · Google Search Console' : 'Google Analytics 4 (GA4)';
}

export type { Summary };
