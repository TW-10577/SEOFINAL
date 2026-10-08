// One-time data migration: SQLite (database/seo.db) → PostgreSQL (DATABASE_URL).
//
//   npm run db:migrate-sqlite -w api                    # source: SEO/database/seo.db
//   npm run db:migrate-sqlite -w api -- --sqlite <path> # another SQLite file
//   … -- --replace                                       # empty the PostgreSQL tables first
//
// Every table is copied in foreign-key order with its own ids, dates, values and JSON text unchanged; identity
// counters then continue after the highest id. Afterwards each table is verified: row count and a SHA-256 of
// all rows (in primary-key order) must be identical on both sides. The SQLite file is only read, never changed.
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openDb, type DB } from '../src/db.ts';

const here = dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const sqlitePath = resolve(opt('--sqlite') ?? resolve(here, '../../database/seo.db'));
const replace = args.includes('--replace');

/** Parents before children, so every foreign key points at a row that is already there. */
const TABLES: { name: string; key: string[] }[] = [
  { name: 'schema_info', key: ['version'] },
  { name: 'uploads', key: ['id'] },
  { name: 'upload_files', key: ['upload_id'] },
  { name: 'upload_issues', key: ['id'] },
  { name: 'raw_records', key: ['id'] },
  { name: 'imported_data', key: ['id'] },
  { name: 'sites', key: ['key'] },
  { name: 'pages', key: ['url'] },
  { name: 'search_queries', key: ['query'] },
  { name: 'query_classifications', key: ['query', 'classification_type'] },
  { name: 'traffic_sources', key: ['segment'] },
  { name: 'measurement_runs', key: ['id'] },
  { name: 'analysis_results', key: ['id'] },
  { name: 'measurements', key: ['id'] },
  { name: 'measurement_sources', key: ['measurement_id', 'imported_data_id'] },
  { name: 'anomalies', key: ['id'] },
  { name: 'cause_hypotheses', key: ['id'] },
  { name: 'countermeasures', key: ['id'] },
  { name: 'state_events', key: ['id'] },
  { name: 'amendments', key: ['id'] },
];

type Row = Record<string, unknown>;

/** Canonical text of one value: bytes as hex, numbers as JSON, so both databases hash the same way. */
const canon = (v: unknown) => (Buffer.isBuffer(v) ? `x${v.toString('hex')}` : v === null || v === undefined ? 'null' : JSON.stringify(v));

function digest(rows: Row[], cols: string[]): string {
  const h = createHash('sha256');
  for (const r of rows) h.update(cols.map((c) => canon(r[c])).join('\u0001') + '\u0002');
  return h.digest('hex');
}

/** Byte-wise (code point) comparison — the order of both SQLite BINARY and PostgreSQL C.UTF-8. */
const cmp = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
const sortBy = (rows: Row[], key: string[]) => rows.sort((x, y) => key.reduce((r, k) => r || cmp(x[k], y[k]), 0));

async function main() {
  if (!existsSync(sqlitePath)) throw new Error(`SQLite database not found: ${sqlitePath}`);
  const lite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const pg: DB = await openDb(); // creates the PostgreSQL tables when missing
  console.log(`Source : ${sqlitePath} (read-only)`);
  console.log(`Target : ${pg.label}`);

  const liteTables = new Set((lite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((t) => t.name));
  const columnsOf = async (t: string) => {
    const pgCols = await pg.values<string>(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? ORDER BY ordinal_position`, t);
    const liteCols = (lite.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    const missing = liteCols.filter((c) => !pgCols.includes(c));
    if (missing.length) throw new Error(`${t}: SQLite column(s) ${missing.join(', ')} do not exist in PostgreSQL — nothing was copied.`);
    return pgCols.filter((c) => liteCols.includes(c));
  };

  // Target must be empty (or emptied with --replace) so ids and relationships are copied exactly.
  const existing: string[] = [];
  for (const t of TABLES) if (t.name !== 'schema_info' && ((await pg.value<number>(`SELECT COUNT(*) FROM ${t.name}`)) ?? 0) > 0) existing.push(t.name);
  if (existing.length && !replace) throw new Error(`PostgreSQL already has data in: ${existing.join(', ')}. Run with --replace to empty these tables first.`);

  const copied: Record<string, number> = {};
  await pg.transaction(async () => {
    if (replace || existing.length) await pg.exec(`TRUNCATE ${TABLES.map((t) => t.name).join(', ')} RESTART IDENTITY CASCADE`);
    else await pg.exec('TRUNCATE schema_info');
    for (const t of TABLES) {
      if (!liteTables.has(t.name)) {
        copied[t.name] = 0;
        continue;
      }
      const cols = await columnsOf(t.name);
      const rows = lite.prepare(`SELECT ${cols.join(', ')} FROM ${t.name}`).all() as Row[];
      const batch = Math.max(1, Math.floor(30000 / cols.length)); // stay under PostgreSQL's 65,535 parameters
      for (let i = 0; i < rows.length; i += batch) {
        const part = rows.slice(i, i + batch);
        await pg.run(
          `INSERT INTO ${t.name} (${cols.join(', ')}) VALUES ${part.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ')}`,
          ...part.flatMap((r) => cols.map((c) => r[c])),
        );
      }
      copied[t.name] = rows.length;
      // Identity counters continue where SQLite would: after the highest id ever used (sqlite_sequence, which
      // also counts deleted rows, for AUTOINCREMENT tables), else after the highest id present.
      if (t.key.length === 1 && t.key[0] === 'id') {
        const used = liteTables.has('sqlite_sequence')
          ? ((lite.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(t.name) as { seq: number } | undefined)?.seq ?? 0)
          : 0;
        await pg.run(`SELECT setval(pg_get_serial_sequence('${t.name}', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${t.name}), 0), ?) + 1, false)`, used);
      }
    }
  });

  // ---- verification: same rows, same values ----
  let ok = true;
  console.log(`\n${'table'.padEnd(24)}${'sqlite'.padStart(8)}${'postgres'.padStart(10)}  checksum`);
  for (const t of TABLES) {
    const cols = liteTables.has(t.name) ? await columnsOf(t.name) : [];
    const a = cols.length ? sortBy(lite.prepare(`SELECT ${cols.join(', ')} FROM ${t.name}`).all() as Row[], t.key) : [];
    const b = cols.length ? sortBy(await pg.all(`SELECT ${cols.join(', ')} FROM ${t.name}`), t.key) : [];
    const same = a.length === b.length && digest(a, cols) === digest(b, cols);
    ok &&= same;
    console.log(`${t.name.padEnd(24)}${String(a.length).padStart(8)}${String(b.length).padStart(10)}  ${same ? 'identical' : 'DIFFERENT'}`);
  }
  lite.close();
  await pg.close();
  if (!ok) throw new Error('Verification failed: PostgreSQL does not match SQLite (see the table above). The transaction was committed; re-run with --replace after fixing.');
  console.log(`\nMigration complete: ${Object.values(copied).reduce((x, y) => x + y, 0)} rows copied, every table identical. ${sqlitePath} was not modified.`);
}

main().catch((e) => {
  console.error(`\nMigration failed: ${(e as Error).message}`);
  process.exit(1);
});
