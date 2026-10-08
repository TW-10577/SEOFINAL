// Decides whether a table is GA4 or Google Search Console data from its contents — never from the file name.
//   1. Layout: a recognised GA4 Explorations or Search Console Performance export.
//   2. Fields: GA4-specific fields (sessions, users, engagement, conversions …) versus
//      GSC-specific fields (clicks, impressions, CTR, position, query, page …) in the header cells.
// When neither is clearly ahead the source is unknown and the SEO team is asked to choose.
import type { Source } from '@seo/shared';
import { looksLikeGa4 } from './ga4.ts';
import type { Grid } from './grid.ts';
import { looksLikeGsc } from './gsc.ts';

export type DetectionMethod = 'layout' | 'fields' | 'user' | 'none';

export interface SourceDetection {
  source: Source | null;
  method: DetectionMethod;
  /** Field names that pointed at the source, as they appear in the file. */
  signals: string[];
}

// Header terms, lower-case. 表示回数 is GSC "impressions" (in GA4 Japanese UI it means views), so it counts for GSC only.
const GA4_FIELDS = [
  'セッション', 'sessions', 'session', 'ユーザー', 'users', 'アクティブ ユーザー', 'active users', 'activeusers', '新規ユーザー', 'new users', 'newusers',
  'エンゲージメント', 'engagement', 'engagement rate', 'engagementrate', 'engaged sessions', 'engagedsessions', 'エンゲージのあったセッション数',
  'コンバージョン', 'conversions', 'キーイベント', 'key events', 'keyevents', 'e コマース購入数', 'ecommerce purchases', 'ecommercepurchases',
  'トランザクション', 'transactions', '収益', 'revenue', 'purchase revenue', 'purchaserevenue', '直帰率', 'bounce rate', 'bouncerate',
  'イベント数', 'event count', 'eventcount', 'セッションのデフォルト チャネル グループ', 'session default channel group', 'sessiondefaultchannelgroup',
  'dau/wau', 'セグメント', 'segment',
];
const GSC_FIELDS = [
  'クリック数', 'clicks', '表示回数', 'impressions', 'ctr', '掲載順位', 'position', 'average position', 'avg. position',
  '上位のクエリ', 'top queries', 'クエリ', 'query', 'queries', '上位のページ', 'top pages', 'ページ', 'page', 'landing page url',
  '検索での見え方', 'search appearance', 'デバイス', 'device', '国', 'country',
];

const norm = (s: string) => s.replace(/^﻿/, '').trim().toLowerCase();

/** Field-name evidence in the first rows of a table (header rows sit at the top). */
export function fieldSignals(grid: Grid): { ga4: string[]; gsc: string[] } {
  const ga4 = new Set<string>();
  const gsc = new Set<string>();
  for (const row of grid.rows.slice(0, 15))
    for (const cell of row) {
      const c = norm(cell);
      if (!c || c.length > 60) continue;
      if (GA4_FIELDS.includes(c)) ga4.add(cell.trim());
      if (GSC_FIELDS.includes(c)) gsc.add(cell.trim());
    }
  return { ga4: [...ga4], gsc: [...gsc] };
}

export function detectSource(grid: Grid): SourceDetection {
  const signals = fieldSignals(grid);
  if (looksLikeGa4(grid)) return { source: 'GA4', method: 'layout', signals: signals.ga4 };
  if (looksLikeGsc(grid)) return { source: 'GSC', method: 'layout', signals: signals.gsc };
  // Fields only: confident when one side has at least two fields and clearly more than the other.
  const a = signals.ga4.length;
  const g = signals.gsc.length;
  if (a >= 2 && a > g) return { source: 'GA4', method: 'fields', signals: signals.ga4 };
  if (g >= 2 && g > a) return { source: 'GSC', method: 'fields', signals: signals.gsc };
  return { source: null, method: 'none', signals: [...signals.ga4, ...signals.gsc] };
}
