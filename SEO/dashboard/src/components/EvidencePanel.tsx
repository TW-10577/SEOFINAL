import type { Evidence, EvidenceGroup, EvidenceItem, EvidenceTable as EvidenceTableT, SourceRef } from '@seo/shared';
import { useState } from 'react';
import { metricLabel, metricValue, num } from '../format.ts';
import { DataTable } from './DataTable.tsx';
import { t } from '../i18n.ts';
import { dataLabel } from '../i18n.ts';

const GROUPS: { key: EvidenceGroup | 'other'; title: string }[] = [
  { key: 'ga4', title: 'GA4 evidence' },
  { key: 'gsc', title: 'Search Console evidence' },
  { key: 'detail', title: 'Page / query evidence' },
  { key: 'daily', title: 'Daily trend evidence' },
  { key: 'other', title: '' },
];

function Items({ items }: { items: EvidenceItem[] }) {
  if (!items.length) return null;
  return (
    <dl className="kv">
      {items.map((i) => (
        <div key={i.label} style={{ display: 'contents' }}>
          <dt>{i.label}</dt>
          <dd>
            {dataLabel(i.value)}
            {i.caveat && <div className="caveat">⚠ {i.caveat}</div>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Tables({ tables }: { tables: EvidenceTableT[] }) {
  return (
    <>
      {tables.map((tb) => (
        <div key={tb.title} style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{tb.title}</div>
          {tb.note && <div className="small secondary" style={{ margin: '2px 0 6px' }}>{tb.note}</div>}
          <DataTable
            rows={tb.rows.map((r, i) => ({ r, i }))}
            rowKey={(x) => x.i}
            columns={tb.columns.map((c, k) => ({
              key: String(k),
              label: dataLabel(c),
              num: tb.rows.some((r) => typeof r[k] === 'number'),
              render: (x: { r: (string | number | null)[] }) => {
                const v = x.r[k];
                return typeof v === 'number' ? num(v, Number.isInteger(v) ? 0 : 2) : <span style={{ wordBreak: 'break-all' }}>{v == null ? '—' : dataLabel(String(v))}</span>;
              },
            }))}
          />
        </div>
      ))}
    </>
  );
}

/** Evidence in sections: GA4, Search Console, page / query detail, daily trend. */
export function EvidenceTables({ evidence, grouped = false }: { evidence: Evidence; grouped?: boolean }) {
  if (!grouped) return (<><Items items={evidence.items} /><Tables tables={evidence.tables} /></>);
  return (
    <>
      {GROUPS.map((g) => {
        const items = evidence.items.filter((i) => (i.group ?? 'other') === g.key);
        const tables = evidence.tables.filter((tb) => (tb.group ?? 'other') === g.key);
        if (!items.length && !tables.length) return null;
        return (
          <div key={g.key} style={{ marginTop: 14 }}>
            {g.title && <h3>{t(g.title)}</h3>}
            <Items items={items} />
            <Tables tables={tables} />
          </div>
        );
      })}
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
        <EvidenceTables evidence={evidence} grouped />
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
                { key: 's', label: t('Subject'), render: (s) => <span style={{ wordBreak: 'break-all' }}>{dataLabel(s.segment)}</span> },
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
