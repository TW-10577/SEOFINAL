import { t } from '../i18n.ts';
import { Icon, type IconName } from './Icon.tsx';

// Status always carries an icon and a label, never colour alone.
// Semantic colours: ok = green, warn = amber, ng / error = red, neutral = grey, info = brand.
const STYLES: Record<string, { cls: string; icon: IconName; label?: string }> = {
  OK: { cls: 'ok', icon: 'check' },
  NG: { cls: 'ng', icon: 'x' },
  NOT_EVALUABLE: { cls: 'ne', icon: 'minus', label: 'NOT EVALUABLE' },
  valid: { cls: 'ok', icon: 'check', label: 'Valid' },
  valid_with_warnings: { cls: 'warn', icon: 'alert', label: 'Valid with warnings' },
  invalid: { cls: 'ng', icon: 'xCircle', label: 'Invalid' },
  imported: { cls: 'ok', icon: 'checkCircle', label: 'Imported' },
  unsupported: { cls: 'ng', icon: 'xCircle', label: 'Unsupported' },
  failed: { cls: 'ng', icon: 'xCircle', label: 'Processing failed' },
  pending: { cls: '', icon: 'clock', label: 'Pending' },
  warning: { cls: 'warn', icon: 'alert', label: 'Warning' },
  error: { cls: 'ng', icon: 'xCircle', label: 'Error' },
  duplicate: { cls: 'warn', icon: 'alert', label: 'Duplicate' },
  total: { cls: '', icon: 'minus', label: 'Total row' },
  metadata: { cls: '', icon: 'info', label: 'Metadata' },
  Detected: { cls: 'ng', icon: 'alert' },
  Proposed: { cls: 'info', icon: 'clock' },
  Approved: { cls: 'ok', icon: 'check' },
  NotReviewed: { cls: 'warn', icon: 'clock', label: 'Not reviewed' },
  Confirmed: { cls: 'ok', icon: 'check' },
  Rejected: { cls: '', icon: 'x' },
  NeedsMoreEvidence: { cls: 'warn', icon: 'info', label: 'Needs more evidence' },
  High: { cls: 'info', icon: 'chevronRight' },
  Medium: { cls: 'info', icon: 'minus' },
  Low: { cls: '', icon: 'chevronDown' },
};

export function StatusBadge({ status, title }: { status: string; title?: string }) {
  const s = STYLES[status] ?? { cls: '', icon: 'info' as IconName };
  return (
    <span className={`badge ${s.cls}`} title={title}>
      <Icon name={s.icon} size={12} />
      {t(s.label ?? status)}
    </span>
  );
}
