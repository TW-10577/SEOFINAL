import type { Upload } from '@seo/shared';
import { useEffect, useRef } from 'react';
import { dateTime, formatLabel, period } from '../format.ts';
import { DataTable } from './DataTable.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { Icon } from './Icon.tsx';
import { t } from '../i18n.ts';

/** Header checkbox: checked when every row is selected, indeterminate when only some are. */
function SelectAll({ total, checked, onChange }: { total: number; checked: number; onChange: (all: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = checked > 0 && checked < total;
  }, [checked, total]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={t('Select all')}
      checked={total > 0 && checked === total}
      disabled={total === 0}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

export function ImportSummary({ uploads, selectedId, onSelect, onDelete, checkedIds, onCheckedChange }: {
  uploads: Upload[];
  selectedId: number | null;
  onSelect: (u: Upload) => void;
  onDelete: (u: Upload) => void;
  /** Rows ticked for "Delete selected". */
  checkedIds: ReadonlySet<number>;
  onCheckedChange: (ids: Set<number>) => void;
}) {
  const checkedHere = uploads.filter((u) => checkedIds.has(u.id)).length;
  const toggle = (id: number, on: boolean) => {
    const next = new Set(checkedIds);
    if (on) next.add(id);
    else next.delete(id);
    onCheckedChange(next);
  };
  return (
    <DataTable
      rows={uploads}
      rowKey={(u) => u.id}
      selectedKey={selectedId}
      onRowClick={onSelect}
      empty={t('No uploads yet.')}
      columns={[
        {
          key: 'check',
          label: <SelectAll total={uploads.length} checked={checkedHere} onChange={(all) => onCheckedChange(all ? new Set(uploads.map((u) => u.id)) : new Set())} />,
          render: (u) => (
            <input
              type="checkbox"
              aria-label={t('Select {file}', { file: u.fileName })}
              checked={checkedIds.has(u.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => toggle(u.id, e.target.checked)}
            />
          ),
        },
        { key: 'id', label: '#', num: true, render: (u) => <span className="muted">{u.id}</span> },
        {
          key: 'file',
          label: t('File name'),
          render: (u) => (
            <span className="cell-file" title={u.fileName}>
              <Icon name="file" size={16} />
              <strong className="truncate">{u.fileName}</strong>
            </span>
          ),
        },
        { key: 'source', label: t('Source'), render: (u) => (u.source === 'GSC' ? 'Google Search Console' : u.source ?? t('Unknown')) },
        { key: 'type', label: t('File type'), render: (u) => <span className="badge">{formatLabel(u.fileType)}</span> },
        { key: 'structure', label: t('Detected structure'), render: (u) => <span className="mono nowrap">{u.structure ?? '—'}</span> },
        { key: 'rows', label: t('Rows (valid / total)'), num: true, render: (u) => `${u.validRowCount.toLocaleString()} / ${u.rowCount.toLocaleString()}` },
        { key: 'period', label: t('Analysis period'), render: (u) => <span className="nowrap tabular" title={u.periodNote ?? ''}>{period(u.period)}</span> },
        { key: 'import', label: t('Import status'), render: (u) => <StatusBadge status={u.importStatus} /> },
        { key: 'validation', label: t('Validation'), render: (u) => <StatusBadge status={u.validationStatus} /> },
        { key: 'warnings', label: t('Warnings'), num: true, render: (u) => (u.errorCount ? `${t('{n} error', { n: u.errorCount })} · ${u.warningCount}` : u.warningCount) },
        { key: 'time', label: t('Uploaded'), render: (u) => <span className="nowrap tabular muted">{dateTime(u.uploadedAt)}</span> },
        {
          key: 'delete',
          stickyEnd: true,
          label: <span className="visually-hidden">{t('Delete')}</span>,
          render: (u) => (
            <button className="btn icon small ghost danger-hover" onClick={(e) => (e.stopPropagation(), onDelete(u))} title={t('Delete')} aria-label={t('Delete {file}', { file: u.fileName })}>
              <Icon name="trash" size={15} />
            </button>
          ),
        },
      ]}
    />
  );
}
