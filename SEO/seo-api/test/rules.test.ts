import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { SeoDatabase } from '../src/db.ts'
import { loadOntology } from '../src/ontology.ts'
import { SeoService } from '../src/service.ts'

const ontology = loadOntology(fileURLToPath(new URL('../../', import.meta.url)))

function ga4(prev: [number, number], cur: [number, number], organicPaid?: { prev: [number, number]; cur: [number, number] }) {
  const day = (i: number) => new Date(Date.parse('2026-08-01T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10)
  const head = organicPaid
    ? [
        'セグメント,通販（全体）,通販（全体）,通販（全体） オーガニックサーチ,通販（全体） オーガニックサーチ,通販（全体） ペイド系合算,通販（全体） ペイド系合算',
        '日付,セッション,e コマース購入数,セッション,e コマース購入数,セッション,e コマース購入数',
      ]
    : ['セグメント,通販（全体）,通販（全体）', '日付,セッション,e コマース購入数']
  const rows = Array.from({ length: 14 }, (_, i) => {
    const [s, p] = i < 7 ? prev : cur
    if (!organicPaid) return `${day(i)},${s},${p}`
    const [o, pd] = i < 7 ? organicPaid.prev : organicPaid.cur
    return `${day(i)},${s},${p},${o},0,${pd},0`
  })
  return [...head, ...rows].join('\n')
}

function causeFor(csv: string, metric: string) {
  const r = new SeoService(new SeoDatabase(':memory:'), ontology).upload('t.csv', csv)
  const a = r.anomalies.find((x) => x.metricKey === metric)
  assert.ok(a, `${metric} anomaly expected`)
  const cause = r.causes.find((c) => c.anomalyId === a.anomalyId)!
  const cm = r.countermeasures.find((c) => c.causeId === cause.causeId)!
  return { cause, cm }
}

describe('SEO.txt rule ② 購入効率 (CVR)', () => {
  it('sessions up + CV flat or down → traffic quality', () => {
    const { cause, cm } = causeFor(ga4([1000, 100], [1060, 90]), 'cvr')
    assert.match(cause.hypothesis, /lower quality/)
    assert.match(cm.description, /quality of the added traffic/)
    assert.equal(cause.rule, 'SEO.txt ② 購入効率')
    assert.match(cause.supportingEvidence, /purchases −10\.0% \(down\)/)
  })

  it('sessions flat + CVR down → product, price or page side', () => {
    const { cause } = causeFor(ga4([1000, 100], [1010, 90]), 'cvr')
    assert.match(cause.hypothesis, /product, price or page/)
  })

  it('CVR and sessions both up → improvement factor', () => {
    const { cause } = causeFor(ga4([1000, 100], [1100, 121]), 'cvr')
    assert.match(cause.hypothesis, /both rose/)
  })

  it('sessions up but CV also up while CVR falls is not the traffic-quality case', () => {
    const { cause } = causeFor(ga4([1000, 100], [1300, 110]), 'cvr')
    assert.equal(cause.rule, 'SEO.txt ② 購入効率 (no matching case)')
  })

  it('a combination SEO.txt does not describe is sent for manual review', () => {
    const { cause, cm } = causeFor(ga4([1000, 100], [900, 80]), 'cvr')
    assert.equal(cause.rule, 'SEO.txt ② 購入効率 (no matching case)')
    assert.equal(cm.description, 'Review manually.')
  })
})

describe('SEO.txt rule ① 集客状況 (sessions)', () => {
  it('a mainly paid decline goes to the ads team', () => {
    const { cause, cm } = causeFor(ga4([1000, 20], [940, 19], { prev: [500, 100], cur: [495, 45] }), 'sessions')
    assert.equal(cause.hypothesis, 'The decline is mainly paid traffic.')
    assert.equal(cm.ownerTeam, 'Ads team')
    assert.match(cause.supportingEvidence, /organic −35, paid −385/)
  })

  it('an increase is not described by SEO.txt ① and goes to manual review', () => {
    const { cause } = causeFor(ga4([1000, 20], [1060, 21], { prev: [500, 100], cur: [550, 100] }), 'sessions')
    assert.equal(cause.rule, 'SEO.txt ① 集客状況 (no matching case)')
  })
})
