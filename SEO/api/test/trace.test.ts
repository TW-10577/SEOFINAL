// Traceability, human decisions, persistence, report and API.
import assert from 'node:assert/strict';
import type { DB } from '../src/db.ts';
import { describe, test } from 'node:test';
import { createApp } from '../src/app.ts';
import { importFiles } from '../src/import/index.ts';
import { localize } from '../src/i18n.ts';
import { runMeasurements } from '../src/measure/engine.ts';
import { TransitionError, amendText, changeState, getMeasurementDetail, listMeasurements } from '../src/measure/read.ts';
import { buildReportDoc, buildReportText, renderText } from '../src/report.ts';
import { GA4_DIR, GSC_DIR, clientFiles, config, freshDb, ga4Csv, ontology, reopenDb, weeksChart } from './helpers.ts';

// The client's GA4 file says "Real data: 20260910-20260915 / Fake data: 20260916-20260923". By default those
// fake dates are excluded; the workflow tests below run in test-data mode (rules.yaml data_policy) on purpose.
const testMode = () => config((c) => (c.dataPolicy.evaluateSyntheticData = true));

/** Client files in test-data mode; `chart` adds a GSC Chart by Date covering the measured weeks (the client chart ends 09-15). */
async function clientRun(given?: DB, chart = true) {
  const db = given ?? (await freshDb());
  const cfg = testMode();
  (await importFiles(db, cfg, clientFiles(GA4_DIR), { source: 'GA4' }));
  (await importFiles(db, cfg, clientFiles(GSC_DIR), { source: 'GSC' }));
  if (chart) (await importFiles(db, cfg, [weeksChart()], { source: 'GSC' }));
  const runId = (await runMeasurements(db, cfg));
  const r1 = (await localize((await getMeasurementDetail(db, cfg, (await listMeasurements(db, cfg, runId)).find((m) => m.ruleId === 'GA4_R01')!.id))!, 'en'));
  return { db, cfg, runId, r1 };
}

describe('client dummy data (two GA4 weeks)', () => {
  test('opt-out: dates the export marks as fake left out → no complete period, NOT_EVALUABLE, no anomaly', async () => {
    const db = (await freshDb());
    const cfg = config((c) => (c.dataPolicy.evaluateSyntheticData = false));
    (await importFiles(db, cfg, clientFiles(GA4_DIR), { source: 'GA4' }));
    const runId = (await runMeasurements(db, cfg, { currentEnd: '2026-09-23' }));
    const ms = (await localize((await listMeasurements(db, cfg, runId)), 'en'));
    assert.deepEqual(ms.map((m) => m.status), ['NOT_EVALUABLE', 'NOT_EVALUABLE']);
    assert.match(ms[0]!.reason, /2026-09-17 … 2026-09-23 \(7 days\) marked as not real data in the export and excluded/);
    assert.equal((await db.value('SELECT COUNT(*) FROM anomalies')), 0);
    const run = (await db.value('SELECT issues_json FROM measurement_runs WHERE id = ?', runId)) as string;
    assert.ok(JSON.parse(run).some((i: { code: string }) => i.code === 'synthetic-data-excluded'));
  });

  test('test-data mode: rule ① NG −4.42%, marked as test data; countermeasure = the client action', async () => {
    const { r1 } = (await clientRun());
    assert.equal(r1.measurement.status, 'NG');
    assert.match(r1.measurement.result, /^\[TEST DATA\]/);
    assert.match(r1.measurement.reason, /not a business result/);
    assert.equal(r1.measurement.changeRate!.toFixed(2), '-4.42');
    assert.equal(r1.cause!.branch, 'organic_traffic_decrease');
    assert.equal(r1.anomaly!.subjectType, 'site');
    assert.equal(r1.anomaly!.subjectKey, 'https://www.dospara.co.jp');
    assert.deepEqual(r1.countermeasures.map((k) => [k.actionText, k.responsibleTeam, k.status]), [
      ['Investigate the Organic traffic decrease using GSC. Identify affected queries and pages and check impressions, clicks, CTR, and position.', 'SEO team', 'Proposed'],
      // GSC_R01: only the 3-month snapshots and the chart are uploaded — no weekly query / page exports → fallback.
      ['Do not assign a definitive cause. Report the observed performance changes and recommend further investigation.', 'SEO team', 'Proposed'],
    ]);
    const inv = r1.cause!.analysis!.investigation!;
    assert.equal(inv.matched, null);
    assert.equal(inv.countermeasureKey, 'no_clear_cause');
    assert.equal(inv.confidence, 'low', 'the chart covers the weeks, nothing else does');
    assert.equal(inv.signals.position_drop, true);
    assert.deepEqual([r1.countermeasures[0]!.targetType, r1.countermeasures[0]!.targetKey], ['traffic_source', '通販（全体） オーガニックサーチ']);
    assert.match(r1.countermeasures[0]!.reason, /^Organic traffic decreased compared with the previous week\./);
    assert.equal(r1.measurement.caveats.length, 0, 'segments come from rules.yaml input_fields');
    assert.equal(r1.measurement.analysisUnit, 'Site');
    assert.match(r1.measurement.reason, /Total Sessions decreased by 3\.9% or more compared with the previous week\. total_sessions_wow_percent = -4\.42%/);
    const g = r1.cause!.analysis!.gscEvidence!;
    assert.equal(g.dateChart.available, true);
    assert.ok(g.pages.available && g.queries.available && g.devices.available && g.countries.available, 'all five GSC parts');
    // Rule checks row: basis (judged figure + reference figures) and Why NG with the proposed countermeasure.
    const m = r1.measurement;
    assert.equal(m.ruleCode, 'M1');
    assert.equal(m.dataKind, 'test');
    assert.deepEqual(m.basis.map((b) => [b.metric, b.status]), [['sessions', 'NG'], ['sessions', null], ['sessions', null]]);
    assert.equal(m.basis[0]!.current, 714424);
    assert.match(m.why!.likelyCause, /organic_sessions_wow_percent = -7\.12%.* Organic Sessions decreased while Advertising Sessions did not decrease/);
    assert.equal(m.why!.nextStepKind, 'countermeasure');
    assert.match(m.why!.nextStep, /^Investigate the Organic traffic decrease using GSC\./);
  });

  test('client GSC chart ends 09-15 → GSC is reference only; the rules.yaml countermeasure is still proposed', async () => {
    const { r1 } = (await clientRun((await freshDb()), false));
    assert.equal(r1.measurement.status, 'NG');
    assert.equal(r1.cause!.analysis!.gscEvidence!.dateChart.reference, true);
    assert.ok(r1.cause!.analysis!.missing.some((m) => /GSC Chart by Date/.test(m)), 'the missing GSC chart is listed');
    assert.equal(r1.countermeasures.length, 2);
    assert.equal(r1.cause!.analysis!.investigation!.confidence, 'insufficient_data');
    assert.equal(r1.measurement.why!.nextStepKind, 'countermeasure');
  });
});

describe('anomaly traceability', () => {
  test('anomaly → measurement → analysis result → imported data → source record → upload', async () => {
    const { db, r1 } = (await clientRun());
    const a = r1.anomaly!;
    assert.equal(a.measurementId, r1.measurement.id);
    assert.equal(r1.analysisResult!.metric, 'sessions');
    assert.deepEqual(r1.analysisResult!.current, r1.run.current);
    assert.equal(r1.rule.id, 'GA4_R01');
    // 14 days × 3 segments of GA4 sessions, each pointing at its source line.
    const ga4 = r1.sources.filter((s) => s.fileName.startsWith('Two Weeks'));
    assert.equal(ga4.length, 42);
    const first = ga4.find((s) => s.dataDate === '2026-09-10' && s.segment === '通販（全体）')!;
    assert.equal(first.metricValue, 105296);
    const raw = (await db.get('SELECT row_number, values_json FROM raw_records WHERE id = ?', first.sourceRecordId)) as any;
    assert.equal(raw.row_number, first.rowNumber);
    assert.equal(JSON.parse(raw.values_json)['日付'], '20260910');
    // Sum of the traced current-week values equals the measured current value.
    const cur = ga4.filter((s) => s.segment === '通販（全体）' && s.dataDate! >= r1.run.current.start).reduce((x, s) => x + s.metricValue!, 0);
    assert.equal(cur, a.currentValue);
  });

  test('cause and countermeasure chain', async () => {
    const { r1 } = (await clientRun());
    assert.equal(r1.cause!.anomalyId, r1.anomaly!.id);
    assert.ok(r1.countermeasures.every((k) => k.causeId === r1.cause!.id));
  });
});

describe('SEO team decisions', () => {
  test('ontology guards: approve only a confirmed cause; assign only with an approved countermeasure', async () => {
    const { db, cfg, r1 } = (await clientRun());
    const k = r1.countermeasures[0]!.id;
    await assert.rejects(() => changeState(db, ontology(), 'countermeasure', k, 'Approved', 'Tanaka'), /Confirm the cause first/);
    (await changeState(db, ontology(), 'anomaly', r1.anomaly!.id, 'Triaged', 'Tanaka'));
    await assert.rejects(() => changeState(db, ontology(), 'anomaly', r1.anomaly!.id, 'CountermeasureAssigned', 'Tanaka'), /Approve a countermeasure first/);
    let d = (await getMeasurementDetail(db, cfg, r1.measurement.id, ontology()))!;
    assert.ok(d.countermeasures[0]!.blocked!.Approved, 'blocked reason given to the UI');
    assert.ok(d.anomaly!.blocked!.CountermeasureAssigned);
    (await changeState(db, ontology(), 'cause', r1.cause!.id, 'Confirmed', 'Tanaka'));
    (await changeState(db, ontology(), 'countermeasure', k, 'Approved', 'Tanaka'));
    (await changeState(db, ontology(), 'anomaly', r1.anomaly!.id, 'CountermeasureAssigned', 'Tanaka'));
    d = (await getMeasurementDetail(db, cfg, r1.measurement.id, ontology()))!;
    assert.equal(d.anomaly!.state, 'CountermeasureAssigned');
  });

  test('SEO team modifies the cause and adjusts the countermeasure; the previous text is kept', async () => {
    const { db, cfg, r1 } = (await clientRun());
    const ont = ontology();
    (await amendText(db, ont, 'cause', r1.cause!.id, 'Organic decline after the 9/17 site release', 'Sato', 'checked deploy log'));
    (await amendText(db, ont, 'countermeasure', r1.countermeasures[0]!.id, 'Provide feedback to the SEO team with the release diff.', 'Sato'));
    const d = (await localize((await getMeasurementDetail(db, cfg, r1.measurement.id, ont))!, 'en'));
    assert.equal(d.cause!.causeText, 'Organic decline after the 9/17 site release');
    assert.equal(d.cause!.amendments.length, 1);
    assert.equal(d.cause!.amendments[0]!.oldValue, 'Organic Sessions decreased while Advertising Sessions did not decrease.');
    assert.equal(d.countermeasures[0]!.amendments[0]!.actor, 'Sato');
    assert.equal(d.cause!.editable, true);
    // Not editable once decided (ontology allowedActionRefs).
    (await changeState(db, ont, 'cause', r1.cause!.id, 'Confirmed', 'Sato'));
    await assert.rejects(() => amendText(db, ont, 'cause', r1.cause!.id, 'again', 'Sato'), TransitionError);
    const text = (await buildReportText(db, cfg, d.run.id));
    assert.match(text, /Possible cause\s*: Organic decline after the 9\/17 site release \(modified by Sato\)/);
    assert.match(text, /adjusted by\s+Sato/);
  });

  test('allowed transitions are recorded with the reviewer; illegal ones are refused', async () => {
    const { db, cfg, r1 } = (await clientRun());
    (await changeState(db, ontology(), 'cause', r1.cause!.id, 'Confirmed', 'Tanaka', 'checked GSC'));
    (await changeState(db, ontology(), 'anomaly', r1.anomaly!.id, 'Triaged', 'Tanaka'));
    (await changeState(db, ontology(), 'countermeasure', r1.countermeasures[0]!.id, 'Approved', 'Tanaka'));
    await assert.rejects(() => changeState(db, ontology(), 'anomaly', r1.anomaly!.id, 'Resolved', 'Tanaka'), TransitionError);
    await assert.rejects(() => changeState(db, ontology(), 'countermeasure', r1.countermeasures[0]!.id, 'Completed', 'Tanaka'), TransitionError);
    await assert.rejects(() => changeState(db, ontology(), 'cause', r1.cause!.id, 'Rejected', ''), TransitionError);
    const d = (await localize((await getMeasurementDetail(db, cfg, r1.measurement.id))!, 'en'));
    assert.equal(d.cause!.reviewStatus, 'Confirmed');
    assert.equal(d.events.length, 3);
    assert.equal(d.events[0]!.actor, 'Tanaka');
  });

  test('re-running the same weeks keeps runs the SEO team has acted on', async () => {
    const { db, cfg, runId, r1 } = (await clientRun());
    (await changeState(db, ontology(), 'anomaly', r1.anomaly!.id, 'Triaged', 'Tanaka'));
    const again = (await runMeasurements(db, cfg));
    assert.notEqual(again, runId);
    assert.ok((await db.get('SELECT 1 FROM measurement_runs WHERE id = ?', runId)));
    const third = (await runMeasurements(db, cfg));
    assert.equal((await db.get('SELECT 1 FROM measurement_runs WHERE id = ?', again)), undefined, 'untouched run replaced');
    assert.ok(third > again);
  });
});

describe('persistence and report', () => {
  test('data survives reopening the database (browser refresh reloads from the DB)', async () => {
    {
      const db = await freshDb();
      const { runId } = (await clientRun(db));
      await db.close();
      const reopened = await reopenDb(db);
      assert.equal((await reopened.value('SELECT COUNT(*) FROM uploads')), 10);
      assert.ok(((await reopened.value('SELECT COUNT(*) FROM imported_data')) as number) > 9000);
      assert.equal((await reopened.value('SELECT COUNT(*) FROM anomalies')), 2, 'Sessions and CVR are both NG');
      assert.ok((await reopened.get('SELECT 1 FROM measurement_runs WHERE id = ?', runId)));
    }
  });

  test('report: short business summary from the stored results — M1/M2, anomaly, evidence, cause, countermeasure', async () => {
    const { db, cfg, runId, r1 } = (await clientRun());
    const doc = (await buildReportDoc(db, cfg, runId));
    assert.deepEqual(doc.sections.map((s) => s.title), [
      'Analysis Summary', 'Measurement Summary', 'Detected Changes / Anomalies', 'Investigation', 'Cause', 'Recommended Action / Countermeasure', 'Team Feedback',
    ]);
    let text = (await buildReportText(db, cfg, runId));
    assert.match(text, /^SEO PERFORMANCE REPORT$/m);
    assert.match(text, /\[NG\] Overall result/);
    assert.match(text, /Run\s*: #\d+/);
    assert.match(text, /Measurements evaluated\s*: 2/);
    assert.equal(doc.meta!.keyFinding, 'Purchase Efficiency - CVR decreased -10.05% (-0.095 pt) week on week (0.947 → 0.852), beyond the ±0.7% threshold.');
    assert.match(text, /Key finding\s*: Purchase Efficiency - CVR decreased/);
    assert.deepEqual(doc.meta && [doc.meta.evaluated, doc.meta.ok, doc.meta.ng], [2, 0, 2]);
    // Measurement Summary: only M1 and M2, change / threshold / result.
    const table = doc.sections[1]!.blocks[0] as { t: 'table'; rows: string[][] };
    assert.deepEqual(table.rows.map((r) => [r[0], r[2], r[3], r[4]]), [
      ['Traffic Acquisition - Sessions', '-4.42%', '±3.9%', 'NG — Significant Negative Change'],
      ['Purchase Efficiency - CVR', '-10.05% (-0.095 pt)', '±0.7%', 'NG — Significant Negative Change'],
    ]);
    // Detected change: values and why it was detected (without the test-data prefix).
    assert.match(text, /Current value\s*: 714,424/);
    assert.match(text, /Previous value\s*: 747,462/);
    assert.match(text, /Why it was detected\s*: Total Sessions decreased by 3\.9% or more compared\s+with the previous week\./);
    // Investigation: GA4 figures, concise GSC findings, and an explicit "not determined" when nothing decides the cause.
    assert.match(text, /GA4 evidence — supporting metrics/);
    assert.match(text, /Cause not conclusively determined from available data\./);
    assert.match(text, /Chart by Date \(same weeks\)\s*: Clicks ↓ -30\.00%/);
    assert.match(text, /Top pages\s*: https:\/\/www\.dospara\.co\.jp\/ \(\d+\.\d%\)/);
    assert.match(text, /Devices: Mobile \(\d+\.\d%\)/, 'device names in English');
    assert.match(text, /brand share\s+65\.9%/);
    assert.doesNotMatch(text, /Source records used|Data quality|Numerical analysis|raw/i);
    // Cause and countermeasure from the stored records; a review decision shows in the next report.
    assert.match(text, /Organic Sessions decreased while Advertising Sessions did not decrease/);
    assert.match(text, /Countermeasure\s*: Investigate the Organic traffic decrease using GSC\./);
    assert.match(text, /Sessions did not increase and Purchases decreased\./, 'rule ② cause');
    assert.match(text, /Responsible team\s*: Ecommerce team/);
    assert.match(text, /Rule-match confidence\s*: High/);
    assert.match(text, /Cause confidence\s*: Not determined/);
    // Team feedback: the rules.yaml feedback per team.
    assert.match(text, /SEO team\s*: Traffic Acquisition - Sessions: Organic traffic decreased compared with the\s+previous\s+week\./);
    assert.match(text, /Ecommerce team\s*: Purchase Efficiency - CVR:/);
    (await changeState(db, ontology(), 'cause', r1.cause!.id, 'NeedsMoreEvidence', 'Sato', 'need weekly GSC'));
    text = (await buildReportText(db, cfg, runId));
    assert.match(text, /Review status\s*: NeedsMoreEvidence/);
  });

  test('report without an NG: no significant change, no evidence / cause / countermeasure sections', async () => {
    const db = (await freshDb());
    const cfg = config();
    (await importFiles(db, cfg, [{ fileName: 'flat.csv', buffer: ga4Csv({ total: [1000, 100], organic: [500, 5], advertising: [100, 1] }, { total: [1010, 101], organic: [505, 5], advertising: [100, 1] }) }], { source: 'GA4' }));
    const doc = (await buildReportDoc(db, cfg, (await runMeasurements(db, cfg))));
    assert.deepEqual(doc.sections.map((s) => s.title), ['Analysis Summary', 'Measurement Summary', 'Detected Changes / Anomalies']);
    assert.match(renderText(doc), /No significant change detected\./);
  });
});

describe('API', () => {
  test('upload → run → detail → report download', async () => {
    const db = (await freshDb());
    const app = createApp(db, testMode(), ontology());
    const form = new FormData();
    form.set('source', 'GA4');
    for (const f of clientFiles(GA4_DIR)) form.append('files', new File([f.buffer], f.fileName));
    const up = await app.request('/api/uploads', { method: 'POST', body: form });
    assert.equal(up.status, 201);
    assert.equal(((await up.json()) as any).uploads.length, 2);

    const run = await app.request('/api/measurements/run', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    const { measurements } = (await run.json()) as any;
    assert.deepEqual(measurements.map((m: any) => m.status), ['NG', 'NG']);

    const detail = (await (await app.request(`/api/measurements/${measurements[0].id}`)).json()) as any;
    assert.equal(detail.anomaly.state, 'Detected');
    const cause = (await (await app.request(`/api/causes/${detail.anomaly.id}`)).json()) as any;
    assert.equal(cause.reviewStatus, 'NotReviewed');
    const cms = (await (await app.request(`/api/countermeasures/${cause.id}`)).json()) as any;
    assert.equal(cms.length, 2, 'the rules.yaml branch countermeasure + the GSC_R01 countermeasure');

    const rep = (await (await app.request('/api/reports/generate', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).json()) as any;
    assert.match(rep.fileName, /^LOGOS_SEO_Report_\d{4}-\d{2}-\d{2}\.txt$/);
    assert.equal(rep.id, undefined, 'reports are generated views, not stored');
    assert.equal((await db.value("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'reports'")), 0);
    const dl = await app.request(`/api/reports/download?runId=${rep.runId}`);
    assert.equal(dl.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.match(dl.headers.get('content-disposition')!, /attachment; filename="LOGOS_SEO_Report_/);
    assert.match(await dl.text(), /MEASUREMENT SUMMARY/);

    // Once the SEO team has recorded a decision, the evidence upload cannot be deleted (traceability).
    const anomalyId = detail.anomaly.id;
    await app.request(`/api/anomalies/${anomalyId}/state`, { method: 'POST', body: '{"to":"Triaged","actor":"Tanaka"}', headers: { 'content-type': 'application/json' } });
    const blocked = await app.request('/api/uploads/1', { method: 'DELETE' });
    assert.equal(blocked.status, 409);
    assert.match(((await blocked.json()) as any).error, /SEO team has recorded decisions/);
  });

  test('deleting an upload without SEO team decisions removes its measurement runs and re-measures', async () => {
    const db = (await freshDb());
    const app = createApp(db, config(), ontology());
    const form = new FormData();
    for (const f of clientFiles(GA4_DIR)) form.append('files', new File([new Uint8Array(f.buffer)], f.fileName));
    const up = (await (await app.request('/api/uploads', { method: 'POST', body: form })).json()) as any;
    const twoWeeks = up.uploads.find((u: any) => u.fileName.startsWith('Two Weeks'));
    const runBefore = up.analysis.runId;
    assert.ok(runBefore);
    const res = await app.request(`/api/uploads/${twoWeeks.id}`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.deepEqual(body.deletedRuns, [runBefore]);
    assert.equal(body.rerunId, null, 'no GA4 daily data is left, so nothing is re-measured');
    assert.equal((await db.value('SELECT COUNT(*) FROM measurement_runs')), 0);
    assert.equal((await db.value('SELECT COUNT(*) FROM uploads WHERE id = ?', twoWeeks.id)), 0);
  });

  test('Japanese responses and report (X-Lang: ja)', async () => {
    const db = (await freshDb());
    const cfg = testMode();
    (await importFiles(db, cfg, clientFiles(GA4_DIR), { source: 'GA4' }));
    const app = createApp(db, cfg, ontology());
    const ja = { 'x-lang': 'ja', 'content-type': 'application/json' };
    const run = (await (await app.request('/api/measurements/run', { method: 'POST', body: '{}', headers: ja })).json()) as any;
    // rules.yaml *_ja texts.
    assert.equal(run.measurements[0].name, '① 集客 - セッション');
    assert.match(run.measurements[0].reason, /合計セッションが前週比で 3\.9% 以上減少しました。.*条件：total_sessions_wow_percent <= -3\.9。/);
    assert.match(run.measurements[1].reason, /^.*CVR が前週比（相対）で 0\.7% 以上減少しました。/);
    const detail = (await (await app.request(`/api/measurements/${run.measurements[0].id}`, { headers: ja })).json()) as any;
    assert.equal(detail.countermeasures[0].responsibleTeam, 'SEO チーム');
    assert.match(detail.cause.causeText, /^広告のセッションは減少していない一方で、オーガニックのセッションが減少しました。/);
    assert.equal(detail.cause.analysis.investigation.cause, '利用可能な GSC のデータからは単一の原因を特定できません。さらなる調査が必要です。');
    assert.match(detail.countermeasures[0].actionText, /^GSC を使ってオーガニック流入の減少を調査する。/);
    const cfgJa = (await (await app.request('/api/config', { headers: ja })).json()) as any;
    assert.equal(cfgJa.rules[0].criteria, '集客 - セッション：前週比 ±3.9% 以上（相対変化）');
    // Same data in English without the header.
    const en = (await (await app.request(`/api/measurements/${run.measurements[0].id}`)).json()) as any;
    assert.equal(en.countermeasures[0].responsibleTeam, 'SEO team');
    const rep = (await (await app.request('/api/reports/generate', { method: 'POST', body: '{}', headers: ja })).json()) as any;
    assert.match(rep.content, /SEO パフォーマンスレポート/);
    assert.match(rep.content, /分析サマリー/);
    assert.equal(rep.doc.sections[1].title, '測定サマリー');
    assert.doesNotMatch(rep.content, /\{"en":/);
  });

  test('Run measurements: uploaded data is used by default (labelled TEST DATA); includeTestData: false leaves the fake dates out', async () => {
    const db = (await freshDb());
    const cfg = config();
    assert.equal(cfg.dataPolicy.evaluateSyntheticData, true, 'rules.yaml default: uploaded data flows to Data and Measurements');
    (await importFiles(db, cfg, clientFiles(GA4_DIR), { source: 'GA4' }));
    const app = createApp(db, cfg, ontology());
    const post = async (body: object) =>
      (await (await app.request('/api/measurements/run', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })).json()) as any;
    const periods = (await (await app.request('/api/periods')).json()) as any;
    assert.equal(periods.GA4.periods[0].current.end, '2026-09-23', 'the uploaded two weeks');
    assert.equal(periods.GA4.synthetic.length, 8);
    const run = await post({});
    assert.deepEqual(run.measurements.map((m: any) => m.status), ['NG', 'NG'], 'CVR has a confirmed relative threshold in rules.yaml');
    assert.match(run.measurements[0].result, /^\[TEST DATA\]/);
    const realPeriods = (await (await app.request('/api/periods?includeTestData=0')).json()) as any;
    assert.deepEqual(realPeriods.GA4.periods, []);
    const real = await post({ includeTestData: false });
    assert.deepEqual(real.measurements.map((m: any) => m.status), ['NOT_EVALUABLE', 'NOT_EVALUABLE']);
    assert.equal(cfg.dataPolicy.evaluateSyntheticData, true, 'the option applies to that run only');
  });

  test('bad input is rejected', async () => {
    const app = createApp((await freshDb()), config(), ontology());
    const form = new FormData();
    form.set('source', 'XYZ');
    assert.equal((await app.request('/api/uploads', { method: 'POST', body: form })).status, 400);
    assert.equal((await app.request('/api/anomalies/999/state', { method: 'POST', body: '{"to":"Triaged","actor":"x"}', headers: { 'content-type': 'application/json' } })).status, 400);
    assert.equal((await app.request('/api/reports/generate', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status, 400);
  });
});
