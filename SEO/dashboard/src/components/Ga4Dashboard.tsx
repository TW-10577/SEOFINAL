import type { Ga4Overview, Series } from '@seo/shared';
import { useEffect, useMemo, useState } from 'react';
import { query } from '../api.ts';
import { num, period } from '../format.ts';
import { dataLabel, t } from '../i18n.ts';
import { ChartCard, LineChart, SERIES_COLORS, SeriesTable, type ChartSeries } from './ChartCard.tsx';
import { Icon } from './Icon.tsx';
import { ErrorState, LoadingState } from './States.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { useApi } from './useApi.ts';

const pctFmt = (v: number) => `${v.toFixed(3)}%`;

/**
 * GA4 dataset overview: what was uploaded and which trends are visible. Everything comes from the uploaded
 * data (daily rows only; the export's 総計 row is never imported as a date). No rules, OK / NG or anomalies.
 */
export function Ga4Dashboard({ includeTest, segment, colorOf, uploadIds }: { includeTest: boolean; segment: string; colorOf: (segment: string) => string; uploadIds?: string }) {
  const test = includeTest ? 1 : 0;
  const ov = useApi<Ga4Overview>(`/data/ga4-overview${query({ includeTestData: test, uploadIds })}`);
  if (ov.error) return <ErrorState error={ov.error} onRetry={ov.reload} />;
  if (!ov.data) return <LoadingState lines={6} />;
  const o = ov.data;
  if (!o.days) return null;
  const totalLine = SERIES_COLORS[0]!;
  return (
    <>
      <DatasetHeader o={o} />
      <Kpis o={o} />

      <div className="grid two">
        <TrendCard
          title="Traffic Overview"
          subtitle="Daily total sessions"
          path={`/data/trends${query({ source: 'GA4', metric: 'sessions', segment: o.segments.total, includeTestData: test, uploadIds })}`}
          colorOf={() => totalLine}
          format={(v) => num(v)}
        />
        <TrendCard
          title="Conversion Rate"
          subtitle="Daily CVR = purchases ÷ sessions × 100"
          path={`/data/trends${query({ source: 'GA4', metric: 'cvr', segment: o.segments.total, includeTestData: test, uploadIds })}`}
          colorOf={() => totalLine}
          format={pctFmt}
          zeroBased={false}
        />
      </div>

      <TrendCard
        title="Traffic Source"
        subtitle={segment ? 'Daily sessions of the selected traffic source' : 'Daily sessions per traffic source (GA4 segments)'}
        path={`/data/trends${query({ source: 'GA4', metric: 'sessions', segment: segment || undefined, includeTestData: test, uploadIds })}`}
        exclude={o.segments.total}
        colorOf={colorOf}
        format={(v) => num(v)}
        wide
      />

      <div className="grid two">
        {o.purchasesMetric ? (
          <TrendCard
            title="E-commerce Purchases"
            subtitle="Daily e-commerce purchases (site total)"
            path={`/data/trends${query({ source: 'GA4', metric: o.purchasesMetric, segment: o.segments.total, includeTestData: test, uploadIds })}`}
            colorOf={() => totalLine}
            format={(v) => num(v)}
          />
        ) : (
          <section className="card"><div className="card-body state">{t('No e-commerce purchases column in the uploaded GA4 data.')}</div></section>
        )}
        <DatasetHealth o={o} />
      </div>
    </>
  );
}

function DatasetHeader({ o }: { o: Ga4Overview }) {
  const statuses = [...new Set(o.uploads.map((u) => u.validationStatus))];
  const status = statuses.includes('invalid') ? 'invalid' : statuses.includes('valid_with_warnings') ? 'valid_with_warnings' : 'valid';
  return (
    <section className="card ds-header">
      <div className="ds-title">
        <span className="ds-eyebrow">GA4</span>
        <h2>{t('GA4 Data Overview')}</h2>
        <span className="hint">{t('What was uploaded and which trends are visible. Rules and OK / NG are on the Measurements page.')}</span>
      </div>
      <dl className="ds-meta">
        <div><dt>{t('Data source')}</dt><dd>Google Analytics 4</dd></div>
        <div><dt>{t('Analysis period')}</dt><dd className="nowrap">{period(o.period)}</dd></div>
        <div><dt>{t('Days / records')}</dt><dd>{t('{days} days · {records} records', { days: o.days, records: o.records.toLocaleString() })}</dd></div>
        <div><dt>{t('Validation')}</dt><dd><StatusBadge status={status} /></dd></div>
        <div className="wide">
          <dt>{o.uploads.length > 1 ? t('Files') : t('File')}</dt>
          <dd className="ds-files">{o.uploads.map((u) => <span key={u.id} title={period(u.period)}>#{u.id} {u.fileName}</span>)}</dd>
        </div>
      </dl>
    </section>
  );
}

function Kpis({ o }: { o: Ga4Overview }) {
  const k = o.kpis;
  const span = t('{n}-day total', { n: o.days });
  const share = k.sessions && k.organicSessions != null ? (k.organicSessions / k.sessions) * 100 : null;
  const tiles = [
    { label: 'Total Sessions', value: k.sessions == null ? '—' : num(k.sessions), sub: span },
    { label: 'E-commerce Purchases', value: k.purchases == null ? '—' : num(k.purchases), sub: span },
    { label: 'Organic Sessions', value: k.organicSessions == null ? '—' : num(k.organicSessions), sub: share == null ? span : t('{span} · {share}% of sessions', { span, share: share.toFixed(1) }) },
    { label: 'CVR', value: k.cvr == null ? '—' : pctFmt(k.cvr), sub: t('Purchases ÷ sessions × 100 · {span}', { span }) },
  ];
  return (
    <div className="stat-row">
      {tiles.map((x) => (
        <div key={x.label} className="card stat">
          <div className="stat-label">{t(x.label)}</div>
          <div className="stat-value">{x.value}</div>
          <div className="stat-sub">{x.sub}</div>
        </div>
      ))}
    </div>
  );
}

function TrendCard({ title, subtitle, path, colorOf, format, zeroBased, exclude, wide }: {
  title: string;
  subtitle: string;
  path: string;
  colorOf: (key: string) => string;
  format: (v: number) => string;
  zeroBased?: boolean;
  exclude?: string;
  wide?: boolean;
}) {
  const res = useApi<Series[]>(path);
  const roomy = useMinWidth(1100);
  const series: ChartSeries[] = useMemo(
    () => (res.data ?? []).filter((s) => s.key !== exclude).map((s) => ({ ...s, color: colorOf(s.key) })),
    [res.data, colorOf, exclude],
  );
  return (
    <ChartCard title={title} subtitle={subtitle} legend={series.map((s) => ({ label: s.label, color: s.color }))} table={<SeriesTable series={series} format={format} />}>
      {res.error ? <ErrorState error={res.error} /> : !res.data ? <LoadingState /> : <LineChart series={series} format={format} zeroBased={zeroBased} width={wide && roomy ? 1280 : undefined} />}
    </ChartCard>
  );
}

/** True while the viewport is at least `px` wide: a full-width chart is only wider than a half-width one there. */
function useMinWidth(px: number): boolean {
  const q = `(min-width: ${px}px)`;
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const f = () => setOn(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [q]);
  return on;
}

type Check = { ok: boolean; label: string; detail: string };

function DatasetHealth({ o }: { o: Ga4Overview }) {
  const h = o.health;
  const req = h.requiredFields;
  const missingFields = req.filter((f) => !f.available);
  const short = (dates: string[]) => (dates.length > 4 ? `${dates.slice(0, 4).join(', ')} … (+${dates.length - 4})` : dates.join(', '));
  const checks: Check[] = [
    {
      ok: !h.missingDates.length,
      label: t('Daily records detected'),
      detail: h.missingDates.length
        ? t('{days} of {expected} days · missing {dates}', { days: o.days, expected: h.expectedDays, dates: short(h.missingDates) })
        : t('{days} of {expected} days, no gaps', { days: o.days, expected: h.expectedDays }),
    },
    {
      ok: !missingFields.length,
      label: t('Required fields available'),
      detail: missingFields.length
        ? t('{n} of {total} missing: {cols}', { n: missingFields.length, total: req.length, cols: missingFields.map((f) => f.column).join(', ') })
        : t('{n} of {n} rules.yaml input fields present', { n: req.length }),
    },
    {
      ok: !h.duplicateDates.length && !h.duplicateRows,
      label: t('Duplicate-date check'),
      detail: h.duplicateDates.length || h.duplicateRows
        ? t('Repeated dates: {dates} ({rows} duplicate rows flagged on import)', { dates: short(h.duplicateDates) || '—', rows: h.duplicateRows })
        : t('Each date appears once per segment and metric'),
    },
    {
      ok: !h.invalidRows,
      label: t('Date validation'),
      detail: h.invalidRows
        ? t('{n} rows rejected (invalid date or value)', { n: h.invalidRows })
        : t('All dates parsed · {n} totals (総計) row(s) excluded from the daily charts', { n: h.totalsRows }),
    },
  ];
  const warnings = h.issues.filter((i) => i.severity === 'warning' || i.severity === 'error');
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{t('Dataset Health')}</h2>
          <div className="hint">{t('Completeness of the uploaded GA4 data')}</div>
        </div>
      </div>
      <div className="card-body">
        <ul className="health">
          {checks.map((c) => (
            <li key={c.label}>
              <span className={`health-icon ${c.ok ? 'ok' : 'warn'}`}><Icon name={c.ok ? 'check' : 'alert'} size={14} /></span>
              <div>
                <div className="health-label">{c.label}</div>
                <div className="health-detail">{c.detail}</div>
              </div>
            </li>
          ))}
          {h.syntheticDates.length > 0 && (
            <li>
              <span className="health-icon warn"><Icon name="alert" size={14} /></span>
              <div>
                <div className="health-label">{t('Test data')}</div>
                <div className="health-detail">
                  {t('{dates} marked as not real in the export — {state}', {
                    dates: short(h.syntheticDates),
                    state: h.syntheticIncluded ? t('included (test-data mode)') : t('excluded from charts and totals'),
                  })}
                </div>
              </div>
            </li>
          )}
        </ul>
        {warnings.length > 0 && (
          <details className="health-warnings">
            <summary>{t('{n} import warning(s)', { n: warnings.length })}</summary>
            <ul>
              {warnings.map((w, i) => (
                <li key={i}><span className="muted">{w.fileName}:</span> {dataLabel(w.message)}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
