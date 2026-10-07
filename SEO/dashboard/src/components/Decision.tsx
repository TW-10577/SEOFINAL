import { useState } from 'react';
import { postJson } from '../api.ts';
import { ErrorState } from './States.tsx';
import type { OntologyTransition } from './ontology.tsx';
import { t } from '../i18n.ts';

const REVIEWER_KEY = 'logos-seo-reviewer';

export function readReviewer(): string {
  try {
    return localStorage.getItem(REVIEWER_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveReviewer(name: string) {
  try {
    localStorage.setItem(REVIEWER_KEY, name);
  } catch {
    /* per-viewer convenience only */
  }
}

/** SEO team decision buttons: one per transition the ontology lifecycle allows from the current state. The system never presses these. */
export function Decision({ path, next, reviewer, onDone, label }: { path: string; next: OntologyTransition[]; reviewer: string; onDone: () => void; label: string }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!next.length) return <div className="small muted">{t('No further {label} change available.', { label: t(label) })}</div>;
  async function go(to: string) {
    setBusy(true);
    setError(null);
    try {
      await postJson(path, { to, actor: reviewer, note });
      setNote('');
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
      <div className="row">
        <span className="small secondary">{t('SEO team decision:')}</span>
        <input type="text" placeholder={t('Note (optional)')} value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
        {next.map((tr) => (
          <button
            key={tr.id}
            className="btn small"
            disabled={busy || !reviewer.trim()}
            onClick={() => go(tr.to)}
            title={!reviewer.trim() ? t('Enter your name first') : `${tr.actionApiName}: ${t(tr.from)} → ${t(tr.to)}`}
          >
            {tr.actionLabel} → {t(tr.to)}
          </button>
        ))}
      </div>
      {error != null && <ErrorState error={error} />}
    </div>
  );
}
