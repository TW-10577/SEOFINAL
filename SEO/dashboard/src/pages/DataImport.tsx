import type { ImportedRow, RawRecord, Upload, UploadDetail } from '@seo/shared';
import { useEffect, useState } from 'react';
import { api, query } from '../api.ts';
import { DataQualityWarnings } from '../components/DataQualityWarnings.tsx';
import { DataTable, Pager } from '../components/DataTable.tsx';
import { FileUpload } from '../components/FileUpload.tsx';
import { ImportSummary } from '../components/ImportSummary.tsx';
import { EmptyState, ErrorState, LoadingState } from '../components/States.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { useApi } from '../components/useApi.ts';
import { metricValue, period } from '../format.ts';
import { t } from '../i18n.ts';

const LIMIT = 100;

export function DataImportPage({ onContinue }: { onContinue: () => void }) {
  const uploads = useApi<Upload[]>('/uploads');
  const [selected, setSelected] = useState<number | null>(null);
  const [justImported, setJustImported] = useState<UploadDetail[] | null>(null);

  useEffect(() => {
    if (selected === null && uploads.data?.length) setSelected(uploads.data[0]!.id);
  }, [uploads.data, selected]);

  return (
    <>
      <FileUpload
        onUploaded={(list) => {
          setJustImported(list);
          setSelected(list[0]?.id ?? null);
          uploads.reload();
        }}
      />
      {justImported && (
        <div className={`notice ${justImported.some((u) => u.importStatus === 'rejected') ? 'warn' : 'info'}`}>
          <strong>{t('Import finished.')}</strong>{' '}
          {t('{ok} imported, {rejected} rejected.', { ok: justImported.filter((u) => u.importStatus === 'imported').length, rejected: justImported.filter((u) => u.importStatus === 'rejected').length })}
          <ul>
            {justImported.map((u) => (
              <li key={u.id}>
                {u.fileName}: <StatusBadge status={u.importStatus} /> {u.importStatus === 'rejected' ? u.issues.find((i) => i.severity === 'error')?.message : t('{valid} valid of {total} rows, {warnings} warning(s)', { valid: u.validRowCount, total: u.rowCount, warnings: u.warningCount })}
              </li>
            ))}
          </ul>
        </div>
      )}
      <section className="card">
        <div className="card-head">
          <h2>{t('Imported files')}</h2>
          <span className="spacer" />
          <button className="btn" onClick={onContinue} disabled={!uploads.data?.some((u) => u.importStatus === 'imported')}>{t('Continue to Data →')}</button>
        </div>
        <div className="card-body">
          {uploads.loading && !uploads.data && <LoadingState />}
          {uploads.error != null && <ErrorState error={uploads.error} onRetry={uploads.reload} />}
          {uploads.data && <ImportSummary uploads={uploads.data} selectedId={selected} onSelect={(u) => setSelected(u.id)} />}
        </div>
      </section>
      {selected !== null && <UploadDetailView id={selected} onDeleted={() => (setSelected(null), uploads.reload())} />}
    </>
  );
}

function UploadDetailView({ id, onDeleted }: { id: number; onDeleted: () => void }) {
  const detail = useApi<UploadDetail>(`/uploads/${id}`);
  const [view, setView] = useState<'source' | 'normalized'>('source');
  const [offset, setOffset] = useState(0);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  useEffect(() => setOffset(0), [id, view]);
  const raw = useApi<{ total: number; rows: RawRecord[] }>(view === 'source' ? `/uploads/${id}/data${query({ limit: LIMIT, offset })}` : null);
  const norm = useApi<{ total: number; rows: ImportedRow[] }>(view === 'normalized' ? `/data${query({ uploadId: id, includeInvalid: true, limit: LIMIT, offset })}` : null);

  if (detail.error) return <ErrorState error={detail.error} />;
  if (!detail.data) return <LoadingState />;
  const u = detail.data;
  const columns = raw.data?.rows.length ? [...new Set(raw.data.rows.flatMap((r) => Object.keys(r.values)))] : [];
  const meta = Object.entries(u.metadata);

  async function remove() {
    if (!confirm(t('Delete upload #{id} ({file}) and its imported rows?', { id: u.id, file: u.fileName }))) return;
    try {
      await api(`/uploads/${u.id}`, { method: 'DELETE' });
      onDeleted();
    } catch (e) {
      setDeleteError(e);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>#{u.id} {u.fileName}</h2>
          <div className="hint">
            {u.source} · {u.fileType.toUpperCase()} · {u.structure ?? t('structure not recognised')} · {t('period')} {period(u.period)}
            {u.periodNote ? ` (${u.periodNote})` : ''} · schema v{u.schemaVersion}
          </div>
        </div>
        <div className="row">
          <div className="segmented" role="group" aria-label={t('Records view')}>
            <button className={view === 'source' ? 'on' : ''} onClick={() => setView('source')}>{t('Source records')}</button>
            <button className={view === 'normalized' ? 'on' : ''} onClick={() => setView('normalized')}>{t('Normalized data')}</button>
          </div>
          <button className="btn small" onClick={remove}>{t('Delete')}</button>
        </div>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {deleteError != null && <ErrorState error={deleteError} />}
        <DataQualityWarnings issues={u.issues} />
        {meta.length > 0 && (
          <details>
            <summary className="small secondary">{t('Export metadata (comments, filters)')}</summary>
            <pre className="report" style={{ maxHeight: 200 }}>{JSON.stringify(u.metadata, null, 2)}</pre>
          </details>
        )}
        {view === 'source' && (
          <div>
            <h3>{t('Imported records — line by line, as exported')}</h3>
            {raw.loading && !raw.data && <LoadingState />}
            {raw.data && (
              <>
                <DataTable
                  rows={raw.data.rows}
                  rowKey={(r) => r.id}
                  rowClass={(r) => `row-${r.status}`}
                  empty={t('No records (file rejected).')}
                  columns={[
                    { key: 'row', label: t('Row'), num: true, render: (r) => r.rowNumber },
                    { key: 'status', label: t('Status'), render: (r) => <StatusBadge status={r.status} /> },
                    ...columns.map((c) => ({ key: c, label: c, render: (r: RawRecord) => r.values[c] ?? '' })),
                    { key: 'issues', label: t('Issues'), render: (r) => <span className="small">{r.issues.join('; ')}</span> },
                  ]}
                />
                <Pager total={raw.data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
              </>
            )}
          </div>
        )}
        {view === 'normalized' && (
          <div>
            <h3>{t('Normalized SEO data — one metric value per row, linked to its source record')}</h3>
            {norm.data && (
              <>
                <DataTable
                  rows={norm.data.rows}
                  rowKey={(r) => r.id}
                  rowClass={(r) => (r.isValid ? '' : 'row-invalid')}
                  columns={[
                    { key: 'rec', label: t('Source record'), num: true, render: (r) => r.sourceRecordId },
                    { key: 'date', label: t('data_date'), render: (r) => r.dataDate ?? <span className="muted">{period(r.periodStart ? { start: r.periodStart, end: r.periodEnd! } : null)}</span> },
                    { key: 'dim', label: t('Subject'), render: (r) => r.segment ?? r.query ?? r.pageUrl ?? r.device ?? r.country ?? r.searchAppearance ?? 'site' },
                    { key: 'ts', label: t('traffic_source'), render: (r) => r.trafficSource ?? '' },
                    { key: 'metric', label: t('metric_name'), render: (r) => <span className="mono">{r.metricName}</span> },
                    { key: 'smetric', label: t('Source column'), render: (r) => r.sourceMetricName },
                    { key: 'value', label: t('metric_value'), num: true, render: (r) => metricValue(r.metricName, r.metricValue) },
                    { key: 'valid', label: t('Valid'), render: (r) => (r.isValid ? t('yes') : <StatusBadge status="invalid" />) },
                  ]}
                />
                <Pager total={norm.data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
              </>
            )}
          </div>
        )}
        {u.importStatus === 'rejected' && <EmptyState title="Nothing was imported from this file.">{t('See the errors above.')}</EmptyState>}
      </div>
    </section>
  );
}
