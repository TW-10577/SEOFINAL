import type { ReactNode } from 'react';
import { t } from '../i18n.ts';

export interface Column<T> {
  key: string;
  label: string;
  num?: boolean;
  render: (row: T) => ReactNode;
}

export function DataTable<T>({ columns, rows, rowKey, rowClass, onRowClick, selectedKey, empty }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  rowClass?: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | number | null;
  empty?: string;
}) {
  if (!rows.length) return <div className="state">{empty ?? t('No rows.')}</div>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={c.num ? 'num' : undefined}>{c.label}</th>)}</tr>
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
                {columns.map((c) => <td key={c.key} className={c.num ? 'num' : undefined}>{c.render(r)}</td>)}
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
