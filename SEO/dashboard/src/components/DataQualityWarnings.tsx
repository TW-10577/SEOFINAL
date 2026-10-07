import type { Issue } from '@seo/shared';
import { useState } from 'react';
import { StatusBadge } from './StatusBadge.tsx';
import { t } from '../i18n.ts';

/** Groups issues by code; errors first. Row-level issues show their source row. */
export function DataQualityWarnings({ issues, title }: { issues: Issue[]; title?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!issues.length) return <div className="notice info">{t('No data-quality warnings.')}</div>;
  const groups = new Map<string, Issue[]>();
  for (const i of [...issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))) {
    const k = `${i.severity}:${i.code}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  return (
    <div>
      <h3>{t(title ?? 'Data-quality warnings')}</h3>
      <ul className="warnings-list">
        {[...groups].map(([k, list]) => (
          <li key={k} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div className="row">
              <StatusBadge status={list[0]!.severity === 'error' ? 'invalid' : 'valid_with_warnings'} title={t(list[0]!.severity)} />
              <span className="mono">{list[0]!.code}</span>
              <span>{list[0]!.message}</span>
              {list.length > 1 && (
                <button className="btn link small" onClick={() => setOpen(open === k ? null : k)}>
                  {open === k ? t('hide') : t('+{n} more', { n: list.length - 1 })}
                </button>
              )}
            </div>
            {open === k && (
              <ul className="small secondary" style={{ margin: '4px 0 0 0' }}>
                {list.slice(1).map((i, n) => (
                  <li key={n}>{i.row ? t('Row {n}: ', { n: i.row }) : ''}{i.message}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
