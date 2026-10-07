import { useState, type DragEvent } from 'react'
import { api } from '../api/client'
import ErrorNotice from '../components/ErrorNotice'
import { formatPeriod, sourceLabel } from '../format'
import { useI18n } from '../i18n'
import type { UploadResult } from '../types'
import { useApi } from '../useApi'

interface FileOutcome {
  fileName: string
  result?: UploadResult
  error?: string
}

export default function DataUpload() {
  const { t } = useI18n()
  const datasets = useApi(api.datasets)
  const deleted = useApi(api.deletedDatasets)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [outcomes, setOutcomes] = useState<FileOutcome[]>([])
  const [working, setWorking] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const reloadLists = () => {
    datasets.reload()
    deleted.reload()
  }

  async function remove(id: string) {
    setActionError(null)
    try {
      const impact = await api.deletionImpact(id)
      const lines = [t('up.confirmDelete', { id, file: impact.fileName })]
      if (impact.anomalies) lines.push(t('up.confirmImpact', { a: impact.anomalies, c: impact.countermeasures }))
      if (impact.decidedCountermeasures) lines.push(t('up.confirmDecided', { n: impact.decidedCountermeasures }))
      if (!window.confirm(lines.join('\n\n'))) return
      setWorking(id)
      await api.deleteDataset(id)
      reloadLists()
    } catch (e) {
      setActionError((e as Error).message)
    } finally {
      setWorking(null)
    }
  }

  async function restore(id: string) {
    setActionError(null)
    setWorking(id)
    try {
      await api.restoreDataset(id)
      reloadLists()
    } catch (e) {
      setActionError((e as Error).message)
    } finally {
      setWorking(null)
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
    reloadLists()
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
          <div className="eyebrow">{t('up.eyebrow')}</div>
          <h1>{t('up.title')}</h1>
          <p className="lead">{t('up.lead')}</p>
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
            <strong>{busy ? t('up.uploading') : t('up.drop')}</strong>
            <span className="small muted">{t('up.formats')}</span>
            <span className="small muted">
              {t('up.analysed')}
              <br />
              {t('up.reference')}
            </span>
          </label>
        </div>

        {outcomes.length ? (
          <div className="panel">
            <div className="panel-head">
              <h2>{t('up.results')}</h2>
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
                      ? t('up.duplicate')
                      : t('up.summary', {
                          type: sourceLabel(o.result.dataset.source, t),
                          rows: o.result.dataset.rowCount,
                          period: formatPeriod(o.result.dataset.period),
                          n: o.result.anomalies.length,
                        })}
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
            <h2>{t('up.datasets')}</h2>
          </div>
          <ErrorNotice message={datasets.error ?? actionError} />
          {datasets.data?.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>{t('up.file')}</th>
                    <th>{t('up.type')}</th>
                    <th>{t('up.period')}</th>
                    <th className="num">{t('up.rows')}</th>
                    <th className="num">{t('up.warnings')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {datasets.data.map((d) => (
                    <tr key={d.datasetId}>
                      <td className="mono">{d.datasetId}</td>
                      <td>{d.fileName}</td>
                      <td>{sourceLabel(d.source, t)}</td>
                      <td className="muted">{formatPeriod(d.period)}</td>
                      <td className="num">{d.rowCount}</td>
                      <td className="num">{d.warnings.length}</td>
                      <td className="num">
                        <button className="btn small danger" disabled={working !== null} onClick={() => void remove(d.datasetId)}>
                          {working === d.datasetId ? t('up.deleting') : t('up.delete')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : datasets.loading ? (
            <p className="muted">{t('loading')}</p>
          ) : (
            <p className="muted">{t('up.nothing')}</p>
          )}
        </div>

        {deleted.data?.length ? (
          <div className="panel">
            <div className="panel-head">
              <h2>{t('up.deleted')}</h2>
            </div>
            <p className="muted small" style={{ marginBottom: 8 }}>
              {t('up.deletedHint')}
            </p>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>{t('up.file')}</th>
                    <th>{t('up.type')}</th>
                    <th>{t('up.deletedAt')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {deleted.data.map((d) => (
                    <tr key={d.datasetId}>
                      <td className="mono">{d.datasetId}</td>
                      <td>{d.fileName}</td>
                      <td>{sourceLabel(d.source, t)}</td>
                      <td className="muted">{new Date(d.deletedAt).toLocaleString()}</td>
                      <td className="num">
                        <button className="btn small" disabled={working !== null} onClick={() => void restore(d.datasetId)}>
                          {t('up.restore')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}
