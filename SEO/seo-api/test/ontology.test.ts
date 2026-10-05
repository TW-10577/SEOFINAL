import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadOntology } from '../src/ontology.ts'
import { SeoService } from '../src/service.ts'
import { SeoDatabase } from '../src/db.ts'

const SEO_DIR = fileURLToPath(new URL('../../', import.meta.url))

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
  return [
    'セグメント,通販（全体）,通販（全体）',
    '日付,セッション,e コマース購入数',
    ...totals.map(([s, p], i) => `${day(i)},${s},${p}`),
  ].join('\n')
}

describe('SEO ontology', () => {
  it('loads the YAML in the SEO folder and agrees with the API code', () => {
    const ontology = loadOntology(SEO_DIR)
    const summary = ontology.summary()
    assert.deepEqual(summary.objects.map((o) => o.apiName).sort(), ['Countermeasure', 'SEOAnomaly'])
    assert.deepEqual(summary.relations, ['logos.seo.relation.anomaly-has-countermeasure'])
    assert.equal(summary.functions.length, 2)
    assert.equal(ontology.thresholds.sessions.value, 3.9)
    assert.doesNotThrow(() => new SeoService(new SeoDatabase(':memory:'), ontology))
  })

  it('refuses to start when a status enum drifts from the code', () => {
    const dir = copyOntology((d) => replaceIn(join(d, 'value-types/value-type-anomaly-status.logos.yaml'), 'value: Resolved', 'value: Closed'))
    assert.throws(() => new SeoService(new SeoDatabase(':memory:'), loadOntology(dir)), /anomaly-status.*Missing in YAML: Resolved.*Not handled by code: Closed/)
  })

  it('refuses an invalid threshold config', () => {
    const bad = copyOntology((d) => replaceIn(join(d, 'config/thresholds.yaml'), 'kind: rank', 'kind: percent'))
    assert.throws(() => loadOntology(bad), /thresholds\.position\.kind: "percent" is not one of relative, points, rank/)
    const wrongKind = copyOntology((d) =>
      replaceIn(join(d, 'config/thresholds.yaml'), 'kind: points\n    value: 0.5', 'kind: relative\n    value: 0.5'),
    )
    assert.throws(() => new SeoService(new SeoDatabase(':memory:'), loadOntology(wrongKind)), /"ctr" must have kind points/)
  })

  it('reports unresolved value type references', () => {
    const dir = copyOntology((d) => replaceIn(join(d, 'objects/seo-anomaly.logos.yaml'), 'logos.seo.value.period', 'logos.seo.value.missing'))
    assert.throws(() => loadOntology(dir), /Unresolved type references: .*previousPeriod → logos\.seo\.value\.missing/)
  })

  it('reports broken references in relations and functions', () => {
    const rel = copyOntology((d) =>
      replaceIn(join(d, 'relations/relation-anomaly-has-countermeasure.logos.yaml'), 'returnsTypeRef: logos.seo.object.countermeasure', 'returnsTypeRef: logos.seo.object.search-query'),
    )
    assert.throws(() => loadOntology(rel), /anomaly-has-countermeasure\.countermeasures → logos\.seo\.object\.search-query/)
    const fn = copyOntology((d) =>
      replaceIn(join(d, 'functions/function-suggest-cause.logos.yaml'), 'logos.seo.value.priority-level', 'logos.seo.value.confidence-level'),
    )
    assert.throws(() => loadOntology(fn), /suggest-cause\.priority → logos\.seo\.value\.confidence-level/)
  })

  it('uses the threshold from config/thresholds.yaml for detection', () => {
    const drop: [number, number][] = [...Array(7).fill([1000, 20]), ...Array(7).fill([950, 19])]

    const defaults = new SeoService(new SeoDatabase(':memory:'), loadOntology(SEO_DIR))
    assert.equal(defaults.upload('a.csv', ga4Csv(drop)).anomalies.length, 1, '−5% sessions crosses ±3.9%')

    const relaxed = copyOntology((d) => replaceIn(join(d, 'config/thresholds.yaml'), 'value: 3.9', 'value: 6'))
    const service = new SeoService(new SeoDatabase(':memory:'), loadOntology(relaxed))
    assert.equal(service.upload('a.csv', ga4Csv(drop)).anomalies.length, 0, '−5% does not cross ±6%')
  })

  it('rejects stored objects that do not conform', () => {
    const ontology = loadOntology(SEO_DIR)
    assert.throws(() => ontology.assertObject('logos.seo.object.countermeasure', { countermeasureId: 'CM-1' }), /relatedAnomalyId: required/)
  })
})
