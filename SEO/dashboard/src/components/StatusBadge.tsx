import { t } from '../i18n.ts';
// Status always carries an icon and a label, never color alone.
const STYLES: Record<string, { cls: string; icon: string; label?: string }> = {
  OK: { cls: 'ok', icon: '✓' },
  NG: { cls: 'ng', icon: '✕' },
  NOT_EVALUABLE: { cls: 'ne', icon: '–', label: t('NOT EVALUABLE') },
  valid: { cls: 'ok', icon: '✓', label: t('Valid') },
  valid_with_warnings: { cls: 'warn', icon: '!', label: t('Valid with warnings') },
  invalid: { cls: 'ng', icon: '✕', label: t('Invalid') },
  imported: { cls: 'ok', icon: '✓', label: t('Imported') },
  rejected: { cls: 'ng', icon: '✕', label: t('Rejected') },
  duplicate: { cls: 'warn', icon: '!', label: t('Duplicate') },
  total: { cls: '', icon: 'Σ', label: t('Total row') },
  metadata: { cls: '', icon: 'i', label: t('Metadata') },
  Detected: { cls: 'ng', icon: '●' },
  Proposed: { cls: 'info', icon: '○' },
  NotReviewed: { cls: 'warn', icon: '?', label: t('Not reviewed') },
  Confirmed: { cls: 'ok', icon: '✓' },
  Rejected: { cls: '', icon: '✕' },
  NeedsMoreEvidence: { cls: 'warn', icon: '…', label: t('Needs more evidence') },
  High: { cls: 'info', icon: '▲' },
  Medium: { cls: 'info', icon: '■' },
  Low: { cls: '', icon: '▼' },
};

export function StatusBadge({ status, title }: { status: string; title?: string }) {
  const s = STYLES[status] ?? { cls: '', icon: '•' };
  return (
    <span className={`badge ${s.cls}`} title={title}>
      <span className="icon" aria-hidden>{s.icon}</span>
      {t(s.label ?? status)}
    </span>
  );
}
