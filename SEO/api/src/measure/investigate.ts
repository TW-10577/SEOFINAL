// Rule ① follow-up (SEO.txt "What to Check Next"):
//   organic traffic decreases → provide feedback to the SEO team; advertising traffic decreases → feedback to
//   the advertising team. The countermeasure is the client's action; the investigation below only collects
//   the evidence that goes with that feedback.
// The possible cause uses only the Search Console meanings the client gave (SEO.txt):
//   Position worse = ranking dropped · Impressions ↓ = fewer searches · CTR ↓ = title/snippet problem.
// The client gives no magnitude for these signals, so they are read by direction only and never raise
// confidence to High. Nothing here confirms a cause — the SEO team does.
import type { Confidence, EvidenceItem, EvidenceTable, GscInvestigation, GscSupportingEvidence, Period } from '@seo/shared';
import { scopeIds, type AppConfig } from '../config.ts';
import type { DB } from '../db.ts';
import { cat, dec, enc, tx, type LText } from '../i18n.ts';
import { buildGscEvidence, type GscSignalKey } from './gsc-evidence.ts';
import { change, fmtNum, fmtPct, type Change } from './logic.ts';
import { daysOf, dailySeries, type DailySeries } from './series.ts';

/**
 * search_decline: the GSC date chart for the same weeks shows organic search clicks ↓ → cause determined ·
 * no_search_decline: the chart covers the weeks but clicks did not fall · undetermined: no chart for the weeks.
 */
export type CauseCase = 'search_decline' | 'no_search_decline' | 'undetermined';
export type Channel = 'organic' | 'advertising';

export interface CauseAnalysis {
  channel: Channel;
  case: CauseCase;
  /** SEO.txt signals observed in Search Console for the measured weeks. */
  signals: GscSignalKey[];
  /** The evidence determines a possible cause; only then is a countermeasure proposed. */
  determined: boolean;
  /** Search Console supporting evidence (organic finding only). */
  gscEvidence: GscSupportingEvidence | null;
  /** Possible cause — a hypothesis, never a confirmed cause. */
  title: LText;
  /** Detected facts (numbers), kept separate from the interpretation. */
  facts: LText[];
  affectedMetric: LText;
  contribution: LText | null;
  /** Pages / queries with the largest clicks decrease, when weekly exports exist (system analysis). */
  affected: EvidenceTable | null;
  /** Data that would be needed to determine or confirm the cause. */
  missing: LText[];
  limitation: LText | null;
  /** rules.yaml investigation (GSC_R01) run for this anomaly. */
  investigation?: GscInvestigation | null;
}

export type TargetType = 'site' | 'traffic_source' | 'page' | 'search_query';

export interface Finding {
  analysis: CauseAnalysis;
  confidence: Confidence;
  confidenceReason: LText;
  /** Proposed only when the cause is determined; null otherwise. */
  countermeasure: { action: LText; reason: LText; target: LText; targetType: TargetType; targetKey: string; team: LText | null } | null;
  evidence: { items: EvidenceItem[]; tables: EvidenceTable[] };
  importedDataIds: number[];
}

interface Periods {
  current: Period;
  previous: Period;
}

const e = (en: string, ja: string) => enc(tx(en, ja));
const range = (p: Period) => `${p.start} – ${p.end}`;
const pct = (v: number | null) => (v === null ? '—' : fmtPct(v));

// ---------------------------------------------------------------- GA4 daily trend

function dailyTrend(series: DailySeries, periods: Periods, label: LText): { table: EvidenceTable; daysDown: number; ids: number[] } {
  const prevDays = daysOf(periods.previous);
  const curDays = daysOf(periods.current);
  let daysDown = 0;
  const ids: number[] = [];
  const rows = curDays.map((d, i) => {
    const p = series.byDate.get(prevDays[i]!);
    const c = series.byDate.get(d);
    if (p) ids.push(p.importedDataId);
    if (c) ids.push(c.importedDataId);
    const ch = p && c ? change(p.value, c.value) : null;
    if (ch && ch.abs < 0) daysDown++;
    return [prevDays[i]!, p?.value ?? null, d, c?.value ?? null, ch?.abs ?? null, ch ? fmtPct(ch.rate) : '—'];
  });
  return {
    daysDown,
    ids,
    table: {
      group: 'daily',
      title: e(`Daily trend — ${label.en} sessions, same weekday previous week vs current week (GA4)`, `日次推移 — ${label.ja}のセッション、前週同曜日と今週（GA4）`),
      columns: [e('Previous day', '前週の日'), e('Sessions', 'セッション'), e('Current day', '今週の日'), e('Sessions', 'セッション'), e('Change', '変化'), e('Change rate', '変化率')],
      rows,
    } as EvidenceTable,
  };
}


// ---------------------------------------------------------------- weekly page / query exports

interface Breakdown {
  dim: 'page' | 'query';
  table: EvidenceTable;
  top: { key: string; change: number; share: number | null }[];
  totalChange: number;
  ids: number[];
}

/** Per-page / per-query clicks change, from GSC exports whose periods are exactly the two measured weeks. */
async function weeklyBreakdown(db: DB, periods: Periods, dim: 'page' | 'query', ids?: number[]): Promise<Breakdown | null> {
  const col = dim === 'page' ? 'page_url' : 'query';
  const upload = (p: Period) =>
    db.value<number>(
        `SELECT id FROM uploads WHERE source = 'GSC' AND import_status = 'imported' AND structure = ? AND analysis_period_start = ? AND analysis_period_end = ?${ids ? ` AND id IN (${ids.map(() => '?').join(',') || 'NULL'})` : ''} ORDER BY id DESC LIMIT 1`,
        `gsc-${dim}`,
        p.start,
        p.end,
        ...(ids ?? []),
    );
  const prevId = await upload(periods.previous);
  const curId = await upload(periods.current);
  if (!prevId || !curId) return null;
  const read = async (id: number) =>
    new Map(
      (await db.all<{ k: string; v: number; id: number }>(`SELECT ${col} AS k, metric_value AS v, id FROM imported_data WHERE upload_id = ? AND metric_name = 'clicks' AND is_valid = 1`, id)).map((r) => [r.k, r]),
    );
  const prev = await read(prevId);
  const cur = await read(curId);
  // Search Console omits rows (row cap, privacy filtering), so a key missing from one week's export is
  // "not in export", not 0 clicks: only keys present in both weeks are compared.
  const both = [...prev.keys()].filter((k) => cur.has(k));
  const onlyOne = new Set([...prev.keys(), ...cur.keys()]).size - both.length;
  const rows = both.map((k) => {
    const p = prev.get(k)!;
    const c = cur.get(k)!;
    return { key: k, p: p.v, c: c.v, ch: change(p.v, c.v), ids: [p.id, c.id] };
  });
  const totalChange = rows.reduce((a, r) => a + r.ch.abs, 0);
  const decrease = rows.filter((r) => r.ch.abs < 0).reduce((a, r) => a + r.ch.abs, 0);
  const decliners = rows.filter((r) => r.ch.abs < 0).sort((a, b) => a.ch.abs - b.ch.abs).slice(0, 10);
  const share = (abs: number) => (decrease < 0 ? (abs / decrease) * 100 : null);
  const name = dim === 'page' ? tx('Page', 'ページ') : tx('Query', 'クエリ');
  const excluded = onlyOne
    ? tx(` ${onlyOne} ${dim === 'page' ? 'page(s)' : 'query(ies)'} appear in only one week's export and are not compared (not in export ≠ 0 clicks).`, ` 一方の週のエクスポートにしかない${name.ja} ${onlyOne} 件は比較していません（エクスポートにない ≠ 0 クリック）。`)
    : tx('');
  return {
    dim,
    totalChange,
    ids: decliners.flatMap((r) => r.ids),
    top: decliners.map((r) => ({ key: r.key, change: r.ch.abs, share: share(r.ch.abs) })),
    table: {
      group: 'detail',
      title: e(`System analysis — ${name.en.toLowerCase()}s with the largest clicks decrease (GSC, week on week)`, `システム分析 — クリック数の減少が大きい${name.ja}（GSC、前週比）`),
      note: e(
        `Not a client rule: shows where the decrease is concentrated. Contribution = the ${dim}'s decrease ÷ the sum of all ${dim} decreases (${fmtNum(decrease)} clicks).${excluded.en}`,
        `クライアントルールではありません：減少の集中箇所を示します。寄与 = その${name.ja}の減少 ÷ ${name.ja}全体の減少合計（${fmtNum(decrease)} クリック）。${excluded.ja}`,
      ),
      columns: [enc(name), e('Previous', '前期'), e('Current', '今期'), e('Change', '変化'), e('Change rate', '変化率'), e('Contribution', '寄与')],
      rows: decliners.map((r) => [r.key, r.p, r.c, r.ch.abs, fmtPct(r.ch.rate), share(r.ch.abs) === null ? '—' : `${share(r.ch.abs)!.toFixed(1)}%`]),
    } as EvidenceTable,
  };
}

// ---------------------------------------------------------------- organic

const ARROW: Record<string, LText> = { down: tx('↓'), up: tx('↑'), same: tx('→ same', '→ 横ばい'), worse: tx('worse', '悪化'), better: tx('better', '改善') };


export async function investigateOrganic(db: DB, cfg: AppConfig, periods: Periods, organic: Change, contribution: number | null, series: DailySeries, segment: string): Promise<Finding> {
  const facts: LText[] = [];
  const missing: LText[] = [];
  const items: EvidenceItem[] = [];
  const tables: EvidenceTable[] = [];
  const ids: number[] = [];

  // GA4 facts
  const share = contribution === null ? '' : `, ${contribution.toFixed(1)}% of the total session decrease`;
  const shareJa = contribution === null ? '' : `（全体セッション減少の ${contribution.toFixed(1)}%）`;
  facts.push(tx(`GA4: organic sessions decreased by ${fmtNum(-organic.abs)} (${fmtPct(organic.rate)})${share}.`, `GA4：オーガニック流入のセッションが ${fmtNum(-organic.abs)} 減少（${fmtPct(organic.rate)}）${shareJa}。`));
  const trend = dailyTrend(series, periods, tx('organic', 'オーガニック流入'));
  tables.push(trend.table);
  ids.push(...trend.ids);
  facts.push(tx(`GA4: organic sessions were lower than the same weekday of the previous week on ${trend.daysDown} of 7 days.`, `GA4：7 日中 ${trend.daysDown} 日で、前週同曜日よりオーガニックのセッションが少なくなっています。`));

  // GSC supporting evidence: Chart by Date (current vs previous week) + snapshots (pages, queries, devices, countries).
  const gsc = await buildGscEvidence(db, cfg, periods);
  ids.push(...gsc.importedDataIds);
  const kase: CauseCase = !gsc.dailyAligned ? 'undetermined' : gsc.clicksDown ? 'search_decline' : 'no_search_decline';
  const chart = gsc.evidence.dateChart;
  const changed = (m: string) => chart.metrics.find((x) => x.metric === m);
  if (gsc.dailyAligned) {
    const word = (m: string, en: string, ja: string) => {
      const x = changed(m);
      const detail = x && (x.metric === 'position' ? `${x.previous.toFixed(2)} → ${x.current.toFixed(2)}` : fmtPct(x.changeRate));
      return x ? tx(`${en} ${ARROW[x.direction]!.en} (${detail})`, `${ja} ${ARROW[x.direction]!.ja}（${detail}）`) : null;
    };
    const parts = [word('clicks', 'clicks', 'クリック数'), word('impressions', 'impressions', '表示回数'), word('ctr', 'CTR', 'CTR'), word('position', 'position', '掲載順位')].filter((x): x is LText => !!x);
    facts.push(tx(`GSC Chart by Date (same weeks): ${parts.map((x) => x.en).join(', ')}.`, `GSC 日付別チャート（同じ週）：${parts.map((x) => x.ja).join('、')}。`));
  } else {
    missing.push(
      tx(
        `GSC Chart by Date (daily clicks, impressions, CTR, position) covering ${range(periods.previous)} and ${range(periods.current)} — ${chart.upload ? 'the uploaded chart does not cover these weeks' : 'none is uploaded'}.`,
        `${range(periods.previous)} と ${range(periods.current)} を含む GSC 日付別チャート（日次のクリック数・表示回数・CTR・掲載順位）— ${chart.upload ? 'アップロード済みのチャートはこの週を含みません' : 'アップロードされていません'}。`,
      ),
    );
  }

  // Where clicks fell, when one page / query export per measured week is uploaded (system analysis).
  const pages = await weeklyBreakdown(db, periods, 'page', scopeIds(cfg, 'GSC'));
  const queries = await weeklyBreakdown(db, periods, 'query', scopeIds(cfg, 'GSC'));
  for (const b of [pages, queries]) if (b) (tables.push(b.table), ids.push(...b.ids));
  const detail = pages && pages.top.length ? pages : queries && queries.top.length ? queries : null;

  // Possible cause (hypothesis) and confidence
  const signals = gsc.signals;
  const decreased = (['clicks', 'impressions', 'ctr'] as const).filter((m) => changed(m)?.direction === 'down');
  const NAME = { clicks: tx('clicks', 'クリック数'), impressions: tx('impressions', '表示回数'), ctr: tx('CTR', 'CTR') };
  const evidenceText = cat(
    [
      decreased.length ? tx(`GSC ${decreased.map((m) => NAME[m].en).join('/')} decreased`, `GSC の${decreased.map((m) => NAME[m].ja).join('・')}が減少`) : tx(''),
      changed('position')?.direction === 'worse' ? tx(`${decreased.length ? 'and ' : ''}position worsened`, `${decreased.length ? '、' : ''}掲載順位が悪化`) : tx(''),
    ],
    ' ',
    '',
  );
  const title =
    kase === 'search_decline'
      ? tx(
          `Organic search performance may have weakened. Evidence: ${evidenceText.en}.${chart.indicationText ? ` ${dec(chart.indicationText).en}` : ''}`,
          `オーガニック検索のパフォーマンスが弱まった可能性があります。根拠：${evidenceText.ja}。${chart.indicationText ? dec(chart.indicationText).ja : ''}`,
        )
      : kase === 'no_search_decline'
        ? tx('Not explained by Search Console — organic search clicks did not decrease in the same weeks', 'Search Console では説明できません — 同じ週のオーガニック検索のクリック数は減少していません')
        : tx('Cause cannot be determined from available data', '利用可能なデータからは原因を特定できません');
  const confidence: Confidence = kase === 'search_decline' ? 'Medium' : 'Low';
  const confidenceReason =
    kase === 'search_decline'
      ? tx(
          'The Search Console Chart by Date for the same weeks shows organic search clicks decreased. Signals are read by direction only (SEO.txt gives no size), so confidence is not High.',
          '同じ週の Search Console 日付別チャートでオーガニック検索のクリック数が減少しています。シグナルは方向のみで判定しており（SEO.txt に大きさの定義なし）、信頼度は高ではありません。',
        )
      : kase === 'no_search_decline'
        ? tx('Search Console clicks for the same weeks did not decrease, so the data does not explain the GA4 organic decrease.', '同じ週の Search Console のクリック数は減少しておらず、データでは GA4 のオーガニック流入の減少を説明できません。')
        : tx('No Search Console Chart by Date for the measured weeks, so organic search performance cannot be checked.', '測定週の Search Console 日付別チャートがないため、オーガニック検索のパフォーマンスを確認できません。');
  const mappings = (['organic'] as const).filter((r) => !cfg.segments[r].confirmed).map((r) => cfg.segments[r].value);
  const limitation = cat(
    [
      tx('The exact SEO cause cannot be confirmed from this data.', 'このデータから正確な SEO の原因は確認できません。'),
      mappings.length ? tx(`GA4 segment "${mappings.join('", "')}" as organic traffic is not confirmed by the client.`, `GA4 セグメント「${mappings.join('」「')}」をオーガニック流入とする対応はクライアント未確認です。`) : tx(''),
    ],
    ' ',
  );

  const determined = kase === 'search_decline';
  return {
    analysis: {
      channel: 'organic',
      case: kase,
      signals,
      determined,
      gscEvidence: gsc.evidence,
      title,
      facts,
      affectedMetric: tx('Organic sessions (GA4); clicks, impressions, CTR and position (GSC)', 'オーガニックのセッション（GA4）、クリック数・表示回数・CTR・掲載順位（GSC）'),
      contribution: contribution === null ? null : tx(`${contribution.toFixed(1)}% of the total session decrease`, `全体セッション減少の ${contribution.toFixed(1)}%`),
      affected: detail?.table ?? null,
      missing,
      limitation,
    },
    confidence,
    confidenceReason,
    // The countermeasure comes from the rules.yaml branch; the investigation only adds evidence.
    countermeasure: null,
    evidence: { items, tables },
    importedDataIds: ids,
  };
}

// ---------------------------------------------------------------- advertising

export function investigateAdvertising(cfg: AppConfig, periods: Periods, advertising: Change, contribution: number | null, series: DailySeries, segment: string): Finding {
  const facts: LText[] = [];
  const share = contribution === null ? '' : `, ${contribution.toFixed(1)}% of the total session decrease`;
  const shareJa = contribution === null ? '' : `（全体セッション減少の ${contribution.toFixed(1)}%）`;
  facts.push(tx(`GA4: advertising sessions decreased by ${fmtNum(-advertising.abs)} (${fmtPct(advertising.rate)})${share}.`, `GA4：広告流入のセッションが ${fmtNum(-advertising.abs)} 減少（${fmtPct(advertising.rate)}）${shareJa}。`));
  const trend = dailyTrend(series, periods, tx('advertising', '広告流入'));
  facts.push(tx(`GA4: advertising sessions were lower than the same weekday of the previous week on ${trend.daysDown} of 7 days.`, `GA4：7 日中 ${trend.daysDown} 日で、前週同曜日より広告のセッションが少なくなっています。`));
  const title = tx('Cause cannot be determined from available data', '利用可能なデータからは原因を特定できません');
  return {
    analysis: {
      channel: 'advertising',
      case: 'undetermined',
      signals: [],
      determined: false,
      gscEvidence: null,
      title,
      facts,
      affectedMetric: tx('Advertising sessions (GA4)', '広告流入のセッション（GA4）'),
      contribution: contribution === null ? null : tx(`${contribution.toFixed(1)}% of the total session decrease`, `全体セッション減少の ${contribution.toFixed(1)}%`),
      affected: null,
      missing: [tx(`Only GA4 sessions are uploaded for advertising traffic; no other advertising data exists for ${range(periods.previous)} and ${range(periods.current)}.`, `広告流入は GA4 のセッションのみがアップロードされており、${range(periods.previous)} と ${range(periods.current)} のその他の広告データはありません。`)],
      limitation: tx('GA4 shows that advertising sessions decreased, but not why.', 'GA4 では広告流入の減少は分かりますが、理由は分かりません。'),
    },
    confidence: 'Low',
    confidenceReason: tx('Only GA4 sessions are available for advertising traffic.', '広告流入は GA4 のセッションしかありません。'),
    // GA4 alone does not show why advertising traffic fell, so no countermeasure is proposed yet.
    countermeasure: null,
    evidence: { items: [], tables: [trend.table] },
    importedDataIds: trend.ids,
  };
}
