import type { ReactNode } from 'react';
import { t } from '../i18n.ts';
import { Icon } from './Icon.tsx';

export interface Column<T> {
  key: string;
  label: ReactNode;
  num?: boolean;
  /** Keep the column visible at the right edge while the table scrolls sideways (row actions). */
  stickyEnd?: boolean;
  /** Extra class on the column's body cells (e.g. `cell-note` for long text). */
  className?: string;
  render: (row: T) => ReactNode;
}

const cls = <T,>(c: Column<T>, body = false) => [c.num ? 'num' : '', c.stickyEnd ? 'sticky-end' : '', body ? c.className ?? '' : ''].filter(Boolean).join(' ') || undefined;

export function DataTable<T>({ columns, rows, rowKey, rowClass, onRowClick, selectedKey, empty, variant }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  rowClass?: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | number | null;
  empty?: string;
  /** `compact`: single-line rows, smaller text, ~400px tall with a sticky header. */
  variant?: 'compact';
}) {
  if (!rows.length) return <div className="state table-empty">{empty ?? t('No rows.')}</div>;
  return (
    <div className={variant ? `table-wrap ${variant}` : 'table-wrap'}>
      <table className="data">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={cls(c)}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const k = rowKey(r);
            return (
              <tr
                key={k}
                className={[rowClass?.(r), onRowClick ? 'clickable' : '', selectedKey === k ? 'selected' : ''].filter(Boolean).join(' ')}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
              >
                {columns.map((c) => <td key={c.key} className={cls(c, true)}>{c.render(r)}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ total, limit, offset, onChange }: { total: number; limit: number; offset: number; onChange: (offset: number) => void }) {
  if (total <= limit) return <div className="pager">{t('{n} rows', { n: total.toLocaleString() })}</div>;
  return (
    <div className="pager">
      <span>{t('{from}–{to} of {total}', { from: (offset + 1).toLocaleString(), to: Math.min(offset + limit, total).toLocaleString(), total: total.toLocaleString() })}</span>
      <button className="btn small" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>{t('Previous page')}</button>
      <button className="btn small" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>{t('Next page')}</button>
    </div>
  );
}

/**
 * Small "Show more (n …) / Show less" text link at the bottom-right of a table. Rendering only: the caller keeps the
 * expanded state and the full rows, so toggling never reloads data.
 */
export function ShowMore({ hidden, expanded, onToggle, one, many }: { hidden: number; expanded: boolean; onToggle: () => void; one: string; many: string }) {
  if (hidden <= 0 && !expanded) return null;
  return (
    <button className="show-more-btn" onClick={onToggle} aria-expanded={expanded}>
      {expanded ? t('Show less') : hidden === 1 ? t(one) : t(many, { n: hidden.toLocaleString() })}
      <Icon name="chevronDown" size={13} className={expanded ? 'flip' : undefined} />
    </button>
  );
}
