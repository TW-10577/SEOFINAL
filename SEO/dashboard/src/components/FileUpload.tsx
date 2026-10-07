import type { Source, UploadDetail } from '@seo/shared';
import { useRef, useState } from 'react';
import { api } from '../api.ts';
import { ErrorState } from './States.tsx';
import { t } from '../i18n.ts';

const TYPES = '.csv,.tsv,.txt,.xlsx,.xls';

export function FileUpload({ onUploaded }: { onUploaded: (uploads: UploadDetail[]) => void }) {
  const [source, setSource] = useState<Source>('GA4');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const input = useRef<HTMLInputElement>(null);

  // Files are imported as soon as they are dropped or chosen, under the selected source.
  async function importFiles(list: FileList | null) {
    if (!list?.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('source', source);
      for (const f of Array.from(list)) form.append('files', f);
      const res = await api<{ uploads: UploadDetail[] }>('/uploads', { method: 'POST', body: form });
      onUploaded(res.uploads);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>{t('Upload')}</h2>
        <span className="hint">{t('CSV or Excel exported from GA4 Explorations or Search Console. Structure is detected from file contents.')}</span>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="filters">
          <label className="field">
            {t('Source')}
            <div className="segmented" role="group" aria-label="Source">
              {(['GA4', 'GSC'] as Source[]).map((s) => (
                <button key={s} className={source === s ? 'on' : ''} onClick={() => setSource(s)}>{s === 'GSC' ? 'Google Search Console' : 'GA4'}</button>
              ))}
            </div>
          </label>
        </div>
        <div
          className={`dropzone${over ? ' over' : ''}`}
          aria-busy={busy}
          onClick={() => !busy && input.current?.click()}
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => (e.preventDefault(), setOver(false), importFiles(e.dataTransfer.files))}
        >
          <strong>{busy ? t('Importing…') : t('Drop files here')}</strong>
          <input ref={input} type="file" accept={TYPES} multiple hidden onChange={(e) => (importFiles(e.target.files), (e.target.value = ''))} />
        </div>
        {error != null && <ErrorState error={error} />}
      </div>
    </section>
  );
}
