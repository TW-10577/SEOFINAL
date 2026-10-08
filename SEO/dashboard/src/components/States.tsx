import type { ReactNode } from 'react';
import { t } from '../i18n.ts';
import { Icon, type IconName } from './Icon.tsx';

export function EmptyState({ title, children, icon = 'file' }: { title: string; children?: ReactNode; icon?: IconName }) {
  return (
    <div className="state">
      <span className="state-icon"><Icon name={icon} size={18} /></span>
      <div className="title">{t(title)}</div>
      {children && <div>{typeof children === 'string' ? t(children) : children}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="notice error row" role="alert" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
      <Icon name="xCircle" size={16} className="caveat" />
      <div style={{ flex: 1 }}>
        <strong>{t('Something went wrong.')}</strong> {error instanceof Error ? error.message : String(error)}
      </div>
      {onRetry && <button className="btn small" onClick={onRetry}>{t('Retry')}</button>}
    </div>
  );
}

/** Skeleton lines while data loads (the label is for screen readers). */
export function LoadingState({ label, lines = 4 }: { label?: string; lines?: number }) {
  return (
    <div className="skeleton" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">{label ?? t('Loading…')}</span>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton-line" style={{ width: `${[92, 76, 84, 60, 70][i % 5]}%` }} />
      ))}
    </div>
  );
}
