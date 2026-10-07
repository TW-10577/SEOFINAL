import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type DB = Database.Database;

export const SCHEMA_VERSION = 1;

const here = dirname(new URL(import.meta.url).pathname);

/** Default location: SEO/database/seo.db (override with SEO_DB_PATH). */
export const DEFAULT_DB_PATH = resolve(here, '../../database/seo.db');

/** Opens (and creates if needed) the database. Pass ':memory:' in tests. */
export function openDb(path = process.env.SEO_DB_PATH ?? DEFAULT_DB_PATH): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  // Rollback journal: every committed upload is written straight into seo.db (no side -wal file),
  // so the file can be opened with any SQLite viewer and always shows the saved data.
  db.pragma('journal_mode = DELETE');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(resolve(here, 'schema.sql'), 'utf8'));
  const row = db.prepare('SELECT version FROM schema_info').get() as { version: number } | undefined;
  if (!row) db.prepare('INSERT INTO schema_info (version) VALUES (?)').run(SCHEMA_VERSION);
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
