import { useState } from 'react';
import { api } from '../api.ts';
import { t } from '../i18n.ts';
import type { ChartHandle } from './ChartCard.tsx';
import { chartToPng, formattedReport, saveBlob, type ReportTable } from './chartExport.ts';
import { Icon } from './Icon.tsx';
import { useToast } from './Toast.tsx';

/**
 * Download button for one Search Console table of an upload: saves a formatted Excel report — the card's chart
 * image plus a coloured table of every valid row of the file (only the rows matching the active filter, if one is set).
 */
export function DownloadReport({ uploadId, table, fileName, filter = '', chart }: {
  uploadId: number;
  table: string;
  /** Name of the uploaded file, for the report's file name. */
  fileName: string;
  filter?: string;
  chart: ChartHandle;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const search = filter.trim();
  const base = `${fileName.replace(/\.[^.]+$/, '')}_${table}${search ? '_filtered' : ''}`;

  async function download() {
    setBusy(true);
    try {
      const svg = chart.svg();
      if (!svg) throw new Error(t('The chart is not drawn yet.'));
      const img = await chartToPng(svg, chart.title, chart.subtitle);
      const params = new URLSearchParams({ table, ...(search ? { search } : {}) });
      const data = await api<ReportTable>(`/uploads/${uploadId}/export?${params}`);
      const note = [
        t('Source: Google Search Console · {file} ({table})', { file: data.fileName, table }),
        search ? t('Filtered: “{filter}”', { filter: search }) : t('All rows'),
        t('{n} rows', { n: data.rows.length.toLocaleString() }),
        new Date().toLocaleString(),
      ].join(' · ');
      const blob = await formattedReport(img, chart.title, chart.subtitle, data, note);
      saveBlob(blob, `${base}_report.xlsx`);
      toast('success', t('{n} rows downloaded', { n: data.rows.length.toLocaleString() }), `${base}_report.xlsx`);
    } catch (e) {
      toast('error', t('Download failed'), (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="btn small" onClick={download} disabled={busy} title={t('Formatted report (Excel .xlsx)')}>
      <Icon name={busy ? 'loader' : 'download'} size={14} className={busy ? 'spin' : undefined} />
      {t('Download')}
    </button>
  );
}
