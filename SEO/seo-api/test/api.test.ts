import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadOntology } from '../src/ontology.ts'
import { createApp } from '../src/server.ts'
import { SeoService } from '../src/service.ts'
import { SeoDatabase } from '../src/db.ts'

const SEO_DIR = new URL('../../', import.meta.url)
const GSC_DIR = new URL('https___www.dospara.co.jp_-Performance-on-Search-2026-09-18/', SEO_DIR)
const read = (rel: string, base = SEO_DIR) => readFileSync(new URL(rel, base), 'utf8')

const gscDaily = read('平均読み込み時間のチャート.csv', GSC_DIR)

function gscCsv(days: { date: string; clicks: number; impressions: number; position: number }[]) {
  const rows = days.map((d) => `${d.date},${d.clicks},${d.impressions},${((d.clicks / d.impressions) * 100).toFixed(2)}%,${d.position}`)
  return ['日付,クリック数,表示回数,CTR,掲載順位', ...rows].join('\n')
}

function ga4Csv(days: { date: string; total: number; buy: number; organic: number; paid: number }[]) {
  return [
    '# GA4 test export',
    'セグメント,通販（全体）,通販（全体）,通販（全体） オーガニックサーチ,通販（全体） オーガニックサーチ,通販（全体） ペイド系合算,通販（全体） ペイド系合算',
    '日付,セッション,e コマース購入数,セッション,e コマース購入数,セッション,e コマース購入数',
    ...days.map((d) => `${d.date},${d.total},${d.buy},${d.organic},0,${d.paid},0`),
  ].join('\n')
}

const dates = (start: string, n: number) =>
  Array.from({ length: n }, (_, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10))

let base = ''
let server: ReturnType<typeof createApp>

async function call(method: string, path: string, body?: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, { method, body, headers })
  const json = (await res.json()) as any
  return { status: res.status, json: json?.items?.length === 1 ? json.items[0] : json }
}
const upload = (fileName: string, text: string) =>
  call('POST', '/api/datasets', text, { 'Content-Type': 'text/csv', 'X-File-Name': encodeURIComponent(fileName) })

before(async () => {
  server = createApp(new SeoService(new SeoDatabase(':memory:'), loadOntology(fileURLToPath(SEO_DIR))))
  await new Promise<void>((r) => server.listen(0, r))
  base = `http://localhost:${(server.address() as AddressInfo).port}`
})
after(() => server.close())

describe('real dospara exports', () => {
  it('compares the last two weeks of the GSC daily chart', async () => {
    const { status, json } = await upload('平均読み込み時間のチャート.csv', gscDaily)
    assert.equal(status, 200)
    assert.equal(json.dataset.source, 'gsc-daily')
    assert.equal(json.dataset.rowCount, 92)
    const clicks = json.dataset.comparisons.find((c: any) => c.metricKey === 'clicks')
    assert.deepEqual(clicks.currentPeriod.end, json.dataset.period.end)
    assert.equal(json.dataset.weeklyTrend.length, 12)
    for (const a of json.anomalies) assert.equal(a.threshold.confirmed, false)
  })

  it('warns instead of comparing when GA4 has only 6 days', async () => {
    const { status, json } = await upload('download (43).csv', read('download (43).csv'))
    assert.equal(status, 200)
    assert.equal(json.dataset.source, 'ga4-daily')
    assert.equal(json.dataset.rowCount, 6)
    assert.equal(json.dataset.comparisons.length, 0)
    assert.equal(json.anomalies.length, 0)
    assert.match(json.dataset.warnings.join(' '), /needs 14 consecutive days/)
  })

  it('stores GA4 totals-only and GSC page exports as snapshots', async () => {
    const ga4 = await upload('download (29) (1).csv', read('download (29) (1).csv'))
    assert.equal(ga4.json.dataset.source, 'ga4-snapshot')
    const pages = await upload('ページ.csv', read('ページ.csv', GSC_DIR))
    assert.equal(pages.json.dataset.source, 'gsc-pages')
    assert.equal(pages.json.dataset.rowCount, 1000)
  })

  it('treats the same file with a BOM or CRLF line endings as a duplicate', async () => {
    const plain = (await upload('bom-test.csv', '日付,クリック数,表示回数,CTR,掲載順位\n2026-01-01,1,10,10%,2')).json
    assert.equal(plain.duplicate, false)
    const bomCrlf = await upload('bom-test.csv', '\uFEFF日付,クリック数,表示回数,CTR,掲載順位\r\n2026-01-01,1,10,10%,2')
    assert.equal(bomCrlf.json.duplicate, true)
  })

  it('does not import the same file twice', async () => {
    const { json } = await upload('平均読み込み時間のチャート.csv', gscDaily)
    assert.equal(json.duplicate, true)
  })
})

describe('detection rules', () => {
  it('flags a GA4 sessions drop at the ±3.9% threshold and blames organic', async () => {
    const days = dates('2026-08-01', 14).map((date, i) =>
      i < 7 ? { date, total: 1000, buy: 20, organic: 500, paid: 100 } : { date, total: 950, buy: 19, organic: 455, paid: 98 },
    )
    const { json } = await upload('ga4-drop.csv', ga4Csv(days))
    const sessions = json.anomalies.find((a: any) => a.metricKey === 'sessions')
    assert.ok(sessions, 'sessions anomaly expected for −5%')
    assert.equal(Math.round(sessions.changePercentage * 10) / 10, -5)
    const cause = json.causes.find((h: any) => h.anomalyId === sessions.anomalyId)
    const cm = json.countermeasures.find((c: any) => c.causeId === cause.causeId)
    assert.equal(cm.ownerTeam, 'SEO team')
    assert.equal(cause.rule, 'SEO.txt ① 集客状況')
    assert.equal(sessions.judgmentConditionId, 'JC-SESSIONS')
    assert.ok(!json.anomalies.some((a: any) => a.metricKey === 'cvr'), 'CVR unchanged at 2%')
  })

  it('does not flag a 3% sessions change', async () => {
    const days = dates('2026-08-01', 14).map((date, i) => ({ date, total: i < 7 ? 1000 : 970, buy: 20, organic: 500, paid: 100 }))
    const { json } = await upload('ga4-small.csv', ga4Csv(days))
    assert.equal(json.anomalies.length, 0)
  })

  it('uses impression-weighted position and recomputes CTR from totals', async () => {
    const days = dates('2026-08-01', 14).map((date, i) =>
      i < 7 ? { date, clicks: 100, impressions: 1000, position: 5 } : { date, clicks: 60, impressions: 1000, position: 5 },
    )
    const { json } = await upload('gsc-ctr.csv', gscCsv(days))
    const ctr = json.dataset.comparisons.find((c: any) => c.metricKey === 'ctr')
    assert.equal(ctr.previous, 10)
    assert.equal(ctr.current, 6)
    const ctrAnomaly = json.anomalies.find((a: any) => a.metricKey === 'ctr')
    const cause = json.causes.find((h: any) => h.anomalyId === ctrAnomaly.anomalyId)
    const cm = json.countermeasures.find((c: any) => c.causeId === cause.causeId)
    assert.match(cm.description, /titles, meta descriptions/)
    assert.equal(cause.ruleConfirmed, false)
  })
})

describe('review workflow', () => {
  it('enforces countermeasure transitions', async () => {
    const { json: list } = await call('GET', '/api/countermeasures')
    const id = list[0].countermeasureId
    assert.equal((await call('PATCH', `/api/countermeasures/${id}`, JSON.stringify({ status: 'VerifiedEffective' }))).status, 400)
    assert.equal((await call('PATCH', `/api/countermeasures/${id}`, JSON.stringify({ status: 'Approved' }))).json.status, 'Approved')
  })

  it('does not misread page-level daily exports as the site chart', async () => {
    const csv = ['日付,ページ,クリック数,表示回数,CTR,掲載順位', '2026-09-16,https://a/,10,100,10%,3', '2026-09-16,https://b/,5,50,10%,4'].join('\n')
    const { status, json } = await upload('pages-daily.csv', csv)
    assert.equal(status, 400)
    assert.match(json.error, /not analysed yet/)
  })

  it('rejects unknown files and non-CSV uploads', async () => {
    assert.equal((await upload('x.csv', 'foo,bar\n1,2')).status, 400)
    assert.equal((await upload('x.xlsx', 'whatever')).status, 400)
  })

  it('builds dashboard and weekly report', async () => {
    const { json: d } = await call('GET', '/api/dashboard')
    assert.ok(d.stats.totalAnomalies > 0)
    const { json: r } = await call('GET', '/api/reports/weekly')
    assert.equal(r.dataSources.length, d.stats.datasets)
    assert.ok(r.decisions.countermeasures.Approved >= 1)
  })
})
