import type { ImportedRow, RawRecord, Upload, UploadDetail } from '@seo/shared';
import { useEffect, useRef, useState } from 'react';
import { api, query } from '../api.ts';
import { DataQualityWarnings } from '../components/DataQualityWarnings.tsx';
import { DataTable, Pager, ShowMore } from '../components/DataTable.tsx';
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
/** Records shown in each tab before "Show more". */
const PREVIEW = 5;

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
  // A row click shows that file's details below the table; scroll there so the click visibly does something.
  const detailRef = useRef<HTMLDivElement>(null);
  const [reveal, setReveal] = useState(0);
  useEffect(() => {
    if (reveal) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [reveal]);
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
          <div>
            <h2>
              {t('Imported files')} {uploads.data && <span className="count">{uploads.data.length}</span>}
            </h2>
          </div>
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
          {uploads.data && uploads.data.length > 0 && <ImportSummary uploads={uploads.data} selectedId={selected} onSelect={(u) => (setSelected(u.id), setJustUploaded([]), setReveal((n) => n + 1))} onDelete={remove} checkedIds={checked} onCheckedChange={setChecked} />}
        </div>
      </section>
      <div ref={detailRef} style={{ scrollMarginTop: 16 }}>
        {selected !== null && <UploadDetailView id={selected} onDeleted={() => afterDelete(selected)} />}
      </div>
    </>
  );
}

function UploadDetailView({ id, onDeleted }: { id: number; onDeleted: () => void }) {
  const detail = useApi<UploadDetail>(`/uploads/${id}`);
  const [view, setView] = useState<'source' | 'normalized'>('source');
  const [offset, setOffset] = useState(0);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  useEffect(() => setOffset(0), [id, view]);
  // Each tab starts with the first records only; expanding shows the whole loaded page. Per tab, reset for another file.
  const [expanded, setExpanded] = useState({ source: false, normalized: false });
  useEffect(() => setExpanded({ source: false, normalized: false }), [id]);
  const toggle = (tab: 'source' | 'normalized') => setExpanded((e) => ({ ...e, [tab]: !e[tab] }));
  const raw = useApi<{ total: number; rows: RawRecord[] }>(view === 'source' ? `/uploads/${id}/data${query({ limit: LIMIT, offset })}` : null);
  const norm = useApi<{ total: number; rows: ImportedRow[] }>(view === 'normalized' ? `/data${query({ uploadId: id, includeInvalid: true, limit: LIMIT, offset })}` : null);

  // A deleted upload simply disappears; any other failure is shown.
  if (detail.error) return /not found/i.test(String((detail.error as Error).message)) ? null : <ErrorState error={detail.error} />;
  if (!detail.data) return <LoadingState />;
  const u = detail.data;
  const columns = raw.data?.rows.length ? [...new Set(raw.data.rows.flatMap((r) => Object.keys(r.values)))] : [];

  async function remove() {
    if (!confirm(t('Delete upload #{id} ({file}) and its imported rows? Measurement results that used it are recalculated.', { id: u.id, file: u.fileName }))) return;
    try {
      await api(`/uploads/${u.id}`, { method: 'DELETE' });
      onDeleted();
    } catch (e) {
      setDeleteError(e);
    }
  }

  // Raw cells are text as exported: a column whose values are all numbers is right-aligned like other figures.
  const numericCol = (c: string) => {
    const vals = (raw.data?.rows ?? []).filter((r) => r.status !== 'total' && r.status !== 'metadata').map((r) => (r.values[c] ?? '').trim()).filter(Boolean);
    return vals.length > 0 && vals.every((v) => /^-?[\d,]+(\.\d+)?%?$/.test(v)) && !/date|日付/i.test(c);
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2 style={{ minWidth: 0, flex: '1 1 320px' }}>
          <span className="truncate" title={u.fileName}>{u.fileName}</span>
        </h2>
        <div className="card-actions">
          <button className="btn danger small" onClick={remove}><Icon name="trash" size={14} />{t('Delete')}</button>
        </div>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="facts-grid">
          <div className="fact">
            <span className="fact-label">{t('Source')}</span>
            <span className="fact-value">{u.source === 'GSC' ? 'Google Search Console' : u.source === 'GA4' ? 'Google Analytics 4' : u.source ?? t('Unknown')}</span>
          </div>
          <div className="fact" title={u.periodNote ?? ''}>
            <span className="fact-label">{t('Date coverage')}</span>
            <span className="fact-value">{period(u.period)}</span>
          </div>
          <div className="fact">
            <span className="fact-label">{t('Rows')}</span>
            <span className="fact-value" title={`${u.validRowCount.toLocaleString()} / ${u.rowCount.toLocaleString()}`}>{u.validRowCount.toLocaleString()}</span>
          </div>
          <div className="fact">
            <span className="fact-label">{t('Import / validation')}</span>
            <span className="fact-value"><StatusBadge status={u.importStatus} /><StatusBadge status={u.validationStatus} /></span>
          </div>
        </div>
        {deleteError != null && <ErrorState error={deleteError} />}
        <DataQualityWarnings issues={u.issues} />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>
            {view === 'source' ? t('Imported records') : t('Normalized data')}
          </h3>
          <div className="segmented" role="tablist" aria-label={t('Records view')}>
            <button role="tab" aria-selected={view === 'source'} className={view === 'source' ? 'on' : ''} onClick={() => setView('source')}><Icon name="file" size={14} />{t('Source records')}</button>
            <button role="tab" aria-selected={view === 'normalized'} className={view === 'normalized' ? 'on' : ''} onClick={() => setView('normalized')}><Icon name="database" size={14} />{t('Normalized data')}</button>
          </div>
        </div>
        {view === 'source' && (
          <div>
            {raw.loading && !raw.data && <LoadingState />}
            {raw.data && (
              <>
                <DataTable
                  rows={expanded.source ? raw.data.rows : raw.data.rows.slice(0, PREVIEW)}
                  rowKey={(r) => r.id}
                  rowClass={(r) => `row-${r.status}`}
                  empty={t('No records — nothing could be imported from this file.')}
                  columns={[
                    { key: 'row', label: t('Row'), num: true, render: (r) => r.rowNumber },
                    { key: 'status', label: t('Status'), render: (r) => <StatusBadge status={r.status} /> },
                    ...columns.map((c) => ({ key: c, label: dataLabel(c), num: numericCol(c), render: (r: RawRecord) => dataLabel(r.values[c] ?? '') })),
                    { key: 'issues', label: t('Issues'), className: 'cell-note', render: (r) => (r.issues.length ? r.issues.join('; ') : <span className="muted">—</span>) },
                  ]}
                />
                <RecordsFoot total={raw.data.total} offset={offset} onPage={setOffset} expanded={expanded.source} onToggle={() => toggle('source')} />
              </>
            )}
          </div>
        )}
        {view === 'normalized' && (
          <div>
            {norm.loading && !norm.data && <LoadingState />}
            {norm.data && (
              <>
                <DataTable
                  rows={expanded.normalized ? norm.data.rows : norm.data.rows.slice(0, PREVIEW)}
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
                <RecordsFoot total={norm.data.total} offset={offset} onPage={setOffset} expanded={expanded.normalized} onToggle={() => toggle('normalized')} />
              </>
            )}
          </div>
        )}
        {u.importStatus !== 'imported' && <EmptyState title="Nothing was imported from this file.">{t('See the errors above.')}</EmptyState>}
      </div>
    </section>
  );
}

/**
 * Under a records table: collapsed, only "Show more (n records)" at the right (n = records not shown); expanded, the
 * pager on the left and "Show less" at the right.
 */
function RecordsFoot({ total, offset, onPage, expanded, onToggle }: { total: number; offset: number; onPage: (o: number) => void; expanded: boolean; onToggle: () => void }) {
  if (total <= PREVIEW) return <Pager total={total} limit={LIMIT} offset={offset} onChange={onPage} />;
  return (
    <div className="table-foot">
      {expanded && <Pager total={total} limit={LIMIT} offset={offset} onChange={onPage} />}
      <ShowMore hidden={total - PREVIEW} expanded={expanded} onToggle={onToggle} one="Show more (1 record)" many="Show more ({n} records)" />
    </div>
  );
}
