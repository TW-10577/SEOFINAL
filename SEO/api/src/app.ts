import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Source } from '@seo/shared';
import { configSummary, type AppConfig } from './config.ts';
import { comparison, dataFilters, ga4Overview, listData, rawRecords, topRows, trends, type Dimension } from './data.ts';
import type { DB } from './db.ts';
import { deleteUpload, deleteUploadWithRuns, getUpload, importUploads, listUploads } from './import/index.ts';
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
  runDataUsed,
  amendText,
  monitoring,
} from './measure/read.ts';
import { generateReport } from './report.ts';
import { defaultCurrentEnd, detectAllPeriods, testDataParam, uploadIdsParam, withScope, withTestData } from './periods.ts';
import { enc, langOf, localize, tx } from './i18n.ts';
import { analyzeUploads } from './analysis.ts';
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
    // Optional: the source is detected from each file's contents; a caller may state the expected one.
    const given = String(body.source ?? '');
    if (given && given !== 'GA4' && given !== 'GSC') return send(c, { error: 'source must be GA4 or GSC when given.' }, 400);
    const source = (given || null) as Source | null;
    const raw = body['files'] ?? body['file'];
    const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in f);
    if (!list.length) return send(c, { error: 'Choose at least one file.' }, 400);
    const start = String(body.periodStart ?? '');
    const end = String(body.periodEnd ?? '');
    if ((start || end) && !(ISO_DATE.test(start) && ISO_DATE.test(end) && start <= end)) return send(c, { error: 'Period must be two dates (start ≤ end).' }, 400);
    const files = await Promise.all(list.map(async (f) => ({ fileName: f.name, buffer: Buffer.from(await f.arrayBuffer()) })));
    const uploads = await importUploads(db, cfg, files, { source, period: start ? { start, end } : null });
    // Upload → detect source → apply that source's rules → analyse → result.
    return send(c, { uploads, analysis: await analyzeUploads(db, cfg, uploads) }, 201);
  });

  /** Source: Unknown → the SEO team selects GA4 or GSC; the stored file is analysed again with that source. */
  app.post('/uploads/:id/source', async (c) => {
    const id = Number(c.req.param('id'));
    const body = (await c.req.json().catch(() => ({}))) as { source?: string };
    if (body.source !== 'GA4' && body.source !== 'GSC') return send(c, { error: 'source must be GA4 or GSC.' }, 400);
    const upload = await getUpload(db, id);
    if (!upload) return send(c, { error: 'Upload not found' }, 404);
    if (upload.importStatus === 'imported') return send(c, { error: 'This upload was already imported with its detected source.' }, 409);
    const content = await db.value<Buffer>('SELECT content FROM upload_files WHERE upload_id = ?', id);
    if (!content) return send(c, { error: 'The original file is not stored; upload it again.' }, 409);
    await deleteUpload(db, id);
    const uploads = await importUploads(db, cfg, [{ fileName: upload.fileName, buffer: content }], { source: body.source });
    return send(c, { uploads, analysis: await analyzeUploads(db, cfg, uploads) }, 201);
  });

  app.get('/uploads', async (c) => send(c, await listUploads(db)));
  app.get('/uploads/:id', async (c) => {
    const u = await getUpload(db, Number(c.req.param('id')));
    return u ? send(c, u) : send(c, { error: 'Upload not found' }, 404);
  });
  /** Source records line by line, as read from the file. */
  app.get('/uploads/:id/data', async (c) => send(c, await rawRecords(db, Number(c.req.param('id')), int(c.req.query('limit')) ?? 200, int(c.req.query('offset')) ?? 0)));
  /**
   * Deletes an upload. Measurement runs that used it as evidence are deleted with it and the latest
   * week is measured again from the remaining data — unless the SEO team already recorded decisions
   * on those runs: their decisions keep their evidence, so the upload stays.
   */
  app.delete('/uploads/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!(await getUpload(db, id))) return send(c, { error: 'Upload not found' }, 404);
    const result = await deleteUploadWithRuns(db, id);
    if ('blockedBy' in result)
      return send(c, { error: enc(tx(
        `This upload is evidence for measurement run #${result.blockedBy.join(', #')}, where the SEO team has recorded decisions, so it cannot be deleted.`,
        `このアップロードは測定実行 #${result.blockedBy.join('、#')} の根拠で、SEO チームの判断が記録されているため削除できません。`,
      )) }, 409);
    const rerun = result.deletedRuns.length && (await latestGa4Date(db, cfg)) ? await runMeasurements(db, cfg) : null;
    return send(c, { ok: true, deletedRuns: result.deletedRuns, rerunId: rerun });
  });

  // ---------- Data (SEO performance analysis) ----------

  /** The config for one request: test data on/off and the active import context (?uploadIds=1,2). */
  const reqCfg = (c: any) => withScope(db, withTestData(cfg, testDataParam(c.req.query('includeTestData'))), uploadIdsParam(c.req.query('uploadIds')));

  app.get('/data', async (c) => {
    const q = c.req.query();
    return send(c, 
      await listData(db, {
        source: q.source,
        uploadId: int(q.uploadId),
        uploadIds: uploadIdsParam(q.uploadIds),
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
  app.get('/data/filters', async (c) => send(c, await dataFilters(db, await reqCfg(c))));
  app.get('/data/ga4-overview', async (c) => send(c, await ga4Overview(db, await reqCfg(c))));
  /** Valid week-on-week periods per source, detected from the uploaded data (newest first). */
  app.get('/periods', async (c) => send(c, await detectAllPeriods(db, await reqCfg(c))));
  app.get('/data/summary', async (c) => {
    const ga4End = c.req.query('ga4End') || c.req.query('currentEnd') || undefined;
    const gscEnd = c.req.query('gscEnd') || c.req.query('currentEnd') || undefined;
    if ((ga4End && !ISO_DATE.test(ga4End)) || (gscEnd && !ISO_DATE.test(gscEnd))) return send(c, { error: 'Period end must be yyyy-mm-dd' }, 400);
    return send(c, await comparison(db, await reqCfg(c), { ga4End, gscEnd }));
  });
  app.get('/data/trends', async (c) => {
    const source = (c.req.query('source') ?? 'GA4') as Source;
    const metric = c.req.query('metric') ?? 'sessions';
    return send(c, await trends(db, await reqCfg(c), source, metric, c.req.query('segment') || undefined, { start: c.req.query('from'), end: c.req.query('to') }));
  });
  app.get('/data/top/:dimension', async (c) => {
    const dim = c.req.param('dimension') as Dimension;
    if (!['query', 'page', 'device', 'country', 'appearance'].includes(dim)) return send(c, { error: 'Unknown dimension' }, 400);
    return send(c, await topRows(db, await reqCfg(c), dim, { limit: int(c.req.query('limit')), search: c.req.query('search') || undefined, uploadId: int(c.req.query('uploadId')) }));
  });

  // ---------- Measurements ----------

  app.get('/measurement-runs', async (c) => send(c, await listRuns(db)));
  app.get('/measurements/defaults', async (c) => send(c, { latestGa4Date: await defaultCurrentEnd(db, cfg, 'GA4') }));
  app.post('/measurements/run', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { currentEnd?: string; includeTestData?: boolean; uploadIds?: number[] };
    if (body.currentEnd && !ISO_DATE.test(body.currentEnd)) return send(c, { error: 'currentEnd must be yyyy-mm-dd' }, 400);
    if (body.uploadIds !== undefined && !(Array.isArray(body.uploadIds) && body.uploadIds.every((n) => Number.isInteger(n) && n > 0)))
      return send(c, { error: 'uploadIds must be a list of upload ids' }, 400);
    // includeTestData: include / leave out the dates the export marks as not real for this run (default: rules.yaml).
    // uploadIds: the active import context — the run uses only these uploads (per source).
    const runCfg = await withScope(db, withTestData(cfg, typeof body.includeTestData === 'boolean' ? body.includeTestData : undefined), body.uploadIds);
    const runId = await runMeasurements(db, runCfg, { currentEnd: body.currentEnd });
    return send(c, { run: await getRun(db, runId), measurements: await listMeasurements(db, cfg, runId) }, 201);
  });
  app.get('/measurements', async (c) => {
    const runId = int(c.req.query('runId')) ?? (await latestRunId(db));
    if (!runId) return send(c, { run: null, measurements: [], analysisResults: [], dataUsed: [], monitoring: null });
    return send(c, {
      run: await getRun(db, runId),
      measurements: await listMeasurements(db, cfg, runId),
      analysisResults: await listAnalysisResults(db, runId),
      dataUsed: await runDataUsed(db, runId),
      monitoring: await monitoring(db, runId),
    });
  });
  app.get('/measurements/:id', async (c) => {
    const d = await getMeasurementDetail(db, cfg, Number(c.req.param('id')), ont);
    return d ? send(c, d) : send(c, { error: 'Measurement not found' }, 404);
  });

  // ---------- Anomalies, causes, countermeasures ----------

  app.get('/anomalies', async (c) => send(c, await listAnomalies(db, int(c.req.query('runId')))));
  app.get('/anomalies/:id', async (c) => {
    const a = await getAnomaly(db, Number(c.req.param('id')));
    return a ? send(c, a) : send(c, { error: 'Anomaly not found' }, 404);
  });
  app.get('/causes/:anomalyId', async (c) => {
    const cause = await getCause(db, Number(c.req.param('anomalyId')), ont);
    return cause ? send(c, cause) : send(c, { error: 'No cause hypothesis for this anomaly' }, 404);
  });
  app.get('/countermeasures/:causeId', async (c) => send(c, await listCountermeasures(db, Number(c.req.param('causeId')), ont)));

  // SEO team decisions. The system never calls these itself.
  const decide = (entity: 'anomaly' | 'cause' | 'countermeasure') => async (c: any) => {
    const body = (await c.req.json().catch(() => ({}))) as { to?: string; actor?: string; note?: string };
    await changeState(db, ont, entity, Number(c.req.param('id')), String(body.to ?? ''), String(body.actor ?? ''), String(body.note ?? ''));
    return send(c, { ok: true });
  };
  app.post('/anomalies/:id/state', decide('anomaly'));
  app.post('/causes/:id/review', decide('cause'));
  app.post('/countermeasures/:id/status', decide('countermeasure'));
  // SEO team edits (modify the cause / adjust the countermeasure); the previous text is kept.
  const amend = (entity: 'cause' | 'countermeasure') => async (c: any) => {
    const body = (await c.req.json().catch(() => ({}))) as { text?: string; actor?: string; note?: string };
    await amendText(db, ont, entity, Number(c.req.param('id')), String(body.text ?? ''), String(body.actor ?? ''), String(body.note ?? ''));
    return send(c, { ok: true });
  };
  app.post('/causes/:id/amend', amend('cause'));
  app.post('/countermeasures/:id/adjust', amend('countermeasure'));

  // ---------- Reports (generated from the Measurements page) ----------

  app.post('/reports/generate', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { runId?: number };
    const runId = body.runId ?? (await latestRunId(db));
    if (!runId || !(await getRun(db, runId))) return send(c, { error: 'Run the measurements before generating a report.' }, 400);
    return send(c, await generateReport(db, cfg, runId, lang(c)));
  });
  // Same text on download: the page saves the previewed text itself; this route rebuilds it for direct links.
  app.get('/reports/download', async (c) => {
    const runId = int(c.req.query('runId')) ?? (await latestRunId(db));
    if (!runId || !(await getRun(db, runId))) return send(c, { error: 'Run the measurements before generating a report.' }, 400);
    const r = await generateReport(db, cfg, runId, lang(c));
    return new Response(r.content, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${r.fileName}"` },
    });
  });

  return app;
}
