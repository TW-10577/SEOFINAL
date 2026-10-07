import type { ReactNode } from 'react';
import { t } from '../i18n.ts';

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state">
      <div className="title">{t(title)}</div>
      {children && <div>{typeof children === 'string' ? t(children) : children}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="notice error" role="alert">
      <strong>{t('Something went wrong.')}</strong> {error instanceof Error ? error.message : String(error)}
      {onRetry && (
        <>
          {' '}
          <button className="btn small" onClick={onRetry}>{t('Retry')}</button>
        </>
      )}
    </div>
  );
}

export function LoadingState({ label }: { label?: string }) {
  return <div className="state" aria-busy="true">{label ?? t('Loading…')}</div>;
}
