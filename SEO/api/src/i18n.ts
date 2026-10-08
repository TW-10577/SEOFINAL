import { translateDataTerms } from '@seo/shared';

// Bilingual server text. Generated messages are built as { en, ja } and stored as JSON in TEXT
// columns (or inside evidence JSON); responses are localized to the requested language at the edge.
export type Lang = 'en' | 'ja';

export interface LText {
  en: string;
  ja: string;
}

export const tx = (en: string, ja: string = en): LText => ({ en, ja });

/** Joins parts; Japanese sentences are joined without the space English needs. */
export function cat(parts: (LText | string)[], sep = ' ', jaSep = sep === ' ' ? '' : sep): LText {
  const list = parts.filter((p) => (typeof p === 'string' ? p : p.en) !== '');
  return {
    en: list.map((p) => (typeof p === 'string' ? p : p.en)).join(sep),
    ja: list.map((p) => (typeof p === 'string' ? p : p.ja)).join(jaSep),
  };
}

/** Serialized form for fields typed as string (DB columns, shared types). */
export const enc = (t: LText): string => JSON.stringify(t);

const isLText = (v: unknown): v is LText =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 2 && 'en' in v && 'ja' in v;

/** Reads a stored value back as LText (plain strings are the same in both languages). */
export function dec(v: string | LText | null | undefined): LText {
  if (v == null) return tx('');
  if (typeof v !== 'string') return v;
  if (v.startsWith('{"en":')) {
    try {
      const o = JSON.parse(v);
      if (isLText(o)) return o;
    } catch {
      /* not bilingual */
    }
  }
  return tx(v);
}

/** The text in `lang`; English text also gets English names for the client's Japanese data terms. */
export function loc(v: string | LText | null | undefined, lang: Lang): string {
  const t = dec(v);
  return lang === 'en' ? translateDataTerms(t.en, false) : t.ja;
}

/** Deep-localizes a response: every { en, ja } object or encoded string becomes the chosen language. */
export function localize<T>(v: T, lang: Lang): T {
  if (typeof v === 'string') return (v.startsWith('{"en":') ? loc(v, lang) : v) as T;
  if (Array.isArray(v)) return v.map((x) => localize(x, lang)) as T;
  if (isLText(v)) return loc(v, lang) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = localize(x, lang);
    return out as T;
  }
  return v;
}

export const langOf = (v: string | null | undefined): Lang => (v?.toLowerCase().startsWith('ja') ? 'ja' : 'en');
