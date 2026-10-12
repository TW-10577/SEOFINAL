import type { Issue, Period, Source, Upload, UploadDetail } from '@seo/shared';
import type { AppConfig } from '../config.ts';
import { SCHEMA_VERSION, nowIso, parseJson, type DB } from '../db.ts';
import { dec, enc, tx, type LText } from '../i18n.ts';
import { detectSource, type SourceDetection } from './detect.ts';
import { parseGa4 } from './ga4.ts';
import { FORMAT_LABEL, ProcessingFailed, UnsupportedFormat, extract, extractSync, type Extraction } from './formats.ts';
import { parseGsc } from './gsc.ts';
import type { ParsedTable } from './types.ts';

export interface IncomingFile {
  fileName: string;
  buffer: Buffer;
  /** Pre-extracted tables (or the extraction failure) from importUploads. */
  extraction?: Extraction | UnsupportedFormat | ProcessingFailed;
}

export interface ImportOptions {
  /** Expected source. Omitted (the dashboard): detected per file from its contents. */
  source?: Source | null;
  /** Period for files whose rows carry no date (e.g. GSC 3-month totals). */
  period?: Period | null;
}

/** imported: SEO data stored · unsupported: the file format cannot be read · failed: readable, but no usable SEO data. */
type Outcome = 'imported' | 'unsupported' | 'failed';

interface ParsedFile {
  file: IncomingFile;
  /** Detected format, e.g. csv, xlsx, pdf; or what an unsupported file was recognised as. */
  format: string;
  tables: ParsedTable[];
  errors: Issue[];
  outcome: Outcome;
  /** GA4 or GSC as detected from the contents; null when nothing was recognised. */
  source: Source | null;
  detection: SourceDetection;
}

/**
 * Imports one batch from the upload API: detects each file's format from its contents,
 * extracts its tables (PDF and Word need async libraries), then runs importFiles.
 */
export async function importUploads(db: DB, cfg: AppConfig, files: IncomingFile[], opts: ImportOptions): Promise<UploadDetail[]> {
  const prepared = await Promise.all(
    files.map(async (f) => {
      if (f.buffer.length === 0) return f;
      try {
        return { ...f, extraction: await extract(f.fileName, f.buffer) };
      } catch (e) {
        return { ...f, extraction: e instanceof UnsupportedFormat || e instanceof ProcessingFailed ? e : new ProcessingFailed((e as Error).message, (e as Error).message) };
      }
    }),
  );
  return importFiles(db, cfg, prepared, opts);
}

/**
 * Imports one batch. Each file becomes one upload row — rejected files too, so the
 * Data Import page can show why. Undated GSC tabs take their period from, in order:
 * the period entered on upload, or a GSC daily chart in the same batch.
 */
export async function importFiles(db: DB, cfg: AppConfig, files: IncomingFile[], opts: ImportOptions): Promise<UploadDetail[]> {
  const parsed = files.map((f) => parseFile(f, opts.source ?? null));

  const batchDaily = parsed.flatMap((p) => p.tables).find((t) => t.structure === 'gsc-date' && t.period);
  for (const p of parsed)
    for (const t of p.tables) {
      if (!t.undated || t.period) continue;
      if (opts.period) {
        t.period = opts.period;
        t.periodNote = bi('Entered on upload', 'アップロード時に入力');
      } else if (t.source === 'GSC' && batchDaily?.period && t.structure !== 'gsc-filter') {
        t.period = batchDaily.period;
        t.periodNote = bi('Taken from the GSC daily chart uploaded in the same batch', '同時にアップロードした GSC 日次チャートから取得');
      } else if (t.structure !== 'gsc-filter') {
        t.issues.push({ severity: 'warning', code: 'no-period', message: bi('Rows have no date and no period was supplied — the data is stored but its period is unknown.', '行に日付がなく期間も指定されていません — データは保存しましたが期間は不明です。') });
      }
      if (t.source === 'GSC' && t.structure !== 'gsc-filter')
        t.issues.push({ severity: 'warning', code: 'no-wow', message: bi('This export is a single total for the whole period: it has no time dimension, so it cannot be compared week on week.', 'このエクスポートは期間全体の合計で時間の次元がないため、前週比較はできません。') });
    }

  return db.transaction(async () => {
    const out: UploadDetail[] = [];
    for (const p of parsed) out.push(await persist(db, cfg, p));
    return out;
  });
}

const bi = (en: string, ja: string) => enc(tx(en, ja));
const prefix = (p: LText, message: string) => {
  const m = dec(message);
  return enc(tx(p.en + m.en, p.ja + m.ja));
};
function joinNotes(notes: (string | null)[]): string | null {
  const list = [...new Set(notes.filter((n): n is string => !!n))].map(dec);
  return list.length ? enc(tx(list.map((n) => n.en).join('; '), list.map((n) => n.ja).join('、'))) : null;
}

function parseFile(file: IncomingFile, expected: Source | null): ParsedFile {
  const fail = (outcome: Outcome, format: string, code: string, en: string, ja: string): ParsedFile => ({
    file, format, tables: [], outcome, source: null, detection: { source: null, method: 'none', signals: [] }, errors: [{ severity: 'error', code, message: bi(en, ja) }],
  });
  if (file.buffer.length === 0) return fail('failed', 'empty', 'empty', 'The file is empty.', 'ファイルが空です。');

  let extraction = file.extraction;
  if (!extraction) {
    try {
      extraction = extractSync(file.fileName, file.buffer);
    } catch (e) {
      extraction = e as UnsupportedFormat | ProcessingFailed;
    }
  }
  if (extraction instanceof UnsupportedFormat)
    return fail('unsupported', extraction.detected, 'unsupported-format', `Unsupported file format: ${extraction.en}`, `対応していないファイル形式：${extraction.ja}`);
  if (extraction instanceof ProcessingFailed || extraction instanceof Error) {
    const err = extraction as ProcessingFailed;
    return fail('failed', 'unknown', 'processing-failed', `Processing failed: ${err.en ?? err.message}`, `処理に失敗しました：${err.ja ?? err.message}`);
  }

  const tables: ParsedTable[] = [];
  const errors: Issue[] = extraction.notes.map((n) => ({ severity: 'warning' as const, code: 'entry-skipped', message: bi(n.en, n.ja) }));
  const named = extraction.grids.filter((g) => !g.rows.every((r) => r.every((c) => !c.trim())));
  let detection: SourceDetection | null = null;
  const label = (src: Source) => (src === 'GA4' ? 'GA4' : 'Google Search Console');
  for (const grid of named) {
    const where = grid.name ? tx(`"${grid.name}": `, `「${grid.name}」：`) : tx('');
    let det = detectSource(grid);
    if (expected) {
      if (det.source && det.source !== expected) {
        errors.push({ severity: 'error', code: 'source-mismatch', message: bi(`${where.en}${label(expected)} was selected, but the contents are ${label(det.source)} data (${det.signals.join(', ')}).`, `${where.ja}${label(expected)} が選択されましたが、内容は ${label(det.source)} のデータです（${det.signals.join('、')}）。`) });
        detection ??= det;
        continue;
      }
      if (!det.source) det = { ...det, source: expected, method: 'user' };
    }
    detection ??= det;
    if (!det.source) {
      errors.push({ severity: 'error', code: 'unknown-source', message: bi(`${where.en}Source: Unknown — the contents match neither GA4 nor Google Search Console${det.signals.length ? ` clearly (fields: ${det.signals.join(', ')})` : ''}. The file may be missing its header rows (e.g. the GA4 セグメント / 日付 rows or the Search Console column names); upload the export with its headers.`, `${where.ja}ソース：不明 — 内容が GA4 と Google Search Console のどちらにも明確に一致しません${det.signals.length ? `（項目：${det.signals.join('、')}）` : ''}。見出し行（GA4 のセグメント・日付行や Search Console の列名）が欠けている可能性があります。見出し付きのエクスポートをアップロードしてください。`) });
      continue;
    }
    // One upload holds one source; a second source in the same file is reported, not mixed in.
    const fileSource = tables[0]?.source ?? detection.source ?? det.source;
    if (det.source !== fileSource) {
      errors.push({ severity: 'error', code: 'mixed-sources', message: bi(`${where.en}This table is ${label(det.source)} data, but the file also contains ${label(fileSource)} data. Upload them as separate files.`, `${where.ja}この表は ${label(det.source)} のデータですが、同じファイルに ${label(fileSource)} のデータも含まれています。別々のファイルでアップロードしてください。`) });
      continue;
    }
    // Apply only the detected source's parser and validation; never GA4 rules to GSC data or the reverse.
    const result = det.source === 'GA4' ? parseGa4(grid) : parseGsc(grid);
    if (result.ok) tables.push(result.table);
    else if (det.method === 'layout') errors.push({ ...result.issue, message: prefix(where, result.issue.message) });
    else {
      const how = det.method === 'user' ? tx('selected', '選択') : tx(`detected from fields: ${det.signals.join(', ')}`, `項目から判定：${det.signals.join('、')}`);
      const why = { en: dec(result.issue.message).en, ja: dec(result.issue.message).ja };
      const layoutEn = det.source === 'GA4' ? 'a GA4 Explorations export (セグメント / segment header row with metrics per segment)' : 'a Search Console Performance export (first column クエリ / ページ / 日付 / デバイス / 国 / 検索での見え方)';
      const layoutJa = det.source === 'GA4' ? 'GA4 探索のエクスポート（セグメント見出し行とセグメント別の指標）' : 'Search Console 検索パフォーマンスのエクスポート（先頭列がクエリ / ページ / 日付 / デバイス / 国 / 検索での見え方）';
      errors.push({ severity: 'error', code: 'unsupported-layout', message: bi(`${where.en}Source: ${label(det.source)} (${how.en}), but the table is not laid out as ${layoutEn}, so the ${det.source} rules cannot be applied. ${why.en}`, `${where.ja}ソース：${label(det.source)}（${how.ja}）ですが、表が${layoutJa}の形式ではないため、${det.source} のルールを適用できません。${why.ja}`) });
    }
  }
  if (!tables.length && !errors.some((e) => e.severity === 'error'))
    errors.push({ severity: 'error', code: 'empty', message: bi(`No data found in this ${FORMAT_LABEL[extraction.format]} file.`, `この ${FORMAT_LABEL[extraction.format]} ファイルにデータがありません。`) });
  const final = detection ?? { source: null, method: 'none' as const, signals: [] };
  return { file, format: extraction.format, tables, errors, outcome: tables.length ? 'imported' : 'failed', source: tables[0]?.source ?? final.source, detection: final };
}

async function persist(db: DB, cfg: AppConfig, p: ParsedFile): Promise<UploadDetail> {
  const rejected = p.outcome !== 'imported';
  const issues: Issue[] = [...p.errors, ...p.tables.flatMap((t) => t.issues.map((i) => (t.sheet ? { ...i, message: prefix(tx(`"${t.sheet}": `, `「${t.sheet}」：`), i.message) } : i)))];
  const records = p.tables.flatMap((t) => t.records.filter((r) => r.status !== 'metadata' && r.status !== 'total'));
  const validRows = records.filter((r) => r.status === 'valid').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const errors = issues.filter((i) => i.severity === 'error').length;
  const dated = p.tables.filter((t) => t.period);
  const period = dated.length
    ? { start: dated.map((t) => t.period!.start).sort()[0]!, end: dated.map((t) => t.period!.end).sort().at(-1)! }
    : null;

  const uploadId = await db.insert(
        `INSERT INTO uploads (file_name, source, file_type, structure, uploaded_at, analysis_period_start, analysis_period_end,
           period_note, row_count, valid_row_count, validation_status, import_status, warning_count, error_count, schema_version, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        p.file.fileName,
        p.source,
        p.format,
        p.tables.map((t) => t.structure).join(', ') || null,
        nowIso(),
        period?.start ?? null,
        period?.end ?? null,
        joinNotes(dated.map((t) => t.periodNote)),
        records.length,
        validRows,
        rejected ? 'invalid' : issues.length ? 'valid_with_warnings' : 'valid',
        p.outcome,
        warnings,
        errors,
        SCHEMA_VERSION,
        JSON.stringify({ detection: p.detection, ...Object.fromEntries(p.tables.map((t) => [t.sheet ? `${t.structure} (${t.sheet})` : t.structure, t.metadata])) }),
  );

  await db.run('INSERT INTO upload_files (upload_id, content) VALUES (?, ?)', uploadId, p.file.buffer);

  for (const i of issues)
    await db.run('INSERT INTO upload_issues (upload_id, severity, code, message, row_number, column_name) VALUES (?, ?, ?, ?, ?, ?)', uploadId, i.severity, i.code, i.message, i.row ?? null, i.column ?? null);

  const DATA_COLS = 19;
  const dataSql = (rows: number) =>
    `INSERT INTO imported_data (upload_id, source_record_id, source, structure, data_date, period_start, period_end, page_url, query,
       segment, traffic_source, device, country, search_appearance, metric_name, source_metric_name, metric_value, is_valid, invalid_reason)
     VALUES ${Array.from({ length: rows }, () => `(${Array(DATA_COLS).fill('?').join(', ')})`).join(', ')}`;
  const roleOf = (segment: string | null | undefined) =>
    segment ? (Object.entries(cfg.segments).find(([, m]) => m.value === segment)?.[0] ?? null) : null;

  for (const t of p.tables) {
    const tableName = t.sheet ? `${t.structure} (${t.sheet})` : t.structure;
    for (const r of t.records) {
      const rawId = await db.insert(
        'INSERT INTO raw_records (upload_id, table_name, row_number, status, values_json, issues_json) VALUES (?, ?, ?, ?, ?, ?)',
        uploadId, tableName, r.rowNumber, r.status, JSON.stringify(r.values), JSON.stringify(r.issues),
      );
      // One statement per source line (its values in file order), so ids follow the same order as before.
      if (r.data.length)
        await db.run(
          dataSql(r.data.length),
          ...r.data.flatMap((d) => [
            uploadId, rawId, t.source, t.structure, d.dataDate,
            d.dataDate ?? t.period?.start ?? null, d.dataDate ?? t.period?.end ?? null,
            d.pageUrl ?? null, d.query ?? null, d.segment ?? null, roleOf(d.segment),
            d.device ?? null, d.country ?? null, d.searchAppearance ?? null,
            d.metricName, d.sourceMetricName, d.metricValue, d.isValid ? 1 : 0, d.invalidReason ?? null,
          ]),
        );
    }
  }
  if (!rejected) await refreshOntologyObjects(db, cfg, uploadId);
  return (await getUpload(db, uploadId))!;
}

/** Page, Search Query, Query Classification and Traffic Source objects seen in an upload. */
async function refreshOntologyObjects(db: DB, cfg: AppConfig, uploadId: number) {
  await db.run(`INSERT INTO pages (url) SELECT DISTINCT page_url FROM imported_data WHERE upload_id = ? AND page_url IS NOT NULL ON CONFLICT DO NOTHING`, uploadId);
  await db.run(`INSERT INTO search_queries (query) SELECT DISTINCT query FROM imported_data WHERE upload_id = ? AND query IS NOT NULL ON CONFLICT DO NOTHING`, uploadId);
  const queries = await db.values<string>('SELECT DISTINCT query FROM imported_data WHERE upload_id = ? AND query IS NOT NULL', uploadId);
  const ruleSource = cfg.brandTerms.confirmed ? 'rules.yaml gsc.brand_terms' : 'rules.yaml gsc.brand_terms (provisional, not confirmed)';
  for (const q of queries)
    await db.run(
      `INSERT INTO query_classifications (query, classification_type, classification_value, rule_source) VALUES (?, 'brand_division', ?, ?)
       ON CONFLICT (query, classification_type) DO UPDATE SET classification_value = excluded.classification_value, rule_source = excluded.rule_source`,
      q, isBrandQuery(cfg, q) ? 'brand' : 'non-brand', ruleSource,
    );
  const segments = await db.all<{ segment: string; traffic_source: string | null }>('SELECT DISTINCT segment, traffic_source FROM imported_data WHERE upload_id = ? AND segment IS NOT NULL', uploadId);
  for (const s of segments) {
    const role = s.traffic_source as keyof AppConfig['segments'] | null;
    await db.run(
      `INSERT INTO traffic_sources (segment, role, confirmed) VALUES (?, ?, ?) ON CONFLICT (segment) DO UPDATE SET role = excluded.role, confirmed = excluded.confirmed`,
      s.segment, role, role ? (cfg.segments[role].confirmed ? 1 : 0) : 0,
    );
  }
}

export function isBrandQuery(cfg: AppConfig, query: string): boolean {
  const q = query.toLowerCase();
  return cfg.brandTerms.value.some((t) => q.includes(t.toLowerCase()));
}

// ---------- Reads ----------

type UploadRow = Record<string, any>;

function toUpload(r: UploadRow): Upload {
  return {
    id: r.id,
    fileName: r.file_name,
    source: r.source,
    fileType: r.file_type,
    structure: r.structure,
    uploadedAt: r.uploaded_at,
    period: r.analysis_period_start ? { start: r.analysis_period_start, end: r.analysis_period_end } : null,
    periodNote: r.period_note,
    rowCount: r.row_count,
    validRowCount: r.valid_row_count,
    validationStatus: r.validation_status,
    importStatus: r.import_status,
    warningCount: r.warning_count,
    errorCount: r.error_count,
    schemaVersion: r.schema_version,
    metadata: parseJson(r.metadata_json, {}),
  };
}

export async function listUploads(db: DB): Promise<Upload[]> {
  return (await db.all<UploadRow>('SELECT * FROM uploads ORDER BY id DESC')).map(toUpload);
}

export async function getUpload(db: DB, id: number): Promise<UploadDetail | null> {
  const r = await db.get<UploadRow>('SELECT * FROM uploads WHERE id = ?', id);
  if (!r) return null;
  const issues = (await db.all<UploadRow>('SELECT * FROM upload_issues WHERE upload_id = ? ORDER BY id', id)).map((i) => ({
    severity: i.severity,
    code: i.code,
    message: i.message,
    row: i.row_number,
    column: i.column_name,
  }));
  return { ...toUpload(r), issues };
}

export async function deleteUpload(db: DB, id: number): Promise<boolean> {
  return (await db.run('DELETE FROM uploads WHERE id = ?', id)) > 0;
}

/**
 * Deletes an upload together with the measurement runs that used its data, unless the SEO team
 * has recorded decisions on one of those runs (then nothing is deleted).
 */
export async function deleteUploadWithRuns(db: DB, id: number): Promise<{ deletedRuns: number[] } | { blockedBy: number[] }> {
  return db.transaction(async () => {
    const runs = await db.values<number>(
        `SELECT DISTINCT m.run_id FROM measurement_sources ms
         JOIN measurements m ON m.id = ms.measurement_id
         JOIN imported_data d ON d.id = ms.imported_data_id
         WHERE d.upload_id = ? ORDER BY m.run_id`,
        id,
    );
    const decided: number[] = [];
    for (const run of runs)
      if (
        ((await db.value<number>(
            `SELECT COUNT(*) FROM state_events e WHERE
               (e.entity = 'anomaly' AND e.entity_id IN (SELECT a.id FROM anomalies a JOIN measurements m ON m.id = a.measurement_id WHERE m.run_id = ?))
            OR (e.entity = 'cause' AND e.entity_id IN (SELECT c.id FROM cause_hypotheses c JOIN anomalies a ON a.id = c.anomaly_id JOIN measurements m ON m.id = a.measurement_id WHERE m.run_id = ?))
            OR (e.entity = 'countermeasure' AND e.entity_id IN (SELECT k.id FROM countermeasures k JOIN cause_hypotheses c ON c.id = k.cause_id JOIN anomalies a ON a.id = c.anomaly_id JOIN measurements m ON m.id = a.measurement_id WHERE m.run_id = ?))`,
            run, run, run,
        )) ?? 0) > 0
      )
        decided.push(run);
    if (decided.length) return { blockedBy: decided };
    for (const run of runs) await db.run('DELETE FROM measurement_runs WHERE id = ?', run);
    await deleteUpload(db, id);
    return { deletedRuns: [...runs, ...(await deleteDatalessRuns(db))] };
  });
}

/**
 * Runs left without data: no measurement used an uploaded value and the GA4 data they were made for is gone (their
 * own uploads deleted, or — for a run of "all data" — no GA4 upload left at all). They only show dates with nothing
 * behind them, so they are removed. Such runs never have an anomaly, so no SEO team decision is lost.
 */
export async function deleteDatalessRuns(db: DB): Promise<number[]> {
  const ga4 = new Set(await db.values<number>(`SELECT id FROM uploads WHERE source = 'GA4' AND import_status = 'imported'`));
  const runs = await db.all(
    `SELECT r.id, r.scope_json FROM measurement_runs r
     WHERE NOT EXISTS (SELECT 1 FROM measurements m JOIN measurement_sources ms ON ms.measurement_id = m.id WHERE m.run_id = r.id)
       AND NOT EXISTS (SELECT 1 FROM measurements m JOIN anomalies a ON a.measurement_id = m.id WHERE m.run_id = r.id)
     ORDER BY r.id`,
  );
  const gone = runs
    .filter((r) => {
      const ids = parseJson<{ uploadIds?: number[] }>(r.scope_json, {}).uploadIds ?? [];
      return ids.length ? !ids.some((u) => ga4.has(u)) : ga4.size === 0;
    })
    .map((r) => r.id as number);
  for (const run of gone) await db.run('DELETE FROM measurement_runs WHERE id = ?', run);
  return gone;
}
