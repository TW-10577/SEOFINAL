// Rule ① follow-up: detect → client action (feedback to the team) with the evidence: GA4 trend, SEO.txt GSC signals.
import assert from 'node:assert/strict';
import type { DB } from '../src/db.ts';
import { describe, test } from 'node:test';
import type { Period } from '@seo/shared';
import { importFiles } from '../src/import/index.ts';
import { localize } from '../src/i18n.ts';
import { runMeasurements } from '../src/measure/engine.ts';
import { changeState, getMeasurementDetail, listMeasurements } from '../src/measure/read.ts';
import { config, freshDb, ga4Csv, gscDailyCsv, importGa4, ontology } from './helpers.ts';

// GA4: total −10%, organic −20% (all of the decrease), advertising flat.
const PREV = { total: [1000, 10], organic: [500, 5], advertising: [100, 1] } as const;
const CUR = { total: [900, 10], organic: [400, 5], advertising: [100, 1] } as const;
const WEEK1: Period = { start: '2026-09-10', end: '2026-09-16' };
const WEEK2: Period = { start: '2026-09-17', end: '2026-09-23' };
type Day = [clicks: number, impressions: number, position: number];
const week = (d: Day) => Array.from({ length: 7 }, () => d);

async function run(setup: (db: DB) => unknown) {
  const db = (await freshDb());
  const cfg = config();
  (await importGa4(db, cfg, ga4Csv(PREV as any, CUR as any)));
  await setup(db);
  const runId = (await runMeasurements(db, cfg));
  const m = (await listMeasurements(db, cfg, runId)).find((x) => x.ruleId === 'GA4_R01')!;
  return { db, d: (await localize((await getMeasurementDetail(db, cfg, m.id))!, 'en')) };
}
const daily = (db: DB, prev: Day, cur: Day) =>
  importFiles(db, config(), [{ fileName: 'chart.csv', buffer: gscDailyCsv(WEEK1.start, [...week(prev), ...week(cur)]) }], {});
const weekly = async (db: DB, dim: 'page' | 'query', period: Period, rows: [string, number][]) => {
  const head = dim === 'page' ? '上位のページ' : '上位のクエリ';
  const csv = [`${head},クリック数,表示回数,CTR,掲載順位`, ...rows.map(([k, c]) => `${k},${c},${c * 10},10%,3`)].join('\n');
  (await importFiles(db, config(), [{ fileName: `${dim}.csv`, buffer: Buffer.from(csv) }], { period }));
};

describe('the change is detected first (rule ① stays as is)', () => {
  test('total sessions −10% → NG; organic is 100% of the decrease', async () => {
    const { d } = (await run(() => {}));
    assert.equal(d.measurement.status, 'NG');
    assert.equal(d.cause!.causeText, 'Organic Sessions decreased while Advertising Sessions did not decrease.');
    assert.equal(d.cause!.analysis!.contribution, '100.0% of the total session decrease');
  });
});

describe('cause from the GSC Chart by Date (same weeks); SEO.txt meanings by direction, no invented thresholds', () => {
  test('clicks ↓ + position worse → organic search performance may have weakened (Medium); countermeasure proposed', async () => {
    const { d } = (await run((db) => daily(db, [100, 1000, 5], [70, 1000, 6])));
    const a = d.cause!.analysis!;
    assert.equal(a.case, 'search_decline');
    assert.equal(a.determined, true);
    assert.deepEqual(a.gscEvidence!.dateChart.indications, ['ranking', 'ctr']);
    assert.equal(a.title, 'Organic Sessions decreased while Advertising Sessions did not decrease.');
    assert.ok(a.facts.some((f) => /GSC Chart by Date \(same weeks\)/.test(f)), 'GSC findings kept as supporting facts');
    assert.equal(d.cause!.confidence, 'High', 'the rules.yaml branch matched');
    assert.equal(d.countermeasures[0]!.actionText, 'Investigate the Organic traffic decrease using GSC. Identify affected queries and pages and check impressions, clicks, CTR, and position.');
    assert.match(d.countermeasures[0]!.reason, /Organic traffic decreased compared with the previous week/);
  });
  test('impressions ↓ with clicks ↓ → indication "search demand"', async () => {
    const { d } = (await run((db) => daily(db, [100, 1000, 5], [90, 900, 5])));
    assert.deepEqual(d.cause!.analysis!.gscEvidence!.dateChart.indications, ['search_demand']);
  });
  test('CTR ↓ with clicks ↓ → indication "CTR issue"', async () => {
    const { d } = (await run((db) => daily(db, [100, 1000, 5], [80, 1000, 5])));
    assert.deepEqual(d.cause!.analysis!.gscEvidence!.dateChart.indications, ['ctr']);
  });
  test('a tiny change still counts — SEO.txt gives no size (listed as an unresolved client question)', async () => {
    const { d } = (await run((db) => daily(db, [100, 1000, 5], [99, 1000, 5.01])));
    assert.deepEqual(d.cause!.analysis!.signals, ['ranking', 'snippet']);
  });
  test('clicks not down → not explained by Search Console (Low); no countermeasure', async () => {
    const { d } = (await run((db) => daily(db, [100, 1000, 5], [100, 1000, 6])));
    const a = d.cause!.analysis!;
    assert.equal(a.case, 'no_search_decline');
    assert.deepEqual(a.signals, ['ranking'], 'the position signal is still shown as evidence');
    assert.equal(d.countermeasures.length, 2, 'branch countermeasure + GSC_R01 countermeasure');
  });
});

describe('where the decrease is concentrated (weekly page / query exports) — system analysis, not a cause', () => {
  test('pages: largest decreases with contribution; pages in only one export are not compared (≠ 0 clicks)', async () => {
    const { d } = (await run(async (db) => {
      (await weekly(db, 'page', WEEK1, [['https://x.jp/a', 500], ['https://x.jp/b', 400], ['https://x.jp/c', 100], ['https://x.jp/gone', 50]]));
      (await weekly(db, 'page', WEEK2, [['https://x.jp/a', 300], ['https://x.jp/b', 390], ['https://x.jp/c', 110]]));
    }));
    const a = d.cause!.analysis!;
    assert.equal(a.case, 'undetermined', 'page data does not decide the cause');
    assert.deepEqual(a.affected!.rows[0], ['https://x.jp/a', 500, 300, -200, '-40.00%', '95.2%']);
    assert.ok(!a.affected!.rows.some((r) => r[0] === 'https://x.jp/gone'));
    assert.match(a.affected!.note!, /1 page\(s\) appear in only one week's export/);
    assert.equal(d.countermeasures.length, 2, 'branch countermeasure + GSC_R01 countermeasure');
  });
  test('queries only', async () => {
    const { d } = (await run(async (db) => {
      (await weekly(db, 'query', WEEK1, [['gaming pc', 300], ['dospara', 600]]));
      (await weekly(db, 'query', WEEK2, [['gaming pc', 200], ['dospara', 590]]));
    }));
    assert.equal(d.cause!.analysis!.affected!.rows[0]![0], 'gaming pc');
  });
});

describe('insufficient evidence: nothing is invented', () => {
  test('no GSC data → cause cannot be determined; the missing data is listed', async () => {
    const { d } = (await run(() => {}));
    const a = d.cause!.analysis!;
    assert.equal(a.title, 'Organic Sessions decreased while Advertising Sessions did not decrease.');
    assert.equal(a.missing.length, 1, 'the GSC Chart by Date for the measured weeks');
    assert.equal(d.countermeasures.length, 2, 'branch countermeasure + GSC_R01 countermeasure');
    assert.equal(d.cause!.analysis!.investigation!.confidence, 'insufficient_data');
    assert.ok(d.evidence.tables.some((t) => t.group === 'daily'), 'GA4 daily trend evidence is still shown');
  });
});

describe('human approval', () => {
  test('the system only proposes; the SEO team may confirm the cause and approve or reject the countermeasure', async () => {
    const { db, d } = (await run((db) => daily(db, [100, 1000, 5], [70, 1000, 6])));
    assert.equal(d.cause!.reviewStatus, 'NotReviewed');
    assert.equal(d.countermeasures[0]!.status, 'Proposed');
    await assert.rejects(() => changeState(db, ontology(), 'countermeasure', d.countermeasures[0]!.id, 'Approved', 'Tanaka'), /Confirm the cause first/);
    (await changeState(db, ontology(), 'countermeasure', d.countermeasures[0]!.id, 'Rejected', 'Tanaka', 'not now'));
    await assert.rejects(() => changeState(db, ontology(), 'countermeasure', d.countermeasures[0]!.id, 'Approved', 'Tanaka'));
  });
});
