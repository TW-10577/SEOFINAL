// Data the export itself marks as not real. GA4 exports carry "#" header notes; the client's test file says
//   "# Real data: 20260910-20260915" / "# Fake data: 20260916-20260923".
// A note naming a fake / dummy / synthetic date range marks those dates; a note that only says the file
// contains such data (no range of its own) marks the whole upload. The file name is never used.
import type { Period } from '@seo/shared';
import type { DB } from '../db.ts';
import { parseDate } from './grid.ts';

const SYNTHETIC = /fake|dummy|synthetic|ダミー|架空/i;
const LABELLED_RANGE = /^(?:fake|dummy|synthetic|ダミー|架空)[^:：]*[:：]\s*(\d{8})\s*[-–~〜]\s*(\d{8})/i;

export type SyntheticMark = Period[] | 'all';

export function syntheticRanges(comments: string[]): SyntheticMark | null {
  const ranges: Period[] = [];
  for (const c of comments) {
    const m = LABELLED_RANGE.exec(c.trim());
    const start = m && parseDate(m[1]!);
    const end = m && parseDate(m[2]!);
    if (start && end) ranges.push({ start, end });
  }
  if (ranges.length) return ranges;
  return comments.some((c) => SYNTHETIC.test(c)) ? 'all' : null;
}

/** Synthetic marks per upload, from the export notes kept in uploads.metadata_json. */
export async function syntheticMarks(db: DB): Promise<Map<number, SyntheticMark>> {
  const out = new Map<number, SyntheticMark>();
  const rows = await db.all<{ id: number; metadata_json: string }>(`SELECT id, metadata_json FROM uploads WHERE import_status = 'imported'`);
  for (const r of rows) {
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(r.metadata_json);
    } catch {
      continue;
    }
    const comments = Object.values(meta).flatMap((v) =>
      v && typeof v === 'object' && Array.isArray((v as { exportComments?: unknown }).exportComments) ? ((v as { exportComments: string[] }).exportComments) : [],
    );
    const mark = syntheticRanges(comments);
    if (mark) out.set(r.id, mark);
  }
  return out;
}

export function isSynthetic(mark: SyntheticMark | undefined, date: string): boolean {
  if (!mark) return false;
  return mark === 'all' || mark.some((p) => date >= p.start && date <= p.end);
}
