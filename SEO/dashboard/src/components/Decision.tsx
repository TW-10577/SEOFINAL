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
export function Decision({ path, next, reviewer, onDone, label, blocked = {} }: { path: string; next: OntologyTransition[]; reviewer: string; onDone: () => void; label: string; blocked?: Record<string, string> }) {
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
            disabled={busy || !reviewer.trim() || !!blocked[tr.to]}
            onClick={() => go(tr.to)}
            title={blocked[tr.to] ?? (!reviewer.trim() ? t('Enter your name first') : `${tr.actionApiName}: ${t(tr.from)} → ${t(tr.to)}`)}
          >
            {tr.actionLabel} → {t(tr.to)}
          </button>
        ))}
      </div>
      {next.filter((tr) => blocked[tr.to]).map((tr) => (
        <div key={tr.id} className="small caveat">⚠ {t(tr.to)}: {blocked[tr.to]}</div>
      ))}
      {error != null && <ErrorState error={error} />}
    </div>
  );
}

/**
 * SEO team edit of generated text (modify the cause / adjust the countermeasure). The previous text is
 * kept on the server; the history is shown below the current text.
 */
export function EditText({ path, current, reviewer, onDone, label }: { path: string; current: string; reviewer: string; onDone: () => void; label: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(current);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!open)
    return (
      <button className="btn small" disabled={!reviewer.trim()} title={!reviewer.trim() ? t('Enter your name first') : undefined} onClick={() => (setText(current), setOpen(true))}>
        {t(label)}
      </button>
    );
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await postJson(path, { text, actor: reviewer, note });
      setOpen(false);
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
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} style={{ width: '100%' }} />
      <div className="row">
        <input type="text" placeholder={t('Note (optional)')} value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
        <button className="btn small primary" disabled={busy || !text.trim()} onClick={save}>{t('Save')}</button>
        <button className="btn small" disabled={busy} onClick={() => setOpen(false)}>{t('Cancel')}</button>
      </div>
      {error != null && <ErrorState error={error} />}
    </div>
  );
}

/** Who changed the generated text, when, and what it was before. */
export function EditHistory({ amendments }: { amendments: { id: number; oldValue: string; actor: string; note: string; at: string }[] }) {
  if (!amendments.length) return null;
  return (
    <ul className="small secondary" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
      {amendments.map((a) => (
        <li key={a.id}>
          {t('Changed by {actor} on {date}', { actor: a.actor, date: a.at.slice(0, 16).replace('T', ' ') })}
          {a.note ? ` — ${a.note}` : ''} · {t('before')}: “{a.oldValue}”
        </li>
      ))}
    </ul>
  );
}
