import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import type { ConfigSummary, RuleConfig, UnresolvedItem } from '@seo/shared';
import { dec, enc, tx, type LText } from './i18n.ts';

const here = dirname(new URL(import.meta.url).pathname);
export const DEFAULT_CONFIG_PATH = resolve(here, '../../config/rules.yaml');

export interface Mapping<T> {
  value: T;
  confirmed: boolean;
  note: string | null;
}

export type SegmentRole = 'total' | 'organic' | 'advertising';

export interface ActionConfig {
  action: LText;
  team?: LText;
  condition?: LText;
}

export interface AppConfig {
  schemaVersion: number;
  segments: Record<SegmentRole, Mapping<string>>;
  metricNames: { sessions: Mapping<string[]>; cv: Mapping<string[]> };
  brandTerms: Mapping<string[]>;
  evidenceRows: number;
  rules: RuleConfig[];
  actions: Record<string, Record<string, ActionConfig>>;
}

/** Bilingual value from `key` and `key_ja` (falls back to the English text). */
const bi = (r: Raw, key: string): LText | undefined => (r[key] == null ? undefined : tx(String(r[key]), String(r[`${key}_ja`] ?? r[key])));

type Raw = Record<string, any>;

function mapping<T>(raw: Raw | undefined, key: string, pick: (r: Raw) => T): Mapping<T> {
  if (!raw) throw new Error(`config: missing ${key}`);
  return { value: pick(raw), confirmed: raw.confirmed === true, note: raw.note ?? null };
}

const UNITS = ['percent', 'percentage_points', 'unresolved'] as const;

export function loadConfig(path = process.env.SEO_CONFIG_PATH ?? DEFAULT_CONFIG_PATH): AppConfig {
  return parseConfig(parse(readFileSync(path, 'utf8')) as Raw);
}

export function parseConfig(raw: Raw): AppConfig {
  const seg = raw.ga4?.segments ?? {};
  const rules: RuleConfig[] = (raw.rules ?? []).map((r: Raw) => {
    const unit = UNITS.includes(r.threshold_unit) ? r.threshold_unit : 'unresolved';
    return {
      id: String(r.id),
      number: String(r.number ?? ''),
      // Text fields carry both languages (encoded); responses are localized per request.
      name: enc(bi(r, 'name')!),
      criteria: enc(bi(r, 'criteria')!),
      primaryJudgment: enc(bi(r, 'primary_judgment') ?? tx('')),
      whatToCheckNext: enc(bi(r, 'what_to_check_next') ?? tx('')),
      subject: String(r.subject),
      metric: String(r.metric),
      thresholdValue: typeof r.threshold_value === 'number' ? r.threshold_value : null,
      thresholdUnit: unit,
      thresholdNote: r.threshold_note == null ? null : enc(bi(r, 'threshold_note')!),
      flatBandPercent: typeof r.flat_band_percent === 'number' ? r.flat_band_percent : null,
      direction: String(r.direction ?? 'both'),
      conditionType: String(r.condition_type ?? 'numeric'),
    } satisfies RuleConfig;
  });
  return {
    schemaVersion: Number(raw.schema_version ?? 1),
    segments: {
      total: mapping(seg.total, 'ga4.segments.total', (r) => String(r.name)),
      organic: mapping(seg.organic, 'ga4.segments.organic', (r) => String(r.name)),
      advertising: mapping(seg.advertising, 'ga4.segments.advertising', (r) => String(r.name)),
    },
    metricNames: {
      sessions: mapping(raw.ga4?.metrics?.sessions, 'ga4.metrics.sessions', (r) => r.names.map(String)),
      cv: mapping(raw.ga4?.metrics?.cv, 'ga4.metrics.cv', (r) => r.names.map(String)),
    },
    brandTerms: mapping(raw.gsc?.brand_terms, 'gsc.brand_terms', (r) => (r.terms ?? []).map(String)),
    evidenceRows: Number(raw.gsc?.evidence_rows ?? 10),
    rules,
    actions: Object.fromEntries(
      Object.entries((raw.actions ?? {}) as Record<string, Record<string, Raw>>).map(([rule, set]) => [
        rule,
        Object.fromEntries(Object.entries(set).map(([k, a]) => [k, { action: bi(a, 'action')!, team: bi(a, 'team'), condition: bi(a, 'condition') }])),
      ]),
    ),
  };
}

/** Everything still waiting on the client, for the UI and the report (descriptions are bilingual). */
export function unresolvedItems(cfg: AppConfig): UnresolvedItem[] {
  const items: UnresolvedItem[] = [];
  const add = (key: string, en: string, ja: string) => items.push({ key, description: enc(tx(en, ja)) });
  for (const rule of cfg.rules) {
    const name = dec(rule.name);
    const note = dec(rule.thresholdNote);
    if (rule.thresholdValue === null)
      add(`${rule.id}.threshold_value`, `${rule.number} ${name.en}: threshold value not configured.`, `${rule.number} ${name.ja}：閾値が設定されていません。`);
    if (rule.thresholdUnit === 'unresolved')
      add(`${rule.id}.threshold_unit`, `${rule.number} ${name.en}: threshold unit not confirmed. ${note.en}`.trim(), `${rule.number} ${name.ja}：閾値の単位が未確認です。${note.ja}`);
    if (rule.id === 'GA4-R2' && rule.flatBandPercent == null)
      add(`${rule.id}.flat_band_percent`, `${rule.number} ${name.en}: "flat" is not defined, so the What to Check Next branch cannot be determined.`, `${rule.number} ${name.ja}：「横ばい」が定義されていないため、「次に確認すること」の分岐を判定できません。`);
  }
  const roleJa: Record<string, string> = { total: '全体', organic: 'オーガニック流入', advertising: '広告流入' };
  for (const [role, m] of Object.entries(cfg.segments))
    if (!m.confirmed) add(`ga4.segments.${role}`, `GA4 segment "${m.value}" is used as ${role} traffic — not confirmed by the client.`, `GA4 セグメント「${m.value}」を${roleJa[role]}として使用 — クライアント未確認。`);
  if (!cfg.metricNames.cv.confirmed) {
    const cols = cfg.metricNames.cv.value.map((n) => `"${n}"`).join(' / ');
    add('ga4.metrics.cv', `CV is read from GA4 column ${cols} — not confirmed by the client.`, `CV は GA4 の列 ${cols} から取得 — クライアント未確認。`);
  }
  if (!cfg.brandTerms.confirmed)
    add('gsc.brand_terms', 'Brand query classification uses a provisional term list (reproduces the 66% cited in SEO.txt) — rule not supplied by the client.', 'ブランドクエリの分類は暫定の語句リストを使用（SEO.txt の 66% を再現）— クライアントからルール未提供。');
  return items;
}

export function configSummary(cfg: AppConfig): ConfigSummary {
  return { rules: cfg.rules, unresolved: unresolvedItems(cfg) };
}
