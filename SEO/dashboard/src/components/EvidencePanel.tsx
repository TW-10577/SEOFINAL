import type { Evidence, SourceRef } from '@seo/shared';
import { useState } from 'react';
import { metricLabel, metricValue, num } from '../format.ts';
import { DataTable } from './DataTable.tsx';
import { t } from '../i18n.ts';

export function EvidenceTables({ evidence }: { evidence: Evidence }) {
  return (
    <>
      {evidence.items.length > 0 && (
        <dl className="kv">
          {evidence.items.map((i) => (
            <div key={i.label} style={{ display: 'contents' }}>
              <dt>{i.label}</dt>
              <dd>
                {i.value}
                {i.caveat && <div className="caveat">⚠ {i.caveat}</div>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {evidence.tables.map((t) => (
        <div key={t.title} style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{t.title}</div>
          {t.note && <div className="small secondary" style={{ margin: '2px 0 6px' }}>{t.note}</div>}
          <DataTable
            rows={t.rows.map((r, i) => ({ r, i }))}
            rowKey={(x) => x.i}
            columns={t.columns.map((c, k) => ({
              key: String(k),
              label: c,
              num: t.rows.some((r) => typeof r[k] === 'number'),
              render: (x: { r: (string | number | null)[] }) => {
                const v = x.r[k];
                return typeof v === 'number' ? num(v, Number.isInteger(v) ? 0 : 2) : <span style={{ wordBreak: 'break-all' }}>{v ?? '—'}</span>;
              },
            }))}
          />
        </div>
      ))}
    </>
  );
}

/** Exactly which data the measurement used: evidence plus every source record. */
export function EvidencePanel({ evidence, sources }: { evidence: Evidence; sources: SourceRef[] }) {
  const [showSources, setShowSources] = useState(false);
  const uploads = [...new Map(sources.map((s) => [s.uploadId, s.fileName]))];
  return (
    <section className="card">
      <div className="card-head"><h2>{t('Evidence')}</h2></div>
      <div className="card-body">
        <EvidenceTables evidence={evidence} />
        <div style={{ marginTop: 14 }}>
          <div className="row">
            <strong className="small">{t('Source records used: {n}', { n: sources.length })}</strong>
            <span className="small secondary">{uploads.map(([id, f]) => `upload #${id} ${f}`).join(' · ')}</span>
            <button className="btn link small" onClick={() => setShowSources(!showSources)}>{showSources ? t('Hide records') : t('Show records')}</button>
          </div>
          {showSources && (
            <DataTable
              rows={sources}
              rowKey={(s) => `${s.sourceRecordId}-${s.metricName}-${s.segment}`}
              columns={[
                { key: 'u', label: t('Upload'), render: (s) => `#${s.uploadId}` },
                { key: 'f', label: t('File'), render: (s) => s.fileName },
                { key: 'rec', label: t('Source record'), num: true, render: (s) => s.sourceRecordId },
                { key: 'row', label: t('File row'), num: true, render: (s) => s.rowNumber },
                { key: 'd', label: t('Date'), render: (s) => s.dataDate ?? t('period total') },
                { key: 's', label: t('Subject'), render: (s) => <span style={{ wordBreak: 'break-all' }}>{s.segment}</span> },
                { key: 'm', label: t('Metric'), render: (s) => metricLabel(s.metricName) },
                { key: 'v', label: t('Value'), num: true, render: (s) => metricValue(s.metricName, s.metricValue) },
              ]}
            />
          )}
        </div>
      </div>
    </section>
  );
}
