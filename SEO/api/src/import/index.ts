import type { Issue, Period, Source, Upload, UploadDetail } from '@seo/shared';
import type { AppConfig } from '../config.ts';
import { SCHEMA_VERSION, nowIso, parseJson, type DB } from '../db.ts';
import { dec, enc, tx, type LText } from '../i18n.ts';
import { looksLikeGa4, parseGa4 } from './ga4.ts';
import { fileTypeOf, readGrids, type FileType } from './grid.ts';
import { looksLikeGsc, parseGsc } from './gsc.ts';
import type { ParsedTable } from './types.ts';

export interface IncomingFile {
  fileName: string;
  buffer: Buffer;
}

export interface ImportOptions {
  source: Source;
  /** Period for files whose rows carry no date (e.g. GSC 3-month totals). */
  period?: Period | null;
}

interface ParsedFile {
  file: IncomingFile;
  fileType: FileType | null;
  tables: ParsedTable[];
  errors: Issue[];
}

/**
 * Imports one batch. Each file becomes one upload row — rejected files too, so the
 * Data Import page can show why. Undated GSC tabs take their period from, in order:
 * the period entered on upload, or a GSC daily chart in the same batch.
 */
export function importFiles(db: DB, cfg: AppConfig, files: IncomingFile[], opts: ImportOptions): UploadDetail[] {
  const parsed = files.map((f) => parseFile(f, opts.source));

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

  return db.transaction(() => parsed.map((p) => persist(db, cfg, p, opts.source)))();
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

function parseFile(file: IncomingFile, source: Source): ParsedFile {
  const fileType = fileTypeOf(file.fileName);
  if (!fileType) return { file, fileType, tables: [], errors: [{ severity: 'error', code: 'unsupported-type', message: bi('Unsupported file type. Upload CSV or Excel (.xlsx).', '対応していないファイル形式です。CSV または Excel（.xlsx）をアップロードしてください。') }] };
  if (file.buffer.length === 0) return { file, fileType, tables: [], errors: [{ severity: 'error', code: 'empty', message: bi('The file is empty.', 'ファイルが空です。') }] };

  let grids;
  try {
    grids = readGrids(fileType, file.buffer);
  } catch (e) {
    return { file, fileType, tables: [], errors: [{ severity: 'error', code: 'invalid-file', message: bi(`The file could not be read: ${(e as Error).message}`, `ファイルを読み込めませんでした：${(e as Error).message}`) }] };
  }
  const tables: ParsedTable[] = [];
  const errors: Issue[] = [];
  for (const grid of grids) {
    if (grid.rows.every((r) => r.every((c) => !c.trim()))) continue;
    const where = grid.name ? tx(`Sheet "${grid.name}": `, `シート「${grid.name}」：`) : tx('');
    const isGa4 = looksLikeGa4(grid);
    const isGsc = !isGa4 && looksLikeGsc(grid);
    if (!isGa4 && !isGsc) {
      errors.push({ severity: 'error', code: 'unknown-structure', message: bi(`${where.en}Not a recognised GA4 Explorations or Search Console export.`, `${where.ja}GA4 探索または Search Console のエクスポートとして認識できません。`) });
      continue;
    }
    const detected: Source = isGa4 ? 'GA4' : 'GSC';
    if (detected !== source) {
      errors.push({ severity: 'error', code: 'source-mismatch', message: bi(`${where.en}Source "${source}" was selected, but the file contents are a ${detected} export.`, `${where.ja}ソースに「${source}」が選択されていますが、ファイルの内容は ${detected} のエクスポートです。`) });
      continue;
    }
    const result = isGa4 ? parseGa4(grid) : parseGsc(grid);
    if (result.ok) tables.push(result.table);
    else errors.push({ ...result.issue, message: prefix(where, result.issue.message) });
  }
  if (!tables.length && !errors.length) errors.push({ severity: 'error', code: 'empty', message: bi('The file contains no data.', 'ファイルにデータがありません。') });
  return { file, fileType, tables, errors };
}

function persist(db: DB, cfg: AppConfig, p: ParsedFile, source: Source): UploadDetail {
  const rejected = p.tables.length === 0;
  const issues: Issue[] = [...p.errors, ...p.tables.flatMap((t) => t.issues.map((i) => (t.sheet ? { ...i, message: prefix(tx(`Sheet "${t.sheet}": `, `シート「${t.sheet}」：`), i.message) } : i)))];
  const records = p.tables.flatMap((t) => t.records.filter((r) => r.status !== 'metadata' && r.status !== 'total'));
  const validRows = records.filter((r) => r.status === 'valid').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const errors = issues.filter((i) => i.severity === 'error').length;
  const dated = p.tables.filter((t) => t.period);
  const period = dated.length
    ? { start: dated.map((t) => t.period!.start).sort()[0]!, end: dated.map((t) => t.period!.end).sort().at(-1)! }
    : null;

  const uploadId = Number(
    db
      .prepare(
        `INSERT INTO uploads (file_name, source, file_type, structure, uploaded_at, analysis_period_start, analysis_period_end,
           period_note, row_count, valid_row_count, validation_status, import_status, warning_count, error_count, schema_version, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        p.file.fileName,
        source,
        p.fileType ?? 'unknown',
        p.tables.map((t) => t.structure).join(', ') || null,
        nowIso(),
        period?.start ?? null,
        period?.end ?? null,
        joinNotes(dated.map((t) => t.periodNote)),
        records.length,
        validRows,
        rejected ? 'invalid' : issues.length ? 'valid_with_warnings' : 'valid',
        rejected ? 'rejected' : 'imported',
        warnings,
        errors,
        SCHEMA_VERSION,
        JSON.stringify(Object.fromEntries(p.tables.map((t) => [t.sheet ? `${t.structure} (${t.sheet})` : t.structure, t.metadata]))),
      ).lastInsertRowid,
  );

  const insIssue = db.prepare('INSERT INTO upload_issues (upload_id, severity, code, message, row_number, column_name) VALUES (?, ?, ?, ?, ?, ?)');
  for (const i of issues) insIssue.run(uploadId, i.severity, i.code, i.message, i.row ?? null, i.column ?? null);

  const insRaw = db.prepare('INSERT INTO raw_records (upload_id, table_name, row_number, status, values_json, issues_json) VALUES (?, ?, ?, ?, ?, ?)');
  const insData = db.prepare(
    `INSERT INTO imported_data (upload_id, source_record_id, source, structure, data_date, period_start, period_end, page_url, query,
       segment, traffic_source, device, country, search_appearance, metric_name, source_metric_name, metric_value, is_valid, invalid_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const roleOf = (segment: string | null | undefined) =>
    segment ? (Object.entries(cfg.segments).find(([, m]) => m.value === segment)?.[0] ?? null) : null;

  for (const t of p.tables) {
    const tableName = t.sheet ? `${t.structure} (${t.sheet})` : t.structure;
    for (const r of t.records) {
      const rawId = Number(insRaw.run(uploadId, tableName, r.rowNumber, r.status, JSON.stringify(r.values), JSON.stringify(r.issues)).lastInsertRowid);
      for (const d of r.data) {
        insData.run(
          uploadId, rawId, t.source, t.structure, d.dataDate,
          d.dataDate ?? t.period?.start ?? null, d.dataDate ?? t.period?.end ?? null,
          d.pageUrl ?? null, d.query ?? null, d.segment ?? null, roleOf(d.segment),
          d.device ?? null, d.country ?? null, d.searchAppearance ?? null,
          d.metricName, d.sourceMetricName, d.metricValue, d.isValid ? 1 : 0, d.invalidReason ?? null,
        );
      }
    }
  }
  if (!rejected) refreshOntologyObjects(db, cfg, uploadId);
  return getUpload(db, uploadId)!;
}

/** Page, Search Query, Query Classification and Traffic Source objects seen in an upload. */
function refreshOntologyObjects(db: DB, cfg: AppConfig, uploadId: number) {
  db.prepare(`INSERT OR IGNORE INTO pages (url) SELECT DISTINCT page_url FROM imported_data WHERE upload_id = ? AND page_url IS NOT NULL`).run(uploadId);
  db.prepare(`INSERT OR IGNORE INTO search_queries (query) SELECT DISTINCT query FROM imported_data WHERE upload_id = ? AND query IS NOT NULL`).run(uploadId);
  const queries = db.prepare('SELECT DISTINCT query FROM imported_data WHERE upload_id = ? AND query IS NOT NULL').pluck().all(uploadId) as string[];
  const upsertClass = db.prepare(
    `INSERT INTO query_classifications (query, classification_type, classification_value, rule_source) VALUES (?, 'brand_division', ?, ?)
     ON CONFLICT (query, classification_type) DO UPDATE SET classification_value = excluded.classification_value, rule_source = excluded.rule_source`,
  );
  const ruleSource = cfg.brandTerms.confirmed ? 'config/rules.yaml gsc.brand_terms' : 'config/rules.yaml gsc.brand_terms (provisional, not confirmed)';
  for (const q of queries) upsertClass.run(q, isBrandQuery(cfg, q) ? 'brand' : 'non-brand', ruleSource);
  const segments = db.prepare('SELECT DISTINCT segment, traffic_source FROM imported_data WHERE upload_id = ? AND segment IS NOT NULL').all(uploadId) as { segment: string; traffic_source: string | null }[];
  const upsertSeg = db.prepare(
    `INSERT INTO traffic_sources (segment, role, confirmed) VALUES (?, ?, ?) ON CONFLICT (segment) DO UPDATE SET role = excluded.role, confirmed = excluded.confirmed`,
  );
  for (const s of segments) {
    const role = s.traffic_source as keyof AppConfig['segments'] | null;
    upsertSeg.run(s.segment, role, role ? (cfg.segments[role].confirmed ? 1 : 0) : 0);
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

export function listUploads(db: DB): Upload[] {
  return (db.prepare('SELECT * FROM uploads ORDER BY id DESC').all() as UploadRow[]).map(toUpload);
}

export function getUpload(db: DB, id: number): UploadDetail | null {
  const r = db.prepare('SELECT * FROM uploads WHERE id = ?').get(id) as UploadRow | undefined;
  if (!r) return null;
  const issues = (db.prepare('SELECT * FROM upload_issues WHERE upload_id = ? ORDER BY id').all(id) as UploadRow[]).map((i) => ({
    severity: i.severity,
    code: i.code,
    message: i.message,
    row: i.row_number,
    column: i.column_name,
  }));
  return { ...toUpload(r), issues };
}

export function deleteUpload(db: DB, id: number): boolean {
  return db.prepare('DELETE FROM uploads WHERE id = ?').run(id).changes > 0;
}
