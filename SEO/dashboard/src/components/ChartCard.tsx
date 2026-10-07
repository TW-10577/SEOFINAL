import type { ReactNode } from 'react';
import { useMemo, useRef, useState } from 'react';
import { compact, num } from '../format.ts';
import { t } from '../i18n.ts';

/** Categorical slots in fixed order (validated palette). Assign by entity, never by rank. */
export const SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)'];

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  points: { date: string; value: number }[];
}

export function ChartCard({ title, subtitle, legend, table, children }: {
  title: string;
  subtitle?: string;
  legend?: { label: string; color: string }[];
  /** Table view of the same data (accessibility / exact values). */
  table?: ReactNode;
  children: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{t(title)}</h2>
          {subtitle && <div className="hint">{t(subtitle)}</div>}
        </div>
        {table && (
          <div className="segmented" role="group" aria-label={t('View')}>
            <button className={!showTable ? 'on' : ''} onClick={() => setShowTable(false)}>{t('Chart')}</button>
            <button className={showTable ? 'on' : ''} onClick={() => setShowTable(true)}>{t('Table')}</button>
          </div>
        )}
      </div>
      <div className="card-body">
        {legend && legend.length > 1 && !showTable && (
          <div className="legend">
            {legend.map((l) => (
              <span key={l.label}><span className="key" style={{ background: l.color }} />{l.label}</span>
            ))}
          </div>
        )}
        {showTable ? table : children}
      </div>
    </section>
  );
}

// ---------- Line chart ----------

const W = 640;
const H = 240;
const M = { top: 12, right: 16, bottom: 28, left: 56 };

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

export function LineChart({ series, format = (v) => num(v), zeroBased = true, invert = false }: {
  series: ChartSeries[];
  format?: (v: number) => string;
  zeroBased?: boolean;
  /** For position: lower is better, drawn at the top. */
  invert?: boolean;
}) {
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
              <text x={M.left - 8} y={y(t) + 4} textAnchor="end">{compact(t)}</text>
            </g>
          ))}
          {dates.map((d, i) => (i % labelEvery === 0 || i === dates.length - 1 ? <text key={d} x={x(i)} y={H - 8} textAnchor="middle">{d.slice(5)}</text> : null))}
        </g>
        {series.map((s) => (
          <path
            key={s.key}
            d={s.points.map((p, k) => `${k ? 'L' : 'M'}${x(idx.get(p.date)!)},${y(p.value)}`).join('')}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + ih} stroke="var(--text-muted)" strokeWidth={1} />
            {series.map((s) => {
              const p = s.points.find((q) => q.date === dates[hover]);
              return p ? <circle key={s.key} cx={x(hover)} cy={y(p.value)} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} /> : null;
            })}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="tooltip" style={{ left: `${Math.min(70, (x(hover) / W) * 100)}%`, top: 8 }}>
          <div className="small secondary" style={{ marginBottom: 4 }}>{dates[hover]}</div>
          {series.map((s) => {
            const p = s.points.find((q) => q.date === dates[hover]);
            return (
              <div key={s.key} className="t-row">
                <span><span className="dot" style={{ background: s.color }} /> {s.label}</span>
                <strong>{p ? format(p.value) : '—'}</strong>
              </div>
            );
          })}
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
          <tr><th>{t('Date')}</th>{series.map((s) => <th key={s.key} className="num">{s.label}</th>)}</tr>
        </thead>
        <tbody>
          {dates.map((d) => (
            <tr key={d}>
              <td className="nowrap">{d}</td>
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
          const label = r.label.length > 42 ? `${r.label.slice(0, 40)}…` : r.label;
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
          <div style={{ wordBreak: 'break-all' }}><strong>{rows[hover]!.label}</strong></div>
          <div className="t-row"><span>{t('Value')}</span><strong>{format(rows[hover]!.value)}</strong></div>
          {rows[hover]!.detail && <div className="small secondary">{rows[hover]!.detail}</div>}
        </div>
      )}
    </div>
  );
}
