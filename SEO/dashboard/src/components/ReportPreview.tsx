import type { Report, ReportBlock } from '@seo/shared';
import { useState } from 'react';
import { dateTime } from '../format.ts';
import { t } from '../i18n.ts';
import { Icon } from './Icon.tsx';
import { StatusBadge } from './StatusBadge.tsx';

/** Result cells shown as status chips. */
const RESULT_CELL: Record<string, string> = { OK: 'OK', NG: 'NG', 'NOT EVALUABLE': 'NOT_EVALUABLE', 評価不可: 'NOT_EVALUABLE' };

const NUMERIC = /^[-+−]?[\d,.]+\s?(%|pt)?$|^—$/;

/** The report as a readable document (sections, key–value lists, tables, status chips); the TXT file is one click away. */
export function ReportPreview({ report }: { report: Report }) {
  const [view, setView] = useState<'formatted' | 'text'>('formatted');
  const { doc } = report;
  return (
    <div className="report-doc">
      <div className="report-top">
        <div>
          <h2 className="report-title">{doc.title}</h2>
          <div className="small muted">
            {t('{file} · generated {time} from measurement run #{run}', { file: report.fileName, time: dateTime(report.generatedAt), run: report.runId })}
          </div>
        </div>
        <div className="segmented" role="tablist" aria-label={t('Report view')}>
          <button role="tab" aria-selected={view === 'formatted'} className={view === 'formatted' ? 'on' : ''} onClick={() => setView('formatted')}>
            <Icon name="report" size={14} />{t('Formatted')}
          </button>
          <button role="tab" aria-selected={view === 'text'} className={view === 'text' ? 'on' : ''} onClick={() => setView('text')}>
            <Icon name="file" size={14} />{t('Plain text (TXT)')}
          </button>
        </div>
      </div>

      {view === 'text' ? (
        <pre className="report">{report.content}</pre>
      ) : (
        <>
          {doc.sections.map((s) => (
            <section key={s.n} id={`report-${s.n}`} className="report-section">
              <h3 className="report-h"><span className="n">{s.n}</span>{s.title}</h3>
              <Blocks blocks={s.blocks} />
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function Blocks({ blocks, groupStatus }: { blocks: ReportBlock[]; groupStatus?: string }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'kv':
            return (
              <dl key={i} className="kv report-kv">
                {b.rows.map(([k, v], j) => (
                  <div key={j} style={{ display: 'contents' }}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            );
          case 'table':
            return (
              <div key={i} className="report-table">
                {b.title && <div className="report-table-title">{b.title}</div>}
                {b.note && <div className="small muted">{b.note}</div>}
                <div className="table-wrap" style={{ maxHeight: 'none' }}>
                  <table className="data">
                    <thead>
                      <tr>{b.columns.map((c, j) => <th key={j} className={isNumCol(b.rows, j) ? 'num' : undefined}>{c}</th>)}</tr>
                    </thead>
                    <tbody>
                      {b.rows.map((r, j) => (
                        <tr key={j}>{r.map((c, k) => <td key={k} className={isNumCol(b.rows, k) ? 'num' : undefined}><ResultCell text={c} /></td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          case 'p':
            return b.tone === 'warn' ? (
              <div key={i} className="notice warn">{b.text}</div>
            ) : (
              <p key={i} className={b.tone === 'muted' ? 'report-p muted' : 'report-p'}>{b.text}</p>
            );
          case 'list':
            return <ul key={i} className="report-list">{b.items.map((x, j) => <li key={j}>{x}</li>)}</ul>;
          case 'status':
            // The group header already shows this status.
            if (groupStatus === b.status) return b.meta ? <div key={i} className="small muted">{b.meta}</div> : null;
            return (
              <div key={i} className="row">
                <StatusBadge status={b.status} />
                <strong>{b.title}</strong>
                {b.meta && <span className="small muted">{b.meta}</span>}
              </div>
            );
          case 'group':
            return (
              <div key={i} className="report-group">
                <div className="report-group-head">
                  {b.status && <StatusBadge status={b.status} />}
                  <span>{b.title}</span>
                </div>
                <Blocks blocks={b.blocks} groupStatus={b.status} />
              </div>
            );
        }
      })}
    </>
  );
}

/** "NG — Significant Positive Change" → NG chip + the direction label; plain results → chip. */
function ResultCell({ text }: { text: string }) {
  const [head, ...rest] = text.split(' — ');
  const status = RESULT_CELL[head ?? ''];
  if (!status) return <>{text}</>;
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
      <StatusBadge status={status} />
      {rest.length > 0 && <span className={`badge ${/Positive|プラス/.test(rest.join('')) ? 'ok' : 'ng'}`}>{rest.join(' — ')}</span>}
    </span>
  );
}

/** A column is numeric when every non-empty cell looks like a number, percent or dash. */
function isNumCol(rows: string[][], col: number): boolean {
  const cells = rows.map((r) => r[col] ?? '').filter((c) => c !== '');
  return cells.length > 0 && cells.every((c) => NUMERIC.test(c.trim())) && cells.some((c) => c !== '—');
}
