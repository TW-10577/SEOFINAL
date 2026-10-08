// The SEO system runs on LOGOS_SEO_Ontology_Standalone_Final: these tests keep the two in agreement.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { createApp } from '../src/app.ts';
import { importFiles } from '../src/import/index.ts';
import { runMeasurements } from '../src/measure/engine.ts';
import { TransitionError, changeState, getMeasurementDetail, listAnalysisResults, listMeasurements } from '../src/measure/read.ts';
import {
  DEFAULT_ONTOLOGY_DIR,
  OntologyError,
  STATUS_TO_SIGNIFICANCE,
  SUBJECT_TO_UNIT,
  VT,
  checkJudgmentConditions,
  loadOntology,
  vocabCodes,
  vocabulary,
} from '../src/ontology.ts';
import { GA4_DIR, clientFiles, config, freshDb, ontology, weeksChart } from './helpers.ts';

const apiNames = (vt: string) => vocabulary(ontology(), vt).map((v) => v.apiName).sort();

/** Values allowed by a CHECK (col IN (...)) constraint in schema.sql. */
function checkValues(table: string, column: string): string[] {
  const sql = readFileSync(resolve(import.meta.dirname, '../src/schema.sql'), 'utf8');
  const body = sql.slice(sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`));
  const m = new RegExp(`CHECK \\(${column} IN \\(([^)]*)\\)\\)`).exec(body.slice(0, body.indexOf(');')));
  assert.ok(m, `${table}.${column} has a CHECK constraint`);
  return m![1]!.split(',').map((v) => v.trim().replace(/'/g, '')).sort();
}

describe('ontology loads', () => {
  test('package, objects and the three governed lifecycles', () => {
    const o = ontology();
    assert.equal(o.packageId, 'logos.seo.package.seo');
    const objects = [...o.definitions.values()].filter((d) => d.kind === 'ObjectType').map((d) => d.apiName).sort();
    assert.deepEqual(objects, ['AnalysisPeriod', 'CauseHypothesis', 'Countermeasure', 'JudgmentCondition', 'Page', 'QueryClassification', 'SEOAnomaly', 'SEOData', 'SearchQuery', 'Site', 'TrafficSource']);
    assert.deepEqual([...o.lifecycles.keys()].sort(), ['CauseHypothesis', 'Countermeasure', 'SEOAnomaly']);
  });

  test('initial states match what the system creates (Detected / NotReviewed / Proposed)', () => {
    const o = ontology();
    assert.equal(o.lifecycles.get('SEOAnomaly')!.initial, 'Detected');
    assert.equal(o.lifecycles.get('CauseHypothesis')!.initial, 'NotReviewed');
    assert.equal(o.lifecycles.get('Countermeasure')!.initial, 'Proposed');
  });
});

describe('database matches the ontology vocabularies', () => {
  test('anomaly state', () => assert.deepEqual(checkValues('anomalies', 'state'), apiNames(VT.anomalyStatus)));
  test('cause review status', () => assert.deepEqual(checkValues('cause_hypotheses', 'review_status'), apiNames(VT.reviewStatus)));
  test('cause confidence', () => assert.deepEqual(checkValues('cause_hypotheses', 'confidence'), apiNames(VT.confidence)));
  test('countermeasure status', () => assert.deepEqual(checkValues('countermeasures', 'status'), apiNames(VT.countermeasureStatus)));
  test('measurement status ↔ SignificanceResult', () => {
    assert.deepEqual(checkValues('measurements', 'status'), Object.keys(STATUS_TO_SIGNIFICANCE).sort());
    assert.deepEqual(Object.values(STATUS_TO_SIGNIFICANCE).sort(), vocabCodes(ontology(), VT.significance).sort());
  });
  test('upload source ↔ DataSource', () => assert.deepEqual(checkValues('uploads', 'source'), vocabCodes(ontology(), VT.dataSource).sort()));
});

describe('the engine only produces ontology values', () => {
  test('subject types, statuses and confidence from a real run', async () => {
    const db = (await freshDb());
    const cfg = config((c) => (c.dataPolicy.evaluateSyntheticData = true)); // reaches an anomaly
    (await importFiles(db, cfg, clientFiles(GA4_DIR), { source: 'GA4' }));
    const runId = (await runMeasurements(db, cfg));
    const units = new Set(vocabCodes(ontology(), VT.subjectType));
    for (const r of (await listAnalysisResults(db, runId))) assert.ok(units.has(SUBJECT_TO_UNIT[r.subjectType as keyof typeof SUBJECT_TO_UNIT]), `analysis subject ${r.subjectType}`);
    for (const m of (await listMeasurements(db, cfg, runId))) {
      const d = (await getMeasurementDetail(db, cfg, m.id))!;
      if (!d.anomaly) continue;
      assert.ok(units.has(SUBJECT_TO_UNIT[d.anomaly.subjectType as keyof typeof SUBJECT_TO_UNIT]));
      assert.ok(apiNames(VT.confidence).includes(d.cause!.confidence));
    }
  });
});

describe('state changes follow the ontology lifecycles', () => {
  async function run() {
    const db = (await freshDb());
    const cfg = config((c) => (c.dataPolicy.evaluateSyntheticData = true)); // client dummy file in test-data mode
    (await importFiles(db, cfg, clientFiles(GA4_DIR), { source: 'GA4' }));
    (await importFiles(db, cfg, [weeksChart()], { source: 'GSC' })); // determines the cause → countermeasure proposed
    const runId = (await runMeasurements(db, cfg));
    const m = (await listMeasurements(db, cfg, runId)).find((x) => x.status === 'NG')!;
    return { db, d: (await getMeasurementDetail(db, cfg, m.id))! };
  }

  test('every countermeasure transition in the YAML can be walked to a terminal state', async () => {
    const { db, d } = (await run());
    const id = d.countermeasures[0]!.id;
    (await changeState(db, ontology(), 'cause', d.cause!.id, 'Confirmed', 'Tanaka')); // guard: approve only a confirmed cause
    for (const to of ['Approved', 'InProgress', 'Completed', 'VerifiedEffective']) (await changeState(db, ontology(), 'countermeasure', id, to, 'Tanaka'));
    await assert.rejects(() => changeState(db, ontology(), 'countermeasure', id, 'VerifiedIneffective', 'Tanaka'), TransitionError);
  });

  test('a move the ontology does not declare is refused (Triaged → Dismissed)', async () => {
    const { db, d } = (await run());
    (await changeState(db, ontology(), 'anomaly', d.anomaly!.id, 'Triaged', 'Tanaka'));
    await assert.rejects(() => changeState(db, ontology(), 'anomaly', d.anomaly!.id, 'Dismissed', 'Tanaka'), /not a transition in the ontology lifecycle/);
  });

  test('cause: NeedsMoreEvidence → Confirmed is declared and allowed', async () => {
    const { db, d } = (await run());
    (await changeState(db, ontology(), 'cause', d.cause!.id, 'NeedsMoreEvidence', 'Sato'));
    (await changeState(db, ontology(), 'cause', d.cause!.id, 'Confirmed', 'Sato'));
  });
});

describe('judgment conditions (rules.yaml) satisfy the JudgmentCondition contract', () => {
  const contract = (c = config()) => c.rules.map((r) => ({ id: r.id, thresholdUnit: r.thresholdUnit, direction: r.direction, conditionType: r.conditionType }));
  test('the configured rules are valid', () => assert.deepEqual(checkJudgmentConditions(ontology(), contract()), []));
  test('an unknown unit or direction is reported', () => {
    const bad = config((c) => {
      c.rules[0]!.thresholdUnit = 'ratio' as any;
      c.rules[1]!.direction = 'sideways';
    });
    const problems = checkJudgmentConditions(ontology(), contract(bad));
    assert.equal(problems.length, 2);
    assert.match(problems.join('\n'), /ThresholdUnit/);
    assert.match(problems.join('\n'), /ChangeDirection/);
  });
});

describe('a broken ontology stops the system', () => {
  function withCopy(edit: (dir: string) => void, check: (dir: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), 'ont-'));
    try {
      cpSync(DEFAULT_ONTOLOGY_DIR, dir, { recursive: true });
      edit(dir);
      check(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const file = (dir: string, rel: string) => join(dir, 'domains/seo', rel);

  test('a transition whose action does not perform it (LIF-07)', () =>
    withCopy(
      (dir) => {
        const p = file(dir, 'actions/triage-anomaly.logos.yaml');
        writeFileSync(p, readFileSync(p, 'utf8').replace('#transition/triage', '#transition/resolve'));
      },
      (dir) => assert.throws(() => loadOntology(dir), /LIF-07/),
    ));

  test('an initial state that differs from what the system creates', () =>
    withCopy(
      (dir) => {
        const p = file(dir, 'objects/countermeasure.logos.yaml');
        const s = readFileSync(p, 'utf8');
        const moved = s.replace(/(- code: PROPOSED[\s\S]*?)\n\s*initial: true\n/, '$1\n').replace(/(\n(\s*)- code: APPROVED\n)/, '$1$2  initial: true\n');
        assert.notEqual(moved, s);
        writeFileSync(p, moved);
      },
      (dir) => assert.throws(() => loadOntology(dir), /initial state is Approved/),
    ));

  test('invalid YAML is reported with its file', () =>
    withCopy(
      (dir) => writeFileSync(file(dir, 'objects/page.logos.yaml'), 'kind: [unclosed'),
      (dir) => assert.throws(() => loadOntology(dir), /objects\/page\.logos\.yaml: not valid YAML/),
    ));

  test('a missing object the system uses', () =>
    withCopy(
      (dir) => rmSync(file(dir, 'objects/site.logos.yaml')),
      (dir) => assert.throws(() => loadOntology(dir), /missing objects the system uses: Site/),
    ));
});

describe('API', () => {
  test('GET /api/ontology in Japanese', async () => {
    const app = createApp((await freshDb()), config(), ontology());
    const o = (await (await app.request('/api/ontology', { headers: { 'x-lang': 'ja' } })).json()) as any;
    assert.equal(o.packageId, 'logos.seo.package.seo');
    assert.equal(o.counts.ObjectType, 11);
    const triage = o.lifecycles.anomaly.transitions.find((t: any) => t.to === 'Triaged');
    assert.equal(triage.actionLabel, '異常のトリアージ');
    assert.equal(o.objects.find((x: any) => x.apiName === 'SEOAnomaly').label, 'SEO 異常');
  });
});
