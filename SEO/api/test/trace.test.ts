// Traceability, human decisions, persistence, report and API.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { createApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { importFiles } from '../src/import/index.ts';
import { localize } from '../src/i18n.ts';
import { runMeasurements } from '../src/measure/engine.ts';
import { TransitionError, changeState, getMeasurementDetail, listMeasurements } from '../src/measure/read.ts';
import { buildReportText } from '../src/report.ts';
import { GA4_DIR, GSC_DIR, clientFiles, config, freshDb, ontology } from './helpers.ts';

function clientRun(db = freshDb()) {
  const cfg = config();
  importFiles(db, cfg, clientFiles(GA4_DIR), { source: 'GA4' });
  importFiles(db, cfg, clientFiles(GSC_DIR), { source: 'GSC' });
  const runId = runMeasurements(db, cfg);
  const r1 = localize(getMeasurementDetail(db, cfg, listMeasurements(db, cfg, runId).find((m) => m.ruleId === 'GA4-R1')!.id)!, 'en');
  return { db, cfg, runId, r1 };
}

describe('client dummy data (two GA4 weeks)', () => {
  test('rule ① NG: −4.42%, organic is the cause, SEO team feedback proposed', () => {
    const { r1 } = clientRun();
    assert.equal(r1.measurement.status, 'NG');
    assert.equal(r1.measurement.changeRate!.toFixed(2), '-4.42');
    assert.equal(r1.cause!.branch, 'organic');
    assert.deepEqual(r1.countermeasures.map((k) => [k.actionText, k.status]), [['Provide feedback to the SEO team.', 'Proposed']]);
  });
});

describe('anomaly traceability', () => {
  test('anomaly → measurement → analysis result → imported data → source record → upload', () => {
    const { db, r1 } = clientRun();
    const a = r1.anomaly!;
    assert.equal(a.measurementId, r1.measurement.id);
    assert.equal(r1.analysisResult!.metric, 'sessions');
    assert.deepEqual(r1.analysisResult!.current, r1.run.current);
    assert.equal(r1.rule.id, 'GA4-R1');
    // 14 days × 3 segments of GA4 sessions, each pointing at its source line.
    const ga4 = r1.sources.filter((s) => s.fileName.startsWith('Two Weeks'));
    assert.equal(ga4.length, 42);
    const first = ga4.find((s) => s.dataDate === '2026-09-10' && s.segment === '通販（全体）')!;
    assert.equal(first.metricValue, 105296);
    const raw = db.prepare('SELECT row_number, values_json FROM raw_records WHERE id = ?').get(first.sourceRecordId) as any;
    assert.equal(raw.row_number, first.rowNumber);
    assert.equal(JSON.parse(raw.values_json)['日付'], '20260910');
    // Sum of the traced current-week values equals the measured current value.
    const cur = ga4.filter((s) => s.segment === '通販（全体）' && s.dataDate! >= r1.run.current.start).reduce((x, s) => x + s.metricValue!, 0);
    assert.equal(cur, a.currentValue);
  });

  test('cause and countermeasure chain', () => {
    const { r1 } = clientRun();
    assert.equal(r1.cause!.anomalyId, r1.anomaly!.id);
    assert.ok(r1.countermeasures.every((k) => k.causeId === r1.cause!.id));
  });
});

describe('SEO team decisions', () => {
  test('allowed transitions are recorded with the reviewer; illegal ones are refused', () => {
    const { db, cfg, r1 } = clientRun();
    changeState(db, ontology(), 'cause', r1.cause!.id, 'Confirmed', 'Tanaka', 'checked GSC');
    changeState(db, ontology(), 'anomaly', r1.anomaly!.id, 'Triaged', 'Tanaka');
    changeState(db, ontology(), 'countermeasure', r1.countermeasures[0]!.id, 'Approved', 'Tanaka');
    assert.throws(() => changeState(db, ontology(), 'anomaly', r1.anomaly!.id, 'Resolved', 'Tanaka'), TransitionError);
    assert.throws(() => changeState(db, ontology(), 'countermeasure', r1.countermeasures[0]!.id, 'Completed', 'Tanaka'), TransitionError);
    assert.throws(() => changeState(db, ontology(), 'cause', r1.cause!.id, 'Rejected', ''), TransitionError);
    const d = localize(getMeasurementDetail(db, cfg, r1.measurement.id)!, 'en');
    assert.equal(d.cause!.reviewStatus, 'Confirmed');
    assert.equal(d.events.length, 3);
    assert.equal(d.events[0]!.actor, 'Tanaka');
  });

  test('re-running the same weeks keeps runs the SEO team has acted on', () => {
    const { db, cfg, runId, r1 } = clientRun();
    changeState(db, ontology(), 'anomaly', r1.anomaly!.id, 'Triaged', 'Tanaka');
    const again = runMeasurements(db, cfg);
    assert.notEqual(again, runId);
    assert.ok(db.prepare('SELECT 1 FROM measurement_runs WHERE id = ?').get(runId));
    const third = runMeasurements(db, cfg);
    assert.equal(db.prepare('SELECT 1 FROM measurement_runs WHERE id = ?').get(again), undefined, 'untouched run replaced');
    assert.ok(third > again);
  });
});

describe('persistence and report', () => {
  test('data survives reopening the database (browser refresh reloads from the DB)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'seo-'));
    try {
      const path = join(dir, 'seo.db');
      const { runId } = clientRun(openDb(path));
      const reopened = openDb(path);
      assert.equal(reopened.prepare('SELECT COUNT(*) FROM uploads').pluck().get(), 9);
      assert.ok((reopened.prepare('SELECT COUNT(*) FROM imported_data').pluck().get() as number) > 9000);
      assert.equal(reopened.prepare('SELECT COUNT(*) FROM anomalies').pluck().get(), 1);
      assert.ok(reopened.prepare('SELECT 1 FROM measurement_runs WHERE id = ?').get(runId));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('report is generated from database records', () => {
    const { db, cfg, runId, r1 } = clientRun();
    let text = buildReportText(db, cfg, runId);
    for (const section of ['REPORT INFORMATION', 'ANALYSIS PERIOD', 'DATA SOURCE', 'OVERALL SEO SUMMARY', 'IMPORTANT METRIC CHANGES', 'MEASUREMENT RESULTS', 'SIGNIFICANT SEO ANOMALIES', 'NUMERICAL ANALYSIS COMMENTS', 'POSSIBLE CAUSES', 'SUPPORTING EVIDENCE', 'COUNTERMEASURE SUGGESTIONS', 'SEO TEAM DECISION', 'OPEN MONITORING ITEMS', 'DATA QUALITY WARNINGS'])
      assert.ok(text.includes(section), section);
    assert.match(text, /\[NG\] ① Traffic Acquisition — Sessions/);
    assert.match(text, /\[NOT_EVALUABLE\] ② Purchase Efficiency — CVR/);
    assert.match(text, /747,462 → 714,424/);
    // A decision stored in the DB appears in the next report.
    changeState(db, ontology(), 'cause', r1.cause!.id, 'NeedsMoreEvidence', 'Sato', 'need weekly GSC');
    text = buildReportText(db, cfg, runId);
    assert.match(text, /Sato: cause #\d+ NotReviewed → NeedsMoreEvidence — need weekly GSC/);
  });
});

describe('API', () => {
  test('upload → run → detail → report download', async () => {
    const db = freshDb();
    const app = createApp(db, config(), ontology());
    const form = new FormData();
    form.set('source', 'GA4');
    for (const f of clientFiles(GA4_DIR)) form.append('files', new File([f.buffer], f.fileName));
    const up = await app.request('/api/uploads', { method: 'POST', body: form });
    assert.equal(up.status, 201);
    assert.equal(((await up.json()) as any).uploads.length, 2);

    const run = await app.request('/api/measurements/run', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    const { measurements } = (await run.json()) as any;
    assert.deepEqual(measurements.map((m: any) => m.status), ['NG', 'NOT_EVALUABLE']);

    const detail = (await (await app.request(`/api/measurements/${measurements[0].id}`)).json()) as any;
    assert.equal(detail.anomaly.state, 'Detected');
    const cause = (await (await app.request(`/api/causes/${detail.anomaly.id}`)).json()) as any;
    assert.equal(cause.reviewStatus, 'NotReviewed');
    const cms = (await (await app.request(`/api/countermeasures/${cause.id}`)).json()) as any;
    assert.equal(cms[0].status, 'Proposed');

    const rep = (await (await app.request('/api/reports/generate', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).json()) as any;
    assert.match(rep.fileName, /^LOGOS_SEO_Report_\d{4}-\d{2}-\d{2}\.txt$/);
    const dl = await app.request(`/api/reports/${rep.id}/download`);
    assert.equal(dl.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.match(dl.headers.get('content-disposition')!, /attachment; filename="LOGOS_SEO_Report_/);
    assert.equal(await dl.text(), rep.content);

    // Uploads used as evidence cannot be deleted (traceability).
    const del = await app.request('/api/uploads/1', { method: 'DELETE' });
    assert.equal(del.status, 409);
  });

  test('Japanese responses and report (X-Lang: ja)', async () => {
    const db = freshDb();
    const cfg = config();
    importFiles(db, cfg, clientFiles(GA4_DIR), { source: 'GA4' });
    const app = createApp(db, cfg, ontology());
    const ja = { 'x-lang': 'ja', 'content-type': 'application/json' };
    const run = (await (await app.request('/api/measurements/run', { method: 'POST', body: '{}', headers: ja })).json()) as any;
    assert.equal(run.measurements[0].name, '① 集客 — セッション');
    assert.match(run.measurements[0].reason, /前週比 ±3\.9% の基準に該当/);
    assert.match(run.measurements[1].reason, /単位.*クライアント未確認/);
    const detail = (await (await app.request(`/api/measurements/${run.measurements[0].id}`, { headers: ja })).json()) as any;
    assert.match(detail.cause.causeText, /全体セッションが前週比 -4\.42% 減少/);
    assert.equal(detail.countermeasures[0].actionText, 'SEO チームへフィードバックする。');
    const cfgJa = (await (await app.request('/api/config', { headers: ja })).json()) as any;
    assert.equal(cfgJa.rules[0].criteria, '集客 — セッション：前週比 ±3.9% 以上');
    // Same data in English without the header.
    const en = (await (await app.request(`/api/measurements/${run.measurements[0].id}`)).json()) as any;
    assert.equal(en.countermeasures[0].actionText, 'Provide feedback to the SEO team.');
    const rep = (await (await app.request('/api/reports/generate', { method: 'POST', body: '{}', headers: ja })).json()) as any;
    assert.match(rep.content, /週次モニタリングレポート/);
    assert.match(rep.content, /可能性のある原因（仮説 — 未確定）/);
    assert.doesNotMatch(rep.content, /\{"en":/);
  });

  test('bad input is rejected', async () => {
    const app = createApp(freshDb(), config(), ontology());
    const form = new FormData();
    form.set('source', 'XYZ');
    assert.equal((await app.request('/api/uploads', { method: 'POST', body: form })).status, 400);
    assert.equal((await app.request('/api/anomalies/999/state', { method: 'POST', body: '{"to":"Triaged","actor":"x"}', headers: { 'content-type': 'application/json' } })).status, 400);
    assert.equal((await app.request('/api/reports/generate', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status, 400);
  });
});
