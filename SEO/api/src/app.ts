import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Source } from '@seo/shared';
import { configSummary, type AppConfig } from './config.ts';
import { comparison, dataFilters, listData, rawRecords, topRows, trends, type Dimension } from './data.ts';
import type { DB } from './db.ts';
import { deleteUpload, getUpload, importFiles, listUploads } from './import/index.ts';
import { latestGa4Date, runMeasurements } from './measure/engine.ts';
import {
  TransitionError,
  changeState,
  getAnomaly,
  getCause,
  getMeasurementDetail,
  getRun,
  latestRunId,
  listAnalysisResults,
  listAnomalies,
  listCountermeasures,
  listMeasurements,
  listRuns,
} from './measure/read.ts';
import { generateReport, getReport } from './report.ts';
import { langOf, localize } from './i18n.ts';
import { summarize, type Ontology } from './ontology.ts';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function createApp(db: DB, cfg: AppConfig, ont: Ontology) {
  const app = new Hono().basePath('/api');
  const int = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
  // Response language: X-Lang header (sent by the dashboard) or ?lang=; generated text is stored bilingual.
  const lang = (c: Context) => langOf(c.req.header('x-lang') ?? c.req.query('lang'));
  const send = (c: Context, data: unknown, status: ContentfulStatusCode = 200) => c.json(localize(data, lang(c)) as object, status);

  app.onError((err, c) => {
    if (err instanceof TransitionError) return send(c, { error: err.message }, 400);
    console.error(err);
    return send(c, { error: err.message || 'Internal error' }, 500);
  });

  app.get('/health', (c) => send(c, { ok: true }));
  app.get('/config', (c) => send(c, configSummary(cfg)));
  /** The LOGOS SEO ontology the system runs on: objects, lifecycles, vocabularies, relations, actions. */
  app.get('/ontology', (c) => send(c, summarize(ont)));

  // ---------- Uploads (Receive / Check and Standardize) ----------

  app.post('/uploads', async (c) => {
    const body = await c.req.parseBody({ all: true });
    const source = String(body.source ?? '') as Source;
    if (source !== 'GA4' && source !== 'GSC') return send(c, { error: 'Select a source: GA4 or GSC.' }, 400);
    const raw = body['files'] ?? body['file'];
    const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in f);
    if (!list.length) return send(c, { error: 'Choose at least one file.' }, 400);
    const start = String(body.periodStart ?? '');
    const end = String(body.periodEnd ?? '');
    if ((start || end) && !(ISO_DATE.test(start) && ISO_DATE.test(end) && start <= end)) return send(c, { error: 'Period must be two dates (start ≤ end).' }, 400);
    const files = await Promise.all(list.map(async (f) => ({ fileName: f.name, buffer: Buffer.from(await f.arrayBuffer()) })));
    const uploads = importFiles(db, cfg, files, { source, period: start ? { start, end } : null });
    return send(c, { uploads }, 201);
  });

  app.get('/uploads', (c) => send(c, listUploads(db)));
  app.get('/uploads/:id', (c) => {
    const u = getUpload(db, Number(c.req.param('id')));
    return u ? send(c, u) : send(c, { error: 'Upload not found' }, 404);
  });
  /** Source records line by line, as read from the file. */
  app.get('/uploads/:id/data', (c) => send(c, rawRecords(db, Number(c.req.param('id')), int(c.req.query('limit')) ?? 200, int(c.req.query('offset')) ?? 0)));
  app.delete('/uploads/:id', (c) => {
    const id = Number(c.req.param('id'));
    const used = db.prepare('SELECT COUNT(*) FROM measurement_sources ms JOIN imported_data d ON d.id = ms.imported_data_id WHERE d.upload_id = ?').pluck().get(id) as number;
    if (used) return send(c, { error: 'This upload is evidence for existing measurements and cannot be deleted.' }, 409);
    return deleteUpload(db, id) ? send(c, { ok: true }) : send(c, { error: 'Upload not found' }, 404);
  });

  // ---------- Data (SEO performance analysis) ----------

  app.get('/data', (c) => {
    const q = c.req.query();
    return send(c, 
      listData(db, {
        source: q.source,
        uploadId: int(q.uploadId),
        segment: q.segment,
        page: q.page,
        query: q.query,
        metric: q.metric,
        from: q.from,
        to: q.to,
        includeInvalid: q.includeInvalid === 'true',
        limit: int(q.limit),
        offset: int(q.offset),
      }),
    );
  });
  app.get('/data/filters', (c) => send(c, dataFilters(db)));
  app.get('/data/summary', (c) => {
    const end = c.req.query('currentEnd');
    if (end && !ISO_DATE.test(end)) return send(c, { error: 'currentEnd must be yyyy-mm-dd' }, 400);
    return send(c, comparison(db, cfg, end));
  });
  app.get('/data/trends', (c) => {
    const source = (c.req.query('source') ?? 'GA4') as Source;
    const metric = c.req.query('metric') ?? 'sessions';
    return send(c, trends(db, cfg, source, metric, c.req.query('segment') || undefined, { start: c.req.query('from'), end: c.req.query('to') }));
  });
  app.get('/data/top/:dimension', (c) => {
    const dim = c.req.param('dimension') as Dimension;
    if (!['query', 'page', 'device', 'country', 'appearance'].includes(dim)) return send(c, { error: 'Unknown dimension' }, 400);
    return send(c, topRows(db, cfg, dim, { limit: int(c.req.query('limit')), search: c.req.query('search') || undefined }));
  });

  // ---------- Measurements ----------

  app.get('/measurement-runs', (c) => send(c, listRuns(db)));
  app.get('/measurements/defaults', (c) => send(c, { latestGa4Date: latestGa4Date(db, cfg) }));
  app.post('/measurements/run', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { currentEnd?: string };
    if (body.currentEnd && !ISO_DATE.test(body.currentEnd)) return send(c, { error: 'currentEnd must be yyyy-mm-dd' }, 400);
    const runId = runMeasurements(db, cfg, { currentEnd: body.currentEnd });
    return send(c, { run: getRun(db, runId), measurements: listMeasurements(db, cfg, runId) }, 201);
  });
  app.get('/measurements', (c) => {
    const runId = int(c.req.query('runId')) ?? latestRunId(db);
    if (!runId) return send(c, { run: null, measurements: [], analysisResults: [] });
    return send(c, { run: getRun(db, runId), measurements: listMeasurements(db, cfg, runId), analysisResults: listAnalysisResults(db, runId) });
  });
  app.get('/measurements/:id', (c) => {
    const d = getMeasurementDetail(db, cfg, Number(c.req.param('id')));
    return d ? send(c, d) : send(c, { error: 'Measurement not found' }, 404);
  });

  // ---------- Anomalies, causes, countermeasures ----------

  app.get('/anomalies', (c) => send(c, listAnomalies(db, int(c.req.query('runId')))));
  app.get('/anomalies/:id', (c) => {
    const a = getAnomaly(db, Number(c.req.param('id')));
    return a ? send(c, a) : send(c, { error: 'Anomaly not found' }, 404);
  });
  app.get('/causes/:anomalyId', (c) => {
    const cause = getCause(db, Number(c.req.param('anomalyId')));
    return cause ? send(c, cause) : send(c, { error: 'No cause hypothesis for this anomaly' }, 404);
  });
  app.get('/countermeasures/:causeId', (c) => send(c, listCountermeasures(db, Number(c.req.param('causeId')))));

  // SEO team decisions. The system never calls these itself.
  const decide = (entity: 'anomaly' | 'cause' | 'countermeasure') => async (c: any) => {
    const body = (await c.req.json().catch(() => ({}))) as { to?: string; actor?: string; note?: string };
    changeState(db, ont, entity, Number(c.req.param('id')), String(body.to ?? ''), String(body.actor ?? ''), String(body.note ?? ''));
    return send(c, { ok: true });
  };
  app.post('/anomalies/:id/state', decide('anomaly'));
  app.post('/causes/:id/review', decide('cause'));
  app.post('/countermeasures/:id/status', decide('countermeasure'));

  // ---------- Reports (generated from the Measurements page) ----------

  app.post('/reports/generate', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { runId?: number };
    const runId = body.runId ?? latestRunId(db);
    if (!runId || !getRun(db, runId)) return send(c, { error: 'Run the measurements before generating a report.' }, 400);
    return send(c, generateReport(db, cfg, runId, lang(c)), 201);
  });
  app.get('/reports/:id', (c) => {
    const r = getReport(db, Number(c.req.param('id')));
    return r ? send(c, r) : send(c, { error: 'Report not found' }, 404);
  });
  app.get('/reports/:id/download', (c) => {
    const r = getReport(db, Number(c.req.param('id')));
    if (!r) return send(c, { error: 'Report not found' }, 404);
    return new Response(r.content, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${r.fileName}"` },
    });
  });

  return app;
}
