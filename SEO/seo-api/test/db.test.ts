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

function ga4Drop() {
  const day = (i: number) => new Date(Date.parse('2026-08-01T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10)
  const rows = Array.from({ length: 14 }, (_, i) => `${day(i)},${i < 7 ? 1000 : 950},${i < 7 ? 20 : 19}`)
  return ['セグメント,通販（全体）,通販（全体）', '日付,セッション,e コマース購入数', ...rows].join('\n')
}

describe('SQLite database', () => {
  it('keeps datasets, anomalies and decisions after a restart', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'seo-db-')), 'seo.db')

    const first = new SeoDatabase(file)
    const service = new SeoService(first, ontology)
    const { anomalies, countermeasures } = service.upload('ga4.csv', ga4Drop())
    service.upload('gsc.csv', gscDaily)
    service.setCountermeasureStatus(countermeasures[0].countermeasureId, 'Approved')
    first.close()

    const reopened = new SeoService(new SeoDatabase(file), ontology)
    assert.deepEqual(
      reopened.datasets().map((d) => d.fileName),
      ['ga4.csv', 'gsc.csv'],
    )
    assert.deepEqual(reopened.anomalies(), anomalies)
    assert.equal(reopened.countermeasures()[0].status, 'Approved')
    assert.equal(reopened.upload('gsc.csv', gscDaily).duplicate, true)
  })

  it('stores raw daily values and snapshot rows in their own tables', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'seo-db-')), 'seo.db')
    const service = new SeoService(new SeoDatabase(file), ontology)
    const { dataset } = service.upload('gsc.csv', gscDaily)

    const raw = new Database(file, { readonly: true })
    const row = raw
      .prepare("SELECT value FROM daily_metrics WHERE dataset_id = ? AND date = '2026-06-16' AND metric_key = 'clicks'")
      .get(dataset.datasetId) as { value: number }
    assert.equal(row.value, 37122)
    const { n } = raw.prepare('SELECT COUNT(DISTINCT date) n FROM daily_metrics WHERE dataset_id = ?').get(dataset.datasetId) as { n: number }
    assert.equal(n, 92)
    raw.close()
  })

  it('records every status change in status_history', () => {
    const service = new SeoService(new SeoDatabase(':memory:'), ontology)
    const { anomalies } = service.upload('ga4.csv', ga4Drop())
    const id = anomalies[0].anomalyId
    service.setAnomalyStatus(id, 'UnderReview')
    service.setAnomalyStatus(id, 'Confirmed')
    assert.deepEqual(
      service.statusHistory(id).map((h) => [h.fromStatus, h.toStatus]),
      [
        [null, 'Detected'],
        ['Detected', 'UnderReview'],
        ['UnderReview', 'Confirmed'],
      ],
    )
  })

  it('deletes a dataset with its raw rows, anomalies, countermeasures and history', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'seo-db-')), 'seo.db')
    const service = new SeoService(new SeoDatabase(file), ontology)
    const keep = service.upload('gsc.csv', gscDaily).dataset
    const { dataset, countermeasures } = service.upload('ga4.csv', ga4Drop())
    service.setCountermeasureStatus(countermeasures[0].countermeasureId, 'Approved')

    assert.deepEqual(service.deletionImpact(dataset.datasetId), {
      datasetId: dataset.datasetId,
      fileName: 'ga4.csv',
      anomalies: 1,
      countermeasures: 1,
      decidedCountermeasures: 1,
    })
    assert.deepEqual(service.deleteDataset(dataset.datasetId), { datasetId: dataset.datasetId, anomalies: 1, countermeasures: 1 })

    assert.deepEqual(service.datasets().map((d) => d.datasetId), [keep.datasetId])
    assert.equal(service.anomalies().length, 0)
    assert.equal(service.countermeasures().length, 0)
    assert.equal(service.statusHistory().length, 0)
    const raw = new Database(file, { readonly: true })
    assert.equal((raw.prepare('SELECT COUNT(*) n FROM daily_metrics WHERE dataset_id = ?').get(dataset.datasetId) as { n: number }).n, 0)
    raw.close()
    assert.equal(service.upload('ga4.csv', ga4Drop()).duplicate, false, 'the same file can be uploaded again')
    assert.throws(() => service.deleteDataset('DS-9999'), /not found/)
  })

  it('does not keep a half-imported file when saving fails', () => {
    const db = new SeoDatabase(':memory:')
    const service = new SeoService(db, ontology)
    db.insertAnomaly = () => {
      throw new Error('disk full')
    }
    assert.throws(() => service.upload('ga4.csv', ga4Drop()), /disk full/)
    assert.equal(service.datasets().length, 0)
  })
})
