// Database layer: PostgreSQL via `pg`. The SEO code only sees the small DB interface below, so the database
// can change without touching business logic. Connection: DATABASE_URL (never hard-coded).
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import pg from 'pg';

export const SCHEMA_VERSION = 5;

const here = dirname(new URL(import.meta.url).pathname);

// COUNT(*) and other BIGINT results arrive as strings by default; every value here fits a JS number.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

type Row = Record<string, any>;

export interface DB {
  /** First row, or undefined. */
  get<T = Row>(sql: string, ...args: unknown[]): Promise<T | undefined>;
  /** All rows. */
  all<T = Row>(sql: string, ...args: unknown[]): Promise<T[]>;
  /** First column of the first row, or undefined. */
  value<T = unknown>(sql: string, ...args: unknown[]): Promise<T | undefined>;
  /** First column of every row. */
  values<T = unknown>(sql: string, ...args: unknown[]): Promise<T[]>;
  /** Executes a statement; returns the number of affected rows. */
  run(sql: string, ...args: unknown[]): Promise<number>;
  /** Executes an INSERT and returns the new row's id (… RETURNING id). */
  insert(sql: string, ...args: unknown[]): Promise<number>;
  /** Runs `fn` in one transaction; every query inside it (also in called functions) uses that transaction. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  /** Executes one or more statements without parameters (schema). */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  /** Connection description without credentials, for logs. */
  readonly label: string;
}

/** `?` placeholders (as written in the SQL here) → PostgreSQL `$1, $2, …`; quoted text is left alone. */
export function toPg(sql: string): string {
  let n = 0;
  let out = '';
  let quote: string | null = null;
  for (const ch of sql) {
    if (quote) {
      if (ch === quote) quote = null;
      out += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else out += ch === '?' ? `$${++n}` : ch;
  }
  return out;
}

/** postgres://user:secret@host:5433/db → postgres://user@host:5433/db */
const redact = (url: string) => url.replace(/\/\/([^:@/]+):[^@/]*@/, '//$1@');

/** DATABASE_URL from the environment, or from SEO/.env when not set (local development). */
export function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(resolve(here, '../../.env'), 'utf8');
    const m = /^\s*DATABASE_URL\s*=\s*(.+?)\s*$/m.exec(env);
    if (m) return m[1]!.replace(/^["']|["']$/g, '');
  } catch {
    /* no .env */
  }
  throw new Error('DATABASE_URL is not set. Set it in the environment or in SEO/.env (see .env.example).');
}

/**
 * Connects to PostgreSQL and creates the tables when missing (schema.sql is idempotent).
 * `schema` (tests) selects a separate PostgreSQL schema, created on demand.
 */
export async function openDb(url = databaseUrl(), opts: { schema?: string } = {}): Promise<DB> {
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    allowExitOnIdle: true,
    connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 10000),
    ...(opts.schema ? { options: `-c search_path=${opts.schema}` } : {}),
  });
  const tx = new AsyncLocalStorage<pg.PoolClient>();
  const q = async (sql: string, args: unknown[]) => (tx.getStore() ?? pool).query(toPg(sql), args);

  const db: DB = {
    label: `${redact(url)}${opts.schema ? ` (schema ${opts.schema})` : ''}`,
    async get(sql, ...args) {
      return (await q(sql, args)).rows[0];
    },
    async all(sql, ...args) {
      return (await q(sql, args)).rows;
    },
    async value(sql, ...args) {
      const r = await q(sql, args);
      const row = r.rows[0];
      return row ? row[r.fields[0]!.name] : undefined;
    },
    async values(sql, ...args) {
      const r = await q(sql, args);
      const f = r.fields[0]?.name;
      return f ? r.rows.map((row) => row[f]) : [];
    },
    async run(sql, ...args) {
      return (await q(sql, args)).rowCount ?? 0;
    },
    async insert(sql, ...args) {
      return Number((await q(`${sql} RETURNING id`, args)).rows[0].id);
    },
    async transaction(fn) {
      if (tx.getStore()) return fn(); // already inside one: same transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await tx.run(client, fn);
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async exec(sql) {
      await (tx.getStore() ?? pool).query(sql);
    },
    async close() {
      await pool.end();
    },
  };

  if (opts.schema) await pool.query(`CREATE SCHEMA IF NOT EXISTS ${opts.schema}`);
  await db.exec(readFileSync(resolve(here, 'schema.sql'), 'utf8'));
  if ((await db.value('SELECT COUNT(*) FROM schema_info')) === 0) await db.run('INSERT INTO schema_info (version) VALUES (?)', SCHEMA_VERSION);
  return db;
}

export const nowIso = () => new Date().toISOString();

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
