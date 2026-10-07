// GSC is supporting evidence for rule ① only when organic traffic decreases (SEO.txt).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { importFiles } from '../src/import/index.ts';
import { localize } from '../src/i18n.ts';
import { runMeasurements } from '../src/measure/engine.ts';
import { getMeasurementDetail, listAnomalies, listMeasurements } from '../src/measure/read.ts';
import { GSC_DIR, clientFiles, config, freshDb, ga4Csv, gscDailyCsv, importGa4, type WeekValues } from './helpers.ts';

const prev: WeekValues = { total: [1000, 10], organic: [500, 5], advertising: [100, 1] };
const organicDown: WeekValues = { total: [900, 10], organic: [400, 5], advertising: [100, 1] };

function setup(current: WeekValues) {
  const db = freshDb();
  const cfg = config();
  importGa4(db, cfg, ga4Csv(prev, current));
  importFiles(db, cfg, clientFiles(GSC_DIR), { source: 'GSC' });
  return { db, cfg };
}

function rule1(db: ReturnType<typeof freshDb>, cfg: ReturnType<typeof config>, runId: number) {
  return localize(getMeasurementDetail(db, cfg, listMeasurements(db, cfg, runId).find((m) => m.ruleId === 'GA4-R1')!.id)!, 'en');
}

describe('GSC supporting evidence for rule ①', () => {
  test('query evidence: top keywords, brand classification and brand share (no WoW)', () => {
    const { db, cfg } = setup(organicDown);
    const d = rule1(db, cfg, runMeasurements(db, cfg));
    const t = d.cause!.supportingEvidence.tables.find((x) => x.title.startsWith('GSC queries'))!;
    assert.ok(t, 'query table attached');
    assert.equal(t.rows[0]![0], 'ドスパラ');
    assert.equal(t.rows[0]![1], 'brand');
    assert.match(t.note!, /No WoW/);
    const share = d.cause!.supportingEvidence.items.find((i) => i.label.startsWith('Brand share'))!;
    assert.match(share.value, /^65\.9%/);
    assert.ok(share.caveat, 'brand rule flagged as provisional');
  });

  test('page evidence: share of site clicks matches SEO.txt (top page 19.6%, /gamepc 7.1%)', () => {
    const { db, cfg } = setup(organicDown);
    const d = rule1(db, cfg, runMeasurements(db, cfg));
    const t = d.cause!.supportingEvidence.tables.find((x) => x.title.startsWith('GSC pages'))!;
    assert.deepEqual(t.rows.slice(0, 2).map((r) => [r[0], r[2]]), [
      ['https://www.dospara.co.jp/', '19.6%'],
      ['https://www.dospara.co.jp/gamepc', '7.1%'],
    ]);
  });

  test('daily chart not covering the measured weeks → not used in the hypothesis', () => {
    const { db, cfg } = setup(organicDown);
    const d = rule1(db, cfg, runMeasurements(db, cfg));
    assert.match(d.cause!.causeText, /does not cover the measured weeks/);
    const ref = d.cause!.supportingEvidence.tables.find((t) => t.title.startsWith('Reference only'));
    assert.ok(ref, 'latest available weeks shown as reference');
    assert.match(ref!.note!, /not used in the cause hypothesis/);
  });

  test('daily chart covering the measured weeks → client-defined observations', () => {
    const db = freshDb();
    const cfg = config();
    importGa4(db, cfg, ga4Csv(prev, organicDown));
    // 14 days aligned with GA4: position worse, impressions down, CTR down in week 2.
    const rows: [number, number, number][] = [
      ...Array.from({ length: 7 }, () => [100, 1000, 5] as [number, number, number]),
      ...Array.from({ length: 7 }, () => [60, 900, 6] as [number, number, number]),
    ];
    importFiles(db, cfg, [{ fileName: 'daily.csv', buffer: gscDailyCsv('2026-09-10', rows) }], { source: 'GSC' });
    const d = rule1(db, cfg, runMeasurements(db, cfg));
    assert.match(d.cause!.causeText, /ranking dropped/);
    assert.match(d.cause!.causeText, /fewer searches/);
    assert.match(d.cause!.causeText, /title\/snippet problem/);
    assert.equal(d.cause!.reviewStatus, 'NotReviewed');
  });

  test('organic not decreasing → GSC is not used', () => {
    const { db, cfg } = setup({ total: [900, 10], organic: [500, 5], advertising: [0, 1] });
    const d = rule1(db, cfg, runMeasurements(db, cfg));
    assert.equal(d.cause?.branch, 'advertising');
    assert.ok(!d.cause!.supportingEvidence.tables.some((t) => t.title.includes('GSC')));
  });

  test('GSC alone never produces a measurement result or anomaly', () => {
    const db = freshDb();
    const cfg = config();
    importFiles(db, cfg, clientFiles(GSC_DIR), { source: 'GSC' });
    const runId = runMeasurements(db, cfg);
    assert.ok(listMeasurements(db, cfg, runId).every((m) => m.status === 'NOT_EVALUABLE'));
    assert.equal(listAnomalies(db).length, 0);
  });

  test('GSC data without a time dimension is flagged as having no WoW', () => {
    const db = freshDb();
    const [u] = importFiles(db, config(), clientFiles(GSC_DIR).filter((f) => f.fileName === 'クエリ.csv'), { source: 'GSC' });
    assert.ok(u!.issues.some((i) => i.code === 'no-wow'));
    assert.ok(u!.issues.some((i) => i.code === 'no-period'), 'period unknown without the daily chart or an entered period');
  });
});
