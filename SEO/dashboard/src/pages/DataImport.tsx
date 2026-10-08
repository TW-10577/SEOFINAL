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
import { Icon } from '../components/Icon.tsx';
import { useToast } from '../components/Toast.tsx';
import { formatLabel, metricValue, period } from '../format.ts';
import { t } from '../i18n.ts';
import { dataLabel } from '../i18n.ts';

const LIMIT = 100;

/**
 * onContinue gets the active import context: the ticked files, else the files just uploaded, else the selected
 * file. The Data, Measurements and Report tabs then follow those files and their own period.
 */
export function DataImportPage({ onContinue }: { onContinue: (uploads: number[]) => void }) {
  const uploads = useApi<Upload[]>('/uploads');
  const [selected, setSelected] = useState<number | null>(null);
  const [justUploaded, setJustUploaded] = useState<number[]>([]);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();

  // Forget ticks for uploads that no longer exist.
  useEffect(() => {
    if (!uploads.data) return;
    const ids = new Set(uploads.data.map((u) => u.id));
    setChecked((prev) => (([...prev].every((id) => ids.has(id))) ? prev : new Set([...prev].filter((id) => ids.has(id)))));
  }, [uploads.data]);

  /** Deletes every ticked upload after one confirmation; blocked ones stay ticked with their reason. */
  async function removeSelected() {
    const targets = (uploads.data ?? []).filter((u) => checked.has(u.id));
    if (!targets.length) return;
    if (!confirm(t('Are you sure you want to delete the selected files? ({n} files) Measurement results that used them are recalculated.', { n: targets.length }))) return;
    setDeleting(true);
    setDeleteError(null);
    const failed: string[] = [];
    const deleted: number[] = [];
    for (const u of targets) {
      try {
        await api(`/uploads/${u.id}`, { method: 'DELETE' });
        deleted.push(u.id);
      } catch (e) {
        failed.push(`#${u.id} ${u.fileName}: ${(e as Error).message}`);
      }
    }
    setChecked(new Set(targets.filter((u) => !deleted.includes(u.id)).map((u) => u.id)));
    if (selected !== null && deleted.includes(selected)) setSelected(uploads.data?.find((x) => !deleted.includes(x.id))?.id ?? null);
    if (failed.length) setDeleteError(new Error(t('{n} file(s) could not be deleted: {list}', { n: failed.length, list: failed.join(' / ') })));
    if (deleted.length) toast('success', t('{n} file(s) deleted', { n: deleted.length }));
    setDeleting(false);
    uploads.reload();
  }

  // After a delete, show the next remaining upload (never the deleted one from the old list).
  function afterDelete(id: number) {
    if (selected === id) setSelected(uploads.data?.find((x) => x.id !== id)?.id ?? null);
    uploads.reload();
  }

  // Delete from the table row: confirm, delete, refresh. A blocked delete shows the server's reason.
  async function remove(u: Upload) {
    if (!confirm(t('Delete upload #{id} ({file}) and its imported rows? Measurement results that used it are recalculated.', { id: u.id, file: u.fileName }))) return;
    setDeleteError(null);
    try {
      await api(`/uploads/${u.id}`, { method: 'DELETE' });
      afterDelete(u.id);
      toast('success', t('{n} file(s) deleted', { n: 1 }), u.fileName);
    } catch (e) {
      setDeleteError(e);
      toast('error', t('Delete failed'), (e as Error).message);
    }
  }

  useEffect(() => {
    if (selected === null && uploads.data?.length) setSelected(uploads.data[0]!.id);
  }, [uploads.data, selected]);

  /** Files for the next steps: ticked files, else the batch just uploaded, else the selected file (imported only). */
  function continueContext(): number[] {
    const imported = new Set((uploads.data ?? []).filter((u) => u.importStatus === 'imported').map((u) => u.id));
    const pick = checked.size ? [...checked] : justUploaded.length ? justUploaded : selected !== null ? [selected] : [];
    return pick.filter((id) => imported.has(id));
  }

  return (
    <>
      <FileUpload
        onUploaded={(res) => {
          setSelected(res.uploads[0]?.id ?? null);
          setJustUploaded(res.uploads.filter((u) => u.importStatus === 'imported').map((u) => u.id));
          uploads.reload();
        }}
      />
      <section className="card">
        <div className="card-head">
          <h2>
            {t('Imported files')} {uploads.data && <span className="count">{uploads.data.length}</span>}
          </h2>
          <span className="spacer" />
          {checked.size > 0 && (
            <button className="btn danger" onClick={removeSelected} disabled={deleting}>
              <Icon name="trash" size={15} />
              {deleting ? t('Deleting…') : t('Delete selected ({n})', { n: checked.size })}
            </button>
          )}
          <button
            className="btn primary"
            onClick={() => onContinue(continueContext())}
            disabled={!uploads.data?.some((u) => u.importStatus === 'imported')}
          >
            {t('Continue to Data')}
            <Icon name="arrowRight" size={16} />
          </button>
        </div>
        <div className="card-body">
          {uploads.loading && !uploads.data && <LoadingState />}
          {uploads.error != null && <ErrorState error={uploads.error} onRetry={uploads.reload} />}
          {deleteError != null && <ErrorState error={deleteError} />}
          {uploads.data && uploads.data.length === 0 && <EmptyState title="No uploads yet." icon="upload">{t('Drop GA4 or Search Console exports above to start.')}</EmptyState>}
          {uploads.data && uploads.data.length > 0 && <ImportSummary uploads={uploads.data} selectedId={selected} onSelect={(u) => (setSelected(u.id), setJustUploaded([]))} onDelete={remove} checkedIds={checked} onCheckedChange={setChecked} />}
        </div>
      </section>
      {selected !== null && <UploadDetailView id={selected} onDeleted={() => afterDelete(selected)} />}
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

  // A deleted upload simply disappears; any other failure is shown.
  if (detail.error) return /not found/i.test(String((detail.error as Error).message)) ? null : <ErrorState error={detail.error} />;
  if (!detail.data) return <LoadingState />;
  const u = detail.data;
  const columns = raw.data?.rows.length ? [...new Set(raw.data.rows.flatMap((r) => Object.keys(r.values)))] : [];
  const meta = Object.entries(u.metadata);

  async function remove() {
    if (!confirm(t('Delete upload #{id} ({file}) and its imported rows? Measurement results that used it are recalculated.', { id: u.id, file: u.fileName }))) return;
    try {
      await api(`/uploads/${u.id}`, { method: 'DELETE' });
      onDeleted();
    } catch (e) {
      setDeleteError(e);
    }
  }

  return (
    <section className="card">
      <div className="card-head" style={{ alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, flex: 1 }}>
          <h2 style={{ minWidth: 0 }}>
            <Icon name="file" size={18} />
            <span className="muted">#{u.id}</span>
            <span className="truncate" title={u.fileName}>{u.fileName}</span>
            <StatusBadge status={u.importStatus} />
          </h2>
          <div className="meta">
            <span className="meta-item"><span className="k">{t('Source')}</span><span className="v">{u.source === 'GSC' ? 'Search Console' : u.source ?? t('Unknown')}</span></span>
            <span className="meta-item"><span className="k">{t('File type')}</span><span className="v">{formatLabel(u.fileType)}</span></span>
            <span className="meta-item"><span className="k">{t('Structure')}</span><span className="v mono">{u.structure ?? t('structure not recognised')}</span></span>
            <span className="meta-item" title={u.periodNote ?? ''}><span className="k">{t('Period')}</span><span className="v tabular">{period(u.period)}</span></span>
            <span className="meta-item"><span className="k">{t('Schema')}</span><span className="v">v{u.schemaVersion}</span></span>
          </div>
        </div>
        <div className="row">
          <div className="segmented" role="tablist" aria-label={t('Records view')}>
            <button role="tab" aria-selected={view === 'source'} className={view === 'source' ? 'on' : ''} onClick={() => setView('source')}><Icon name="file" size={14} />{t('Source records')}</button>
            <button role="tab" aria-selected={view === 'normalized'} className={view === 'normalized' ? 'on' : ''} onClick={() => setView('normalized')}><Icon name="database" size={14} />{t('Normalized data')}</button>
          </div>
          <button className="btn danger small" onClick={remove}><Icon name="trash" size={14} />{t('Delete')}</button>
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
                  empty={t('No records — nothing could be imported from this file.')}
                  columns={[
                    { key: 'row', label: t('Row'), num: true, render: (r) => r.rowNumber },
                    { key: 'status', label: t('Status'), render: (r) => <StatusBadge status={r.status} /> },
                    ...columns.map((c) => ({ key: c, label: dataLabel(c), render: (r: RawRecord) => dataLabel(r.values[c] ?? '') })),
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
                    { key: 'dim', label: t('Subject'), render: (r) => dataLabel(r.segment ?? r.query ?? r.pageUrl ?? r.device ?? r.country ?? r.searchAppearance ?? 'site') },
                    { key: 'ts', label: t('traffic_source'), render: (r) => r.trafficSource ?? '' },
                    { key: 'metric', label: t('metric_name'), render: (r) => <span className="mono">{r.metricName}</span> },
                    { key: 'smetric', label: t('Source column'), render: (r) => dataLabel(r.sourceMetricName) },
                    { key: 'value', label: t('metric_value'), num: true, render: (r) => metricValue(r.metricName, r.metricValue) },
                    { key: 'valid', label: t('Valid'), render: (r) => (r.isValid ? t('yes') : <StatusBadge status="invalid" />) },
                  ]}
                />
                <Pager total={norm.data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
              </>
            )}
          </div>
        )}
        {u.importStatus !== 'imported' && <EmptyState title="Nothing was imported from this file.">{t('See the errors above.')}</EmptyState>}
      </div>
    </section>
  );
}
