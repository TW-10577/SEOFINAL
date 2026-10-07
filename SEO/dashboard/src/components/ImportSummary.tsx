import type { Upload } from '@seo/shared';
import { dateTime, period } from '../format.ts';
import { DataTable } from './DataTable.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { t } from '../i18n.ts';

export function ImportSummary({ uploads, selectedId, onSelect }: { uploads: Upload[]; selectedId: number | null; onSelect: (u: Upload) => void }) {
  return (
    <DataTable
      rows={uploads}
      rowKey={(u) => u.id}
      selectedKey={selectedId}
      onRowClick={onSelect}
      empty={t('No uploads yet.')}
      columns={[
        { key: 'id', label: '#', render: (u) => u.id },
        { key: 'file', label: t('File name'), render: (u) => <strong>{u.fileName}</strong> },
        { key: 'source', label: t('Source'), render: (u) => u.source },
        { key: 'type', label: t('File type'), render: (u) => u.fileType.toUpperCase() },
        { key: 'structure', label: t('Detected structure'), render: (u) => <span className="mono">{u.structure ?? '—'}</span> },
        { key: 'rows', label: t('Rows (valid / total)'), num: true, render: (u) => `${u.validRowCount.toLocaleString()} / ${u.rowCount.toLocaleString()}` },
        { key: 'period', label: t('Analysis period'), render: (u) => <span title={u.periodNote ?? ''}>{period(u.period)}</span> },
        { key: 'import', label: t('Import status'), render: (u) => <StatusBadge status={u.importStatus} /> },
        { key: 'validation', label: t('Validation'), render: (u) => <StatusBadge status={u.validationStatus} /> },
        { key: 'warnings', label: t('Warnings'), num: true, render: (u) => (u.errorCount ? `${t('{n} error', { n: u.errorCount })} · ${u.warningCount}` : u.warningCount) },
        { key: 'time', label: t('Uploaded'), render: (u) => <span className="nowrap">{dateTime(u.uploadedAt)}</span> },
      ]}
    />
  );
}
