import { useState, type DragEvent } from 'react'
import { api } from '../api/client'
import { formatPeriod, SOURCE_LABELS } from '../format'
import type { UploadResult } from '../types'
import { useApi } from '../useApi'

interface FileOutcome {
  fileName: string
  result?: UploadResult
  error?: string
}

export default function DataUpload() {
  const datasets = useApi(api.datasets)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [outcomes, setOutcomes] = useState<FileOutcome[]>([])
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function remove(id: string) {
    setDeleteError(null)
    try {
      const impact = await api.deletionImpact(id)
      const lines = [`Delete ${id} (${impact.fileName}) and its uploaded rows?`]
      if (impact.anomalies) {
        lines.push(`This also deletes ${impact.anomalies} anomal${impact.anomalies === 1 ? 'y' : 'ies'} and ${impact.countermeasures} countermeasure(s).`)
      }
      if (impact.decidedCountermeasures) {
        lines.push(`${impact.decidedCountermeasures} of those countermeasures already have an SEO team decision, which will be lost.`)
      }
      if (!window.confirm(lines.join('\n\n'))) return
      setDeleting(id)
      await api.deleteDataset(id)
      datasets.reload()
    } catch (e) {
      setDeleteError((e as Error).message)
    } finally {
      setDeleting(null)
    }
  }

  async function uploadAll(files: File[]) {
    if (!files.length) return
    setBusy(true)
    const results: FileOutcome[] = []
    for (const file of files) {
      try {
        const { items } = await api.uploadFile(file)
        for (const item of items) {
          results.push('error' in item ? { fileName: item.name, error: item.error } : { fileName: item.name, result: item })
        }
      } catch (e) {
        results.push({ fileName: file.name, error: (e as Error).message })
      }
      setOutcomes([...results])
    }
    setBusy(false)
    datasets.reload()
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setOver(false)
    void uploadAll([...e.dataTransfer.files])
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Step 1 · Receive data</div>
          <h1>Upload data</h1>
          <p className="lead">GSC and GA4 exports as CSV, TXT/TSV or Excel. Each file is validated, standardised and compared week over week.</p>
        </div>
      </div>

      <div className="stack">
        <div className="panel">
          <label
            className={`dropzone ${over ? 'over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
          >
            <input
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xls"
              multiple
              disabled={busy}
              onChange={(e) => {
                void uploadAll([...(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
            <strong>{busy ? 'Uploading…' : 'Drop files here or click to choose'}</strong>
            <span className="small muted">CSV, TXT / TSV (comma or tab separated), Excel (.xlsx, .xls). UTF-8, Shift_JIS and UTF-16 are all read.</span>
            <span className="small muted">
              Week-over-week analysis: GSC 平均読み込み時間のチャート.csv, GA4 自由形式 export with 日付 rows (at least 14 days).
              <br />
              Stored for reference: GSC ページ / クエリ / デバイス / 国 exports. In an Excel file every sheet is read as its own dataset.
            </span>
          </label>
        </div>

        {outcomes.length ? (
          <div className="panel">
            <div className="panel-head">
              <h2>Upload results</h2>
            </div>
            <div className="stack">
              {outcomes.map((o, i) =>
                o.error ? (
                  <div key={i} className="notice error">
                    <strong>{o.fileName}</strong>: {o.error}
                  </div>
                ) : o.result ? (
                  <div key={i} className={`notice ${o.result.dataset.warnings.length ? 'info' : 'ok'}`}>
                    <strong>{o.fileName}</strong>:{' '}
                    {o.result.duplicate
                      ? 'already uploaded, skipped.'
                      : `${SOURCE_LABELS[o.result.dataset.source]}, ${o.result.dataset.rowCount} rows, ${formatPeriod(o.result.dataset.period)}. ${o.result.anomalies.length} anomal${o.result.anomalies.length === 1 ? 'y' : 'ies'} detected.`}
                    {!o.result.duplicate && o.result.dataset.warnings.length ? (
                      <ul>
                        {o.result.dataset.warnings.map((w, j) => (
                          <li key={j}>{w}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null,
              )}
            </div>
          </div>
        ) : null}

        <div className="panel">
          <div className="panel-head">
            <h2>Uploaded datasets</h2>
          </div>
          {datasets.error || deleteError ? <div className="notice error">{datasets.error ?? deleteError}</div> : null}
          {datasets.data?.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>File</th>
                    <th>Type</th>
                    <th>Period</th>
                    <th className="num">Rows</th>
                    <th className="num">Warnings</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {datasets.data.map((d) => (
                    <tr key={d.datasetId}>
                      <td className="mono">{d.datasetId}</td>
                      <td>{d.fileName}</td>
                      <td>{SOURCE_LABELS[d.source]}</td>
                      <td className="muted">{formatPeriod(d.period)}</td>
                      <td className="num">{d.rowCount}</td>
                      <td className="num">{d.warnings.length}</td>
                      <td className="num">
                        <button className="btn small danger" disabled={deleting !== null} onClick={() => void remove(d.datasetId)}>
                          {deleting === d.datasetId ? 'Deleting…' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : datasets.loading ? (
            <p className="muted">Loading…</p>
          ) : (
            <p className="muted">Nothing uploaded yet.</p>
          )}
        </div>
      </div>
    </>
  )
}
