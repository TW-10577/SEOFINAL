import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { SeoDatabase } from '../src/db.ts'
import { loadOntology } from '../src/ontology.ts'
import { SeoService } from '../src/service.ts'

const SEO_DIR = fileURLToPath(new URL('../../', import.meta.url))
const CONDITIONS = 'config/judgment-conditions.yaml'
const service = (dir = SEO_DIR) => new SeoService(new SeoDatabase(':memory:'), loadOntology(dir))

function copyOntology(edit: (dir: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'seo-ontology-'))
  for (const sub of ['objects', 'value-types', 'relations', 'functions', 'config']) cpSync(join(SEO_DIR, sub), join(dir, sub), { recursive: true })
  edit(dir)
  return dir
}

function replaceIn(file: string, from: string, to: string) {
  const text = readFileSync(file, 'utf8')
  assert.ok(text.includes(from), `${from} not found in ${file}`)
  writeFileSync(file, text.replace(from, to))
}

function ga4Csv(totals: [number, number][]) {
  const day = (i: number) => new Date(Date.parse('2026-08-01T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10)
  return ['セグメント,通販（全体）,通販（全体）', '日付,セッション,e コマース購入数', ...totals.map(([s, p], i) => `${day(i)},${s},${p}`)].join('\n')
}
const weeks = (a: [number, number], b: [number, number]) => [...Array(7).fill(a), ...Array(7).fill(b)] as [number, number][]

describe('SEO ontology', () => {
  it('loads the design-doc model and agrees with the API code', () => {
    const o = loadOntology(SEO_DIR).summary()
    assert.deepEqual(o.objects.map((x) => x.apiName).sort(), ['CauseHypothesis', 'Countermeasure', 'JudgmentCondition', 'SEOAnomaly'])
    assert.equal(o.relations.length, 3)
    assert.equal(o.functions.length, 2)
    assert.equal(o.conditions.find((c) => c.metricKey === 'sessions')?.threshold, 3.9)
    assert.deepEqual(o.lifecycles['logos.seo.value.anomaly-status'].transitions.Detected, ['Triaged'])
    assert.doesNotThrow(() => service())
  })

  it('refuses to start when a status enum drifts from the code', () => {
    const dir = copyOntology((d) =>
      replaceIn(join(d, 'value-types/value-type-anomaly-status.logos.yaml'), "  - value: Dismissed\n    displayName:\n      en: Dismissed", "  - value: Closed\n    displayName:\n      en: Closed"),
    )
    assert.throws(() => service(dir), /Dismissed/)
  })

  it('refuses a lifecycle that names unknown statuses or starts elsewhere', () => {
    const unknown = copyOntology((d) => replaceIn(join(d, 'value-types/value-type-anomaly-status.logos.yaml'), '- Triaged', '- Archived'))
    assert.throws(() => loadOntology(unknown), /lifecycle refers to unknown values: Archived/)
    const start = copyOntology((d) => replaceIn(join(d, 'value-types/value-type-countermeasure-status.logos.yaml'), 'initialValue: Proposed', 'initialValue: Approved'))
    assert.throws(() => service(start), /initialValue must be Proposed/)
  })

  it('refuses invalid judgment conditions', () => {
    const badUnit = copyOntology((d) => replaceIn(join(d, CONDITIONS), 'unit: rank', 'unit: percent'))
    assert.throws(() => loadOntology(badUnit), /unit: "percent" is not one of relative, points, rank/)
    const wrongUnit = copyOntology((d) => replaceIn(join(d, CONDITIONS), 'threshold: 3.9\n    unit: relative', 'threshold: 3.9\n    unit: points'))
    assert.throws(() => service(wrongUnit), /JC-SESSIONS: unit points is not valid for sessions/)
    const missing = copyOntology((d) => replaceIn(join(d, CONDITIONS), '    conditionType: numeric\n    confirmed: true\n', '    confirmed: true\n'))
    assert.throws(() => loadOntology(missing), /conditionType: required/)
  })

  it('reports broken references in objects, relations and functions', () => {
    const obj = copyOntology((d) => replaceIn(join(d, 'objects/seo-anomaly.logos.yaml'), 'logos.seo.value.period', 'logos.seo.value.missing'))
    assert.throws(() => loadOntology(obj), /previousPeriod → logos\.seo\.value\.missing/)
    const rel = copyOntology((d) =>
      replaceIn(join(d, 'relations/relation-countermeasure-addresses-cause.logos.yaml'), 'returnsTypeRef: logos.seo.object.cause-hypothesis', 'returnsTypeRef: logos.seo.object.search-query'),
    )
    assert.throws(() => loadOntology(rel), /countermeasure-addresses-cause\.causeHypothesis → logos\.seo\.object\.search-query/)
    const fn = copyOntology((d) => replaceIn(join(d, 'functions/function-suggest-cause.logos.yaml'), 'valueTypeRef: logos.seo.object.countermeasure', 'valueTypeRef: logos.seo.object.missing'))
    assert.throws(() => loadOntology(fn), /suggest-cause\.countermeasure → logos\.seo\.object\.missing/)
  })

  it('takes threshold, unit and direction from the judgment condition', () => {
    const drop = ga4Csv(weeks([1000, 20], [950, 19]))
    assert.equal(service().upload('a.csv', drop).anomalies.length, 1, '−5% sessions crosses ±3.9%')

    const relaxed = copyOntology((d) => replaceIn(join(d, CONDITIONS), 'threshold: 3.9', 'threshold: 6'))
    assert.equal(service(relaxed).upload('a.csv', drop).anomalies.length, 0, '−5% does not cross ±6%')

    const decreaseOnly = copyOntology((d) => replaceIn(join(d, CONDITIONS), 'direction: both\n    threshold: 3.9', 'direction: decrease\n    threshold: 3.9'))
    assert.equal(service(decreaseOnly).upload('a.csv', ga4Csv(weeks([1000, 20], [1050, 21]))).anomalies.length, 0, '+5% ignored when only decreases count')

    const cvrRelative = copyOntology((d) => replaceIn(join(d, CONDITIONS), 'threshold: 0.7\n    unit: points', 'threshold: 7\n    unit: relative'))
    const r = service(cvrRelative).upload('a.csv', ga4Csv(weeks([1000, 20], [1000, 18])))
    assert.deepEqual(r.anomalies.map((a) => [a.metricKey, a.judgmentConditionId, a.threshold.kind]), [['cvr', 'JC-CVR', 'relative']])
  })

  it('rejects objects that do not conform', () => {
    assert.throws(() => loadOntology(SEO_DIR).assertObject('logos.seo.object.countermeasure', { countermeasureId: 'CM-1' }), /causeId: required/)
  })
})
