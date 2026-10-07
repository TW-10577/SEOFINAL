import type {
  Anomaly,
  AnomalyStatus,
  AnomalyView,
  CauseHypothesis,
  Countermeasure,
  CountermeasureStatus,
  CountermeasureView,
  DashboardData,
  Dataset,
  DatasetRows,
  DeletedDataset,
  MeasurementsData,
  OntologySummary,
  ReviewStatus,
  UploadItem,
  WeeklyReport,
} from '../types'

// Translated by <ErrorNotice>.
export const API_UNREACHABLE = 'API_UNREACHABLE'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, init)
  } catch {
    throw new Error(API_UNREACHABLE)
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    if (res.status === 502 || res.status === 504 || body === null) {
      throw new Error(API_UNREACHABLE)
    }
    throw new Error(body.error ?? `Request failed (${res.status})`)
  }
  return body as T
}

const patch = (path: string, body: Record<string, string>) =>
  request(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

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
  deletedDatasets: () => request<DeletedDataset[]>('/datasets/deleted'),
  restoreDataset: (id: string) => request<Dataset>(`/datasets/${id}/restore`, { method: 'POST' }),
  datasetRawRows: (id: string) => request<DatasetRows>(`/datasets/${id}/raw-rows`),
  dashboard: () => request<DashboardData>('/dashboard'),
  measurements: () => request<MeasurementsData>('/measurements'),
  anomalies: () => request<AnomalyView[]>('/anomalies'),
  setAnomalyStatus: (id: string, status: AnomalyStatus) => patch(`/anomalies/${id}`, { status }) as Promise<Anomaly>,
  setCauseReview: (id: string, reviewStatus: ReviewStatus) => patch(`/causes/${id}`, { reviewStatus }) as Promise<CauseHypothesis>,
  countermeasures: () => request<CountermeasureView[]>('/countermeasures'),
  setCountermeasureStatus: (id: string, status: CountermeasureStatus) =>
    patch(`/countermeasures/${id}`, { status }) as Promise<Countermeasure>,
  weeklyReport: () => request<WeeklyReport>('/reports/weekly'),
  ontology: () => request<OntologySummary>('/ontology'),
}
