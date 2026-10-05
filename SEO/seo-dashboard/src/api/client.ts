import type {
  Anomaly,
  AnomalyStatus,
  Countermeasure,
  CountermeasureStatus,
  DashboardData,
  OntologySummary,
  Dataset,
  UploadItem,
  WeeklyReport,
} from '../types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, init)
  } catch {
    throw new Error('Cannot reach the SEO API. Start it with `npm run dev` in SEO/seo-api.')
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    if (res.status === 502 || res.status === 504 || body === null) {
      throw new Error('Cannot reach the SEO API. Start it with `npm run dev` in SEO/seo-api.')
    }
    throw new Error(body.error ?? `Request failed (${res.status})`)
  }
  return body as T
}

const patch = (path: string, status: string) =>
  request(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })

export const api = {
  uploadFile: (file: File) =>
    request<{ items: UploadItem[] }>('/datasets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
      body: file,
    }),
  datasets: () => request<Dataset[]>('/datasets'),
  deletionImpact: (id: string) =>
    request<{ fileName: string; anomalies: number; countermeasures: number; decidedCountermeasures: number }>(`/datasets/${id}/deletion-impact`),
  deleteDataset: (id: string) => request<{ datasetId: string }>(`/datasets/${id}`, { method: 'DELETE' }),
  dashboard: () => request<DashboardData>('/dashboard'),
  anomalies: () => request<Anomaly[]>('/anomalies'),
  setAnomalyStatus: (id: string, status: AnomalyStatus) => patch(`/anomalies/${id}`, status) as Promise<Anomaly>,
  countermeasures: () => request<Countermeasure[]>('/countermeasures'),
  setCountermeasureStatus: (id: string, status: CountermeasureStatus) =>
    patch(`/countermeasures/${id}`, status) as Promise<Countermeasure>,
  weeklyReport: () => request<WeeklyReport>('/reports/weekly'),
  ontology: () => request<OntologySummary>('/ontology'),
}
