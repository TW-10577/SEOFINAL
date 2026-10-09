import type { Issue } from '@seo/shared';
import { useState } from 'react';
import { Icon } from './Icon.tsx';
import { t } from '../i18n.ts';

/** Groups issues by code; errors first. Row-level issues show their source row. */
export function DataQualityWarnings({ issues, title }: { issues: Issue[]; title?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  // Collapsed by default: only the heading with an arrow; a click shows the details.
  const [expanded, setExpanded] = useState(false);
  if (!issues.length)
    return (
      <div className="notice info row">
        <Icon name="checkCircle" size={16} />
        {t('No data-quality warnings.')}
      </div>
    );
  const groups = new Map<string, Issue[]>();
  for (const i of [...issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))) {
    const k = `${i.severity}:${i.code}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  return (
    <div>
      <button className="warnings-toggle" onClick={() => setExpanded((x) => !x)} aria-expanded={expanded}>
        <Icon name="chevronRight" size={14} className={expanded ? 'open' : undefined} />
        <span>{t(title ?? 'Warnings')}</span>
        <span className="warnings-count">{issues.length}</span>
      </button>
      {expanded && (
      <ul className="issue-list">
        {[...groups].map(([k, list]) => {
          const error = list[0]!.severity === 'error';
          return (
            <li key={k} className={error ? 'error' : 'warn'}>
              <Icon name={error ? 'xCircle' : 'alert'} size={16} className="issue-icon" />
              <div className="issue-text">
                <div className="issue-head">
                  {REASON[list[0]!.code] ? (
                    <>
                      <span className="issue-reason">{t(REASON[list[0]!.code]!)}</span>
                      {list[0]!.row ? <span className="chip issue-chip">{t('Row {n}: ', { n: list[0]!.row }).replace(/[:：]\s*$/, '')}</span> : null}
                    </>
                  ) : (
                    <Affected issue={list[0]!} />
                  )}
                  {list.length > 1 && (
                    <button className="btn link small" onClick={() => setOpen(open === k ? null : k)}>
                      {open === k ? t('hide') : t('+{n} more', { n: list.length - 1 })}
                    </button>
                  )}
                </div>
                {open === k && (
                  <div className="issue-more">
                    {list.slice(1).map((i, n) => <Affected key={n} issue={i} />)}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      )}
    </div>
  );
}

/** One short line per warning code: why the warning was raised. */
const REASON: Record<string, string> = {
  'synthetic-data': 'Export notes mark this data as not real, so results are labelled TEST DATA',
  'synthetic-data-used': 'Measured weeks include data marked as not real — results are TEST DATA',
  'synthetic-data-excluded': 'Data marked as not real was left out; those days count as missing',
  'missing-dates': 'Some days have no rows',
  'totals-mismatch': 'Daily rows do not add up to the export total',
  'period-mismatch': 'Rows cover a different period than the export header',
  'row-cap': 'Exactly 1,000 rows — the export is likely truncated',
  'unknown-column': 'Some columns were not imported',
  'missing-column': 'An expected column is missing',
  'ga4-no-segment': 'A column has no segment and was ignored',
  'ga4-first-column': 'Unexpected first header in the GA4 export',
  'no-period': 'Rows have no date, so the period is unknown',
  'no-wow': 'Period total only — no week-on-week comparison',
  'duplicate': 'Duplicate row',
  'invalid-record': 'Row could not be read (invalid date or value)',
  'ctr-mismatch': 'CTR does not match clicks ÷ impressions',
  'overlapping-uploads': 'Some dates are in more than one upload; the latest is used',
  'entry-skipped': 'Part of the file was skipped',
  'no-ga4-data': 'No valid GA4 daily data — nothing can be measured',
  'empty': 'No data rows found',
  'unknown-source': 'Contents match neither GA4 nor Search Console',
  'source-mismatch': 'Contents do not match the selected source',
  'mixed-sources': 'File mixes GA4 and Search Console data',
  'unsupported-layout': 'Table layout is not supported',
  'unknown-structure': 'Unrecognised Search Console export',
  'ga4-header': 'GA4 header rows not found',
};

const DATES = /\d{4}-\d{2}-\d{2}(?:\s*[–-]\s*\d{4}-\d{2}-\d{2})?/g;

/** The data a warning affects: its row, column and dates. Falls back to the message when it names none. */
function Affected({ issue }: { issue: Issue }) {
  const parts = [
    ...(issue.row ? [t('Row {n}: ', { n: issue.row }).replace(/[:：]\s*$/, '')] : []),
    ...(issue.column ? [issue.column] : []),
    ...[...new Set(issue.message.match(DATES) ?? [])].map((d) => d.replace(/\s*[–-]\s*(?=\d{4})/, ' – ')),
  ];
  if (!parts.length) return <span className="issue-msg">{issue.message}</span>;
  return <>{parts.map((x) => <span key={x} className="chip issue-chip">{x}</span>)}</>;
}
