import type { Source, UploadDetail } from '@seo/shared';
import { useRef, useState } from 'react';
import { api } from '../api.ts';
import { t } from '../i18n.ts';
import { ErrorState } from './States.tsx';
import { Icon } from './Icon.tsx';
import { useToast } from './Toast.tsx';

/** Per-file result returned by the API: detected source, applied rules, analysis result. */
export interface UploadAnalysis {
  uploadId: number;
  fileName: string;
  source: Source | null;
  detectedBy: 'layout' | 'fields' | 'user' | 'none';
  signals: string[];
  validation: string[];
  appliedRules: { ruleId: string; name: string; role: 'judgment' | 'supporting_evidence' }[];
  results: { ruleId: string; name: string; status: string; result: string; measurementId: number; anomalyId: number | null }[];
  note: string | null;
  needsSource: boolean;
}

export interface UploadResponse {
  uploads: UploadDetail[];
  analysis: { runId: number | null; uploads: UploadAnalysis[] };
}

/** Upload. GA4 vs Search Console is detected from each file's contents by the API. */
export function FileUpload({ onUploaded }: { onUploaded: (res: UploadResponse) => void }) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();

  async function run(fn: () => Promise<UploadResponse>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      onUploaded(res);
      const ok = res.uploads.filter((u) => u.importStatus === 'imported');
      const bad = res.uploads.filter((u) => u.importStatus !== 'imported');
      if (ok.length) toast('success', t('{n} file(s) imported', { n: ok.length }), ok.map((u) => u.fileName).join(', '));
      if (bad.length) toast('error', t('{n} file(s) could not be imported', { n: bad.length }), bad.map((u) => u.fileName).join(', '));
    } catch (e) {
      setError(e);
      toast('error', t('Upload failed'), (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Imported as soon as files are dropped or chosen; GA4 vs Search Console is detected from the contents.
  function importFiles(list: FileList | null) {
    if (!list?.length || busy) return;
    const form = new FormData();
    for (const f of Array.from(list)) form.append('files', f);
    void run(() => api<UploadResponse>('/uploads', { method: 'POST', body: form }));
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2><Icon name="upload" size={18} /> {t('Upload')}</h2>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div
          className={`dropzone${over ? ' over' : ''}`}
          role="button"
          tabIndex={0}
          aria-busy={busy}
          aria-label={t('Upload files')}
          onClick={() => !busy && input.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), !busy && input.current?.click())}
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
          onDrop={(e) => (e.preventDefault(), setOver(false), importFiles(e.dataTransfer.files))}
        >
          <span className="dropzone-icon"><Icon name={busy ? 'loader' : 'upload'} size={20} className={busy ? 'spin' : undefined} /></span>
          <div className="dropzone-title">
            {busy ? t('Importing…') : over ? t('Release to import') : t('Drop files here')}
          </div>
          {!busy && (
            <span className="btn primary small dropzone-btn" aria-hidden>
              <Icon name="file" size={14} />
              {t('Choose files')}
            </span>
          )}
          <input ref={input} type="file" multiple hidden onChange={(e) => (importFiles(e.target.files), (e.target.value = ''))} />
        </div>
        {error != null && <ErrorState error={error} />}
      </div>
    </section>
  );
}
