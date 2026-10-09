import type { ReactNode } from 'react';
import { useMemo, useRef, useState } from 'react';
import { compact, dayLabel, dayLong, num } from '../format.ts';
import { t } from '../i18n.ts';
import { dataLabel } from '../i18n.ts';
import { Icon } from './Icon.tsx';

/** Categorical slots in fixed order (validated palette). Assign by entity, never by rank. */
export const SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)'];

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  points: { date: string; value: number }[];
  /** Drawn as a dashed line (e.g. the previous week under the current one). */
  dashed?: boolean;
}

/** What a card offers its header actions: the chart's svg and the card's (translated) title and subtitle. */
export interface ChartHandle {
  svg: () => SVGSVGElement | null;
  title: string;
  subtitle: string;
}

export function ChartCard({ title, subtitle, legend, table, actions, children }: {
  title: string;
  subtitle?: string;
  /** Series keys; `value` (e.g. the period total) is shown next to the label. */
  legend?: { label: string; color: string; value?: string; dashed?: boolean }[];
  /** Table view of the same data (accessibility / exact values). */
  table?: ReactNode;
  /**
   * Extra controls at the right of the header, after the Chart / Table toggle (e.g. Download). As a function it
   * gets the card's chart (its svg element, also while the table is shown), title and subtitle.
   */
  actions?: ReactNode | ((chart: ChartHandle) => ReactNode);
  children: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  const handle: ChartHandle = { svg: () => chartRef.current?.querySelector('svg') ?? null, title: t(title), subtitle: subtitle ? t(subtitle) : '' };
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{t(title)}</h2>
          {subtitle && <div className="hint">{t(subtitle)}</div>}
        </div>
        {(table || actions) && (
          <div className="card-actions">
            {table && (
              <div className="segmented" role="group" aria-label={t('View')}>
                <button className={!showTable ? 'on' : ''} aria-pressed={!showTable} onClick={() => setShowTable(false)}><Icon name="chart" size={14} />{t('Chart')}</button>
                <button className={showTable ? 'on' : ''} aria-pressed={showTable} onClick={() => setShowTable(true)}><Icon name="table" size={14} />{t('Table')}</button>
              </div>
            )}
            {typeof actions === 'function' ? actions(handle) : actions}
          </div>
        )}
      </div>
      <div className="card-body">
        {legend && (legend.length > 1 || legend.some((l) => l.value)) && !showTable && (
          <div className="legend">
            {legend.map((l) => (
              <span key={l.label} className="legend-item">
                <span className={`key${l.dashed ? ' dashed' : ''}`} style={l.dashed ? { borderColor: l.color } : { background: l.color }} />
                {dataLabel(l.label)}
                {l.value && <strong className="legend-value">{l.value}</strong>}
              </span>
            ))}
          </div>
        )}
        {/* The chart stays mounted (hidden) under the table view, so it can still be exported. */}
        <div ref={chartRef} hidden={showTable && !!table}>{children}</div>
        {showTable && table}
      </div>
    </section>
  );
}

// ---------- Line chart ----------

const W = 640;
const H = 240;
const M = { top: 12, right: 16, bottom: 30, left: 60 };

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0)!;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

export function LineChart({ series, format = (v) => num(v), tickFormat = compact, zeroBased = true, invert = false, width = W, xLabel = dayLabel, xTitle = dayLong, tooltipExtra }: {
  series: ChartSeries[];
  format?: (v: number) => string;
  /** Y-axis labels (default: compact numbers, e.g. 120K). */
  tickFormat?: (v: number) => string;
  zeroBased?: boolean;
  /** For position: lower is better, drawn at the top. */
  invert?: boolean;
  /** viewBox width: a full-width chart uses a wider box so it keeps the height of a half-width one. */
  width?: number;
  /** X-axis label and tooltip title for a point key (default: the key is an ISO day). */
  xLabel?: (key: string) => string;
  xTitle?: (key: string) => string;
  /** Extra tooltip lines for a point key (e.g. the difference between two series). */
  tooltipExtra?: (key: string) => ReactNode;
}) {
  const W = width;
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const dates = useMemo(() => [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort(), [series]);
  const values = series.flatMap((s) => s.points.map((p) => p.value));
  if (!dates.length || !values.length) return <div className="state">{t('No data for this chart.')}</div>;
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (zeroBased) lo = Math.min(0, lo);
  if (lo === hi) hi = lo + 1;
  const ticks = niceTicks(lo, hi);
  lo = Math.min(lo, ticks[0]!);
  hi = Math.max(hi, ticks[ticks.length - 1]!);
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;
  const x = (i: number) => M.left + (dates.length === 1 ? iw / 2 : (i / (dates.length - 1)) * iw);
  const y = (v: number) => (invert ? M.top + ((v - lo) / (hi - lo)) * ih : M.top + ih - ((v - lo) / (hi - lo)) * ih);
  const idx = new Map(dates.map((d, i) => [d, i]));
  const labelEvery = Math.max(1, Math.ceil(dates.length / 7));

  const onMove = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - M.left) / iw) * (dates.length - 1));
    setHover(Math.max(0, Math.min(dates.length - 1, i)));
  };

  return (
    <div className="chart">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={series.map((s) => s.label).join(', ')}>
        <g className="axis">
          {ticks.map((t) => (
            <g key={t}>
              <line className="gridline" x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
              <text x={M.left - 8} y={y(t) + 4} textAnchor="end">{tickFormat(t)}</text>
            </g>
          ))}
          <line className="baseline" x1={M.left} x2={W - M.right} y1={M.top + ih} y2={M.top + ih} />
          {dates.map((d, i) =>
            i % labelEvery === 0 || (i === dates.length - 1 && (dates.length - 1) % labelEvery >= labelEvery / 2) ? (
              <text key={d} x={x(i)} y={H - 8} textAnchor="middle">{xLabel(d)}</text>
            ) : null,
          )}
        </g>
        {series.map((s) => (
          <path
            key={s.key}
            d={s.points.map((p, k) => `${k ? 'L' : 'M'}${x(idx.get(p.date)!)},${y(p.value)}`).join('')}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeDasharray={s.dashed ? '5 4' : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {/* Point markers while the days are few enough to tell apart. */}
        {dates.length <= 31 &&
          series.map((s) => (
            <g key={`${s.key}-pts`}>
              {s.points.map((p) => <circle key={p.date} cx={x(idx.get(p.date)!)} cy={y(p.value)} r={2.5} fill={s.color} stroke="var(--surface)" strokeWidth={1} />)}
            </g>
          ))}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + ih} stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="3 3" />
            {series.map((s) => {
              const p = s.points.find((q) => q.date === dates[hover]);
              return p ? <circle key={s.key} cx={x(hover)} cy={y(p.value)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} /> : null;
            })}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="tooltip" style={x(hover) / W > 0.6 ? { right: `${100 - (x(hover) / W) * 100 + 2}%`, top: 8 } : { left: `${(x(hover) / W) * 100 + 2}%`, top: 8 }}>
          <div className="tooltip-title">{xTitle(dates[hover]!)}</div>
          {series.map((s) => {
            const p = s.points.find((q) => q.date === dates[hover]);
            return (
              <div key={s.key} className="t-row">
                <span><span className="dot" style={{ background: s.color }} /> {dataLabel(s.label)}</span>
                <strong>{p ? format(p.value) : '—'}</strong>
              </div>
            );
          })}
          {tooltipExtra?.(dates[hover]!)}
        </div>
      )}
    </div>
  );
}

export function SeriesTable({ series, format = (v) => num(v) }: { series: ChartSeries[]; format?: (v: number) => string }) {
  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr><th>{t('Date')}</th>{series.map((s) => <th key={s.key} className="num">{dataLabel(s.label)}</th>)}</tr>
        </thead>
        <tbody>
          {dates.map((d) => (
            <tr key={d}>
              <td className="nowrap tabular">{d} <span className="muted small">{dayLong(d).split(',')[0]}</span></td>
              {series.map((s) => {
                const p = s.points.find((q) => q.date === d);
                return <td key={s.key} className="num">{p ? format(p.value) : '—'}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Horizontal bar chart ----------

export function BarChart({ rows, format = (v) => num(v), color = 'var(--series-1)' }: {
  rows: { label: string; value: number; detail?: string }[];
  format?: (v: number) => string;
  color?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (!rows.length) return <div className="state">{t('No data for this chart.')}</div>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  const bar = 18;
  const gap = 10;
  const labelW = 260;
  const valueW = 80;
  const w = 640;
  const plotW = w - labelW - valueW;
  const h = rows.length * (bar + gap);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" onMouseLeave={() => setHover(null)}>
        {rows.map((r, i) => {
          const y0 = i * (bar + gap);
          const bw = Math.max(2, (r.value / max) * plotW);
          const shown = dataLabel(r.label);
          const label = shown.length > 42 ? `${shown.slice(0, 40)}…` : shown;
          return (
            <g key={r.label} onMouseEnter={() => setHover(i)}>
              <rect x={0} y={y0 - gap / 2} width={w} height={bar + gap} fill="transparent" />
              <text x={labelW - 8} y={y0 + bar / 2 + 4} textAnchor="end" fontSize={12} fill="var(--text-secondary)">{label}</text>
              <path d={`M${labelW},${y0} h${bw - 4} a4,4 0 0 1 4,4 v${bar - 8} a4,4 0 0 1 -4,4 h${-(bw - 4)} z`} fill={color} opacity={hover === null || hover === i ? 1 : 0.55} />
              <text x={labelW + bw + 6} y={y0 + bar / 2 + 4} fontSize={12} fill="var(--text-primary)">{format(r.value)}</text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="tooltip" style={{ left: '40%', top: `${(((hover + 1) * (bar + gap)) / h) * 100}%` }}>
          <div style={{ wordBreak: 'break-all' }}><strong>{dataLabel(rows[hover]!.label)}</strong></div>
          <div className="t-row"><span>{t('Value')}</span><strong>{format(rows[hover]!.value)}</strong></div>
          {rows[hover]!.detail && <div className="small secondary">{rows[hover]!.detail}</div>}
        </div>
      )}
    </div>
  );
}
