import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, type AppConfig } from '../src/config.ts';
import { openDb, type DB } from '../src/db.ts';
import { addDays } from '../src/import/ga4.ts';
import { importFiles } from '../src/import/index.ts';
import { loadOntology, type Ontology } from '../src/ontology.ts';

export const DATA_DIR = resolve(import.meta.dirname, '../../Data');
export const GA4_DIR = resolve(DATA_DIR, 'GA4');
export const GSC_DIR = resolve(DATA_DIR, 'https___www.dospara.co.jp_-Performance-on-Search-2026-09-18');

export const clientFiles = (dir: string) => readdirSync(dir).map((f) => ({ fileName: f, buffer: readFileSync(resolve(dir, f)) }));

/** The real config, optionally adjusted for a test (e.g. a confirmed CVR unit). */
export function config(adjust?: (c: AppConfig) => void): AppConfig {
  const c = structuredClone(loadConfig());
  adjust?.(c);
  return c;
}

export function rule(c: AppConfig, id: string) {
  return c.rules.find((r) => r.id === id)!;
}

export function freshDb(): DB {
  return openDb(':memory:');
}

export interface WeekValues {
  /** [sessions, cv] per day for each segment. */
  total: [number, number];
  organic: [number, number];
  advertising: [number, number];
}

/**
 * A GA4 Explorations CSV in the client's layout: comment lines, segment header row,
 * metric header row, 総計 row, then one row per day. Each week repeats the same daily values.
 */
export function ga4Csv(previous: WeekValues, current: WeekValues, firstDay = '2026-09-10'): Buffer {
  const segs = ['通販（全体）', '通販（全体） オーガニックサーチ', '通販（全体） ペイド系合算'];
  const lines = [
    '# ----------------------------------------',
    '# https://www.dospara.co.jp - GA4',
    '# test export',
    '# ----------------------------------------',
    '',
    ['セグメント', ...segs.flatMap((s) => [s, s])].join(','),
    ['日付', ...segs.flatMap(() => ['セッション', 'e コマース購入数'])].join(','),
  ];
  const days: string[][] = [];
  const totals = new Array(6).fill(0);
  for (let i = 0; i < 14; i++) {
    const w = i < 7 ? previous : current;
    const vals = [...w.total, ...w.organic, ...w.advertising];
    vals.forEach((v, j) => (totals[j] += v));
    days.push([addDays(firstDay, i).replace(/-/g, ''), ...vals.map(String)]);
  }
  lines.push(['総計', ...totals].join(','), ...days.map((d) => d.join(',')));
  return Buffer.from('﻿' + lines.join('\n') + '\n', 'utf8');
}

export function importGa4(db: DB, cfg: AppConfig, buf: Buffer, fileName = 'ga4.csv') {
  return importFiles(db, cfg, [{ fileName, buffer: buf }], { source: 'GA4' });
}

/** GSC daily chart in the client's layout covering `days` days from `firstDay`. */
export function gscDailyCsv(firstDay: string, rows: [clicks: number, impressions: number, position: number][]): Buffer {
  const lines = ['日付,クリック数,表示回数,CTR,掲載順位'];
  rows.forEach(([c, i, p], k) => lines.push(`${addDays(firstDay, k)},${c},${i},${((c / i) * 100).toFixed(2)}%,${p}`));
  return Buffer.from(lines.join('\n'), 'utf8');
}

let cachedOntology: Ontology | null = null;
/** The real ontology (LOGOS_SEO_Ontology_Standalone_Final), loaded once per test file. */
export function ontology(): Ontology {
  return (cachedOntology ??= loadOntology());
}
