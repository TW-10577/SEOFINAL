import type { Upload } from '@seo/shared';
import { useEffect, useRef, useState } from 'react';
import { dateTime, formatLabel, period } from '../format.ts';
import { DataTable, ShowMore } from './DataTable.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { Icon } from './Icon.tsx';
import { t } from '../i18n.ts';

/** Files shown before "Show more". */
const COLLAPSED = 2;

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
  // Collapsed: only the first files are rendered. Selections, deletes and the context use the full list, so expanding
  // or collapsing never reloads data or changes what is ticked.
  const [showAllFiles, setShowAllFiles] = useState(false);
  const hidden = Math.max(0, uploads.length - COLLAPSED);
  const rows = showAllFiles ? uploads : uploads.slice(0, COLLAPSED);
  return (
    <>
    <DataTable
      rows={rows}
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
        {
          key: 'file',
          label: t('File name'),
          render: (u) => (
            <span className="cell-file" title={u.fileName}>
              <Icon name="file" size={16} />
              <span style={{ minWidth: 0 }}>
                <strong className="truncate" style={{ display: 'block' }}>{u.fileName}</strong>
                <span className="cell-sub mono truncate">{u.structure ?? '—'}</span>
              </span>
            </span>
          ),
        },
        {
          key: 'source',
          label: t('Source'),
          render: (u) => (
            <span className="nowrap">
              {u.source === 'GSC' ? 'Search Console' : u.source ?? t('Unknown')}
              <span className="cell-sub">{formatLabel(u.fileType)}</span>
            </span>
          ),
        },
        { key: 'rows', label: t('Rows'), num: true, render: (u) => <span title={`${u.validRowCount.toLocaleString()} / ${u.rowCount.toLocaleString()}`}>{u.validRowCount.toLocaleString()}</span> },
        { key: 'period', label: t('Analysis period'), render: (u) => <span className="nowrap tabular" title={u.periodNote ?? ''}>{period(u.period)}</span> },
        {
          // Imported files show their validation; files that were not imported show why.
          key: 'status',
          label: t('Status'),
          render: (u) =>
            u.importStatus === 'imported' ? (
              <StatusBadge status={u.validationStatus} title={`${t('Imported')} · ${t(u.validationStatus === 'valid' ? 'Valid' : u.validationStatus === 'invalid' ? 'Invalid' : 'Valid with warnings')}`} />
            ) : (
              <StatusBadge status={u.importStatus} />
            ),
        },
        {
          key: 'warnings',
          label: t('Warnings'),
          num: true,
          render: (u) => (u.errorCount ? <span className="nowrap" style={{ color: 'var(--critical)' }}>{t('{n} error', { n: u.errorCount })} · {u.warningCount}</span> : u.warningCount ? <span style={{ color: 'var(--warning)' }}>{u.warningCount}</span> : <span className="muted">0</span>),
        },
        { key: 'time', label: t('Uploaded'), render: (u) => <span className="nowrap tabular muted small">{dateTime(u.uploadedAt)}</span> },
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
    {hidden > 0 && (
      <div className="show-more">
        <ShowMore hidden={hidden} expanded={showAllFiles} onToggle={() => setShowAllFiles((v) => !v)} one="Show more (1 file)" many="Show more ({n} files)" />
      </div>
    )}
    </>
  );
}
