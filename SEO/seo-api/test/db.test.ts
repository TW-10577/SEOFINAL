import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { SeoDatabase } from '../src/db.ts'
import { loadOntology } from '../src/ontology.ts'
import { SeoService } from '../src/service.ts'

const SEO_DIR = fileURLToPath(new URL('../../', import.meta.url))
const ontology = loadOntology(SEO_DIR)
const gscDaily = readFileSync(join(SEO_DIR, 'https___www.dospara.co.jp_-Performance-on-Search-2026-09-18/平均読み込み時間のチャート.csv'), 'utf8')
const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'seo-db-')), 'seo.db')

function ga4Drop() {
  const day = (i: number) => new Date(Date.parse('2026-08-01T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10)
  const rows = Array.from({ length: 14 }, (_, i) => `${day(i)},${i < 7 ? 1000 : 950},${i < 7 ? 20 : 19}`)
  return ['セグメント,通販（全体）,通販（全体）', '日付,セッション,e コマース購入数', ...rows].join('\n')
}

describe('SQLite database', () => {
  it('keeps datasets, anomalies, causes and decisions after a restart', () => {
    const file = tmpFile()
    const first = new SeoDatabase(file)
    const service = new SeoService(first, ontology)
    const { countermeasures } = service.upload('ga4.csv', ga4Drop())
    service.upload('gsc.csv', gscDaily)
    service.setCountermeasureStatus(countermeasures[0].countermeasureId, 'Approved')
    first.close()

    const reopened = new SeoService(new SeoDatabase(file), ontology)
    assert.deepEqual(reopened.datasets().map((d) => d.fileName), ['ga4.csv', 'gsc.csv'])
    const [a] = reopened.anomalies()
    assert.equal(a.cause?.reviewStatus, 'NotReviewed')
    assert.equal(a.countermeasures[0].status, 'Approved')
    assert.equal(reopened.upload('gsc.csv', gscDaily).duplicate, true)
  })

  it('stores raw daily values and snapshot rows in their own tables', () => {
    const file = tmpFile()
    const { dataset } = new SeoService(new SeoDatabase(file), ontology).upload('gsc.csv', gscDaily)
    const raw = new Database(file, { readonly: true })
    const row = raw.prepare("SELECT value FROM daily_metrics WHERE dataset_id = ? AND date = '2026-06-16' AND metric_key = 'clicks'").get(dataset.datasetId) as { value: number }
    assert.equal(row.value, 37122)
    raw.close()
  })

  it('keeps the original uploaded file once and links its datasets to it', () => {
    const file = tmpFile()
    const service = new SeoService(new SeoDatabase(file), ontology)
    const bytes = Buffer.from(ga4Drop())
    const [first] = service.uploadFile('ga4.csv', bytes)
    service.uploadFile('ga4.csv', bytes)
    const raw = new Database(file, { readonly: true })
    const files = raw.prepare('SELECT upload_id, file_name, size_bytes, content FROM uploaded_files').all() as Record<string, any>[]
    assert.equal(files.length, 1, 'the same bytes are stored once')
    assert.equal(files[0].file_name, 'ga4.csv')
    assert.ok(Buffer.from(files[0].content).equals(bytes))
    const link = raw.prepare('SELECT upload_id FROM datasets WHERE dataset_id = ?').get('dataset' in first ? first.dataset.datasetId : '') as { upload_id: string }
    assert.equal(link.upload_id, files[0].upload_id)
    raw.close()
  })

  it('follows the lifecycles declared in the ontology and logs every change', () => {
    const service = new SeoService(new SeoDatabase(':memory:'), ontology)
    const { anomalies, causes, countermeasures } = service.upload('ga4.csv', ga4Drop())
    const a = anomalies[0].anomalyId
    assert.throws(() => service.setAnomalyStatus(a, 'Resolved'), /Detected can move to: Triaged/)
    service.setAnomalyStatus(a, 'Triaged')
    service.setAnomalyStatus(a, 'CountermeasureAssigned')
    service.setAnomalyStatus(a, 'Resolved')
    assert.throws(() => service.setAnomalyStatus(a, 'Triaged'), /final status/)
    assert.deepEqual(
      service.statusHistory(a).map((h) => [h.fromStatus, h.toStatus]),
      [[null, 'Detected'], ['Detected', 'Triaged'], ['Triaged', 'CountermeasureAssigned'], ['CountermeasureAssigned', 'Resolved']],
    )

    service.setCauseReview(causes[0].causeId, 'NeedsMoreEvidence')
    assert.throws(() => service.setCauseReview(causes[0].causeId, 'Confirmed'), /NeedsMoreEvidence can move to: nothing/)

    const cm = countermeasures[0].countermeasureId
    for (const s of ['Approved', 'InProgress', 'Completed', 'VerifiedEffective']) service.setCountermeasureStatus(cm, s)
    assert.throws(() => service.setCountermeasureStatus(cm, 'Dismissed'), /final status/)
  })

  it('soft-deletes: hides the dataset and its records, keeps rows and history, and can restore', () => {
    const file = tmpFile()
    const service = new SeoService(new SeoDatabase(file), ontology)
    const keep = service.upload('gsc.csv', gscDaily).dataset
    const { dataset, anomalies, countermeasures } = service.upload('ga4.csv', ga4Drop())
    service.setCountermeasureStatus(countermeasures[0].countermeasureId, 'Approved')

    assert.deepEqual(service.deleteDataset(dataset.datasetId), {
      datasetId: dataset.datasetId,
      fileName: 'ga4.csv',
      anomalies: 1,
      countermeasures: 1,
      decidedCountermeasures: 1,
    })
    assert.deepEqual(service.datasets().map((d) => d.datasetId), [keep.datasetId])
    assert.equal(service.anomalies().length, 0)
    assert.equal(service.countermeasures().length, 0)
    assert.throws(() => service.setAnomalyStatus(anomalies[0].anomalyId, 'Triaged'), /not found/)
    assert.deepEqual(service.deletedDatasets().map((d) => d.datasetId), [dataset.datasetId])

    const raw = new Database(file, { readonly: true })
    const n = (sql: string) => (raw.prepare(sql).get(dataset.datasetId) as { n: number }).n
    assert.equal(n('SELECT COUNT(*) n FROM daily_metrics WHERE dataset_id = ?'), 28, 'raw rows kept (14 days × sessions, purchases)')
    assert.equal(n('SELECT COUNT(*) n FROM anomalies WHERE dataset_id = ?'), 1, 'anomaly kept')
    raw.close()
    assert.deepEqual(service.statusHistory(dataset.datasetId).map((h) => h.toStatus), ['Deleted'])
    assert.ok(service.statusHistory(countermeasures[0].countermeasureId).length >= 2, 'decision history kept')

    const again = service.upload('ga4.csv', ga4Drop())
    assert.equal(again.duplicate, false, 'the same file can be uploaded again')
    assert.throws(() => service.restoreDataset(dataset.datasetId), /already active as/)
    service.deleteDataset(again.dataset.datasetId)
    service.restoreDataset(dataset.datasetId)
    assert.equal(service.anomalies()[0].countermeasures[0].status, 'Approved', 'restored with its decisions')
    assert.throws(() => service.deleteDataset('DS-9999'), /not found/)
  })

  it('migrates a database created before soft delete and the design-doc model', () => {
    const file = tmpFile()
    const old = new Database(file)
    old.exec(`
      CREATE TABLE datasets (dataset_id TEXT PRIMARY KEY, file_name TEXT NOT NULL, source TEXT NOT NULL, uploaded_at TEXT NOT NULL,
        period_start TEXT, period_end TEXT, row_count INTEGER NOT NULL, content_hash TEXT NOT NULL UNIQUE, segments_json TEXT,
        warnings_json TEXT NOT NULL, comparisons_json TEXT NOT NULL, weekly_trend_json TEXT NOT NULL);
      CREATE TABLE anomalies (anomaly_id TEXT PRIMARY KEY, possible_cause TEXT NOT NULL);
      CREATE TABLE countermeasures (countermeasure_id TEXT PRIMARY KEY, related_anomaly_id TEXT NOT NULL);
      INSERT INTO datasets VALUES ('DS-0001','old.csv','gsc-daily','2026-10-01T00:00:00Z',NULL,NULL,0,'abc',NULL,'[]','[]','[]');`)
    old.close()
    const service = new SeoService(new SeoDatabase(file), ontology)
    assert.deepEqual(service.datasets().map((d) => d.datasetId), ['DS-0001'])
    assert.equal(service.anomalies().length, 0)

    const withRows = tmpFile()
    const legacy = new Database(withRows)
    legacy.exec(`CREATE TABLE anomalies (anomaly_id TEXT PRIMARY KEY, possible_cause TEXT NOT NULL);
      CREATE TABLE countermeasures (countermeasure_id TEXT PRIMARY KEY, related_anomaly_id TEXT NOT NULL);
      INSERT INTO anomalies VALUES ('ANO-0001', 'x');`)
    legacy.close()
    assert.throws(() => new SeoDatabase(withRows), /old format/)
  })

  it('does not keep a half-imported file when saving fails', () => {
    const db = new SeoDatabase(':memory:')
    const service = new SeoService(db, ontology)
    db.insertCause = () => {
      throw new Error('disk full')
    }
    assert.throws(() => service.upload('ga4.csv', ga4Drop()), /disk full/)
    assert.equal(service.datasets().length, 0)
  })
})
