// Weekly SEO report: a short business summary of one measurement run, built from its stored results.
// The report is a generated view (ontology: not a persistent object); it is rebuilt on every request.
import type { CauseAnalysis as CauseHypothesisAnalysis, GscInvestigation, GscSnapshot, Report, ReportBlock, ReportDoc } from '@seo/shared';
import type { AppConfig } from './config.ts';
import { nowIso, type DB } from './db.ts';
import { localize, tx, type Lang, type LText } from './i18n.ts';
import { translateDataTerms } from '@seo/shared';
import { fmtNum, fmtPct } from './measure/logic.ts';
import {
  getCause,
  getRun,
  listAnomalies,
  listCountermeasures,
  listMeasurements,
} from './measure/read.ts';


const METRIC_LABEL: Record<string, LText> = {
  sessions: tx('Sessions', 'セッション'),
  cv: tx('CV'),
  cvr: tx('CVR (%)'),
  clicks: tx('Clicks', 'クリック数'),
  impressions: tx('Impressions', '表示回数'),
  ctr: tx('CTR (%)'),
  position: tx('Avg. position', '平均掲載順位'),
};

const STATE_JA: Record<string, string> = {
  Detected: '検知', Triaged: 'トリアージ済', CountermeasureAssigned: '対策割当済', Resolved: '解決', Dismissed: '対応不要',
  Proposed: '提案', Approved: '承認', InProgress: '実施中', Completed: '完了', VerifiedEffective: '効果あり（検証済）', VerifiedIneffective: '効果なし（検証済）',
  NotReviewed: '未レビュー', Confirmed: '確認済', Rejected: '却下', NeedsMoreEvidence: '追加根拠が必要',
  High: '高', Medium: '中', Low: '低', anomaly: '異常', cause: '原因', countermeasure: '対策',
  valid: '有効', valid_with_warnings: '警告あり', invalid: '無効',
  percent: '%（相対）', percentage_points: 'パーセントポイント', unresolved: '未解決',
};

/** Builds the report from the database on request; nothing is stored (a report is a generated view). */
export async function generateReport(db: DB, cfg: AppConfig, runId: number, lang: Lang = 'en'): Promise<Report> {
  const doc = await buildReportDoc(db, cfg, runId, lang);
  const generatedAt = nowIso();
  return { runId, fileName: `LOGOS_SEO_Report_${generatedAt.slice(0, 10)}.txt`, generatedAt, content: renderText(doc), doc };
}

export async function buildReportText(db: DB, cfg: AppConfig, runId: number, lang: Lang = 'en'): Promise<string> {
  return renderText(await buildReportDoc(db, cfg, runId, lang));
}

/**
 * The business report: short and readable, built only from the run's stored results (no second calculation).
 * Analysis Summary → Measurement Summary (M1/M2) → Anomaly (if NG) → Supporting Evidence (M1 NG + organic ↓)
 * → Cause → Countermeasure. Raw data, calculation tables and decision logs stay on the Data / Measurements pages.
 */
export async function buildReportDoc(db: DB, cfg: AppConfig, runId: number, lang: Lang = 'en'): Promise<ReportDoc> {
  const run = localize(await getRun(db, runId), lang);
  if (!run) throw new Error(`Measurement run ${runId} not found.`);
  const L = (en: string, ja: string) => (lang === 'ja' ? ja : en);
  const S = (v: string) => (lang === 'ja' ? (STATE_JA[v] ?? v) : v);
  const RESULT = (s: string) => (s === 'NOT_EVALUABLE' ? L('NOT EVALUABLE', '評価不可') : s);
  const measurements = localize(await listMeasurements(db, cfg, runId), lang);
  const doc: ReportDoc = { title: L('LOGOS SEO Weekly Report', 'LOGOS SEO 週次レポート'), sections: [] };
  let n = 0;
  let cur: ReportBlock[] = [];
  const section = (en: string, ja: string) => {
    cur = [];
    doc.sections.push({ n: ++n, title: L(en, ja), blocks: cur });
  };
  const add = (...b: ReportBlock[]) => cur.push(...b);
  const p = (text: string, tone?: 'muted' | 'warn'): ReportBlock => ({ t: 'p', text, tone });
  // Results labelled TEST DATA: the explanation is said once (in the summary), not in every reason.
  const testData = measurements.some((m) => m.dataKind === 'test');
  const clean = (reason: string) => reason.replace(/^Based on data the export marks as not real — not a business result\.\s*/, '').replace(/^エクスポートで実データではないとされたデータに基づく結果です — 業務上の結果ではありません。/, '');
  const changeText = (m: (typeof measurements)[number]) =>
    m.changeRate === null ? '—' : m.metric === 'cvr' && m.absoluteChange !== null ? `${fmtPct(m.changeRate)} (${m.absoluteChange > 0 ? '+' : ''}${m.absoluteChange.toFixed(3)} pt)` : fmtPct(m.changeRate);
  const thresholdText = (m: (typeof measurements)[number]) =>
    m.thresholdValue === null
      ? L('not configured', '未設定')
      : m.thresholdUnit === 'percent'
        ? `±${m.thresholdValue}%`
        : m.thresholdUnit === 'percentage_points'
          ? `±${m.thresholdValue} pt`
          : `±${m.thresholdValue}% ${L('(unit pending)', '（単位確認待ち）')}`;
  /** Why a rule could not be evaluated, in one line. */
  const notEvaluableReason = (m: (typeof measurements)[number]) =>
    m.thresholdUnit === 'unresolved'
      ? L('The client has not confirmed whether the threshold is a relative % or percentage points.', '閾値が相対 % かパーセントポイントかがクライアント未確認です。')
      : clean(m.reason).split(/(?<=[.。])\s/)[0]!;
  const short = (m: (typeof measurements)[number]) => m.name.replace(/^[①②③④⑤]\s*/, '').split(' — ')[0]!;

  // Direction of the judged change: an increase is a positive change, never shown as a problem.
  const positive = (m: (typeof measurements)[number]) => (m.changeRate ?? m.absoluteChange ?? 0) > 0;
  const kind = (m: (typeof measurements)[number]) =>
    m.status !== 'NG' ? '' : positive(m) ? L('Significant Positive Change', '有意なプラスの変化') : L('Significant Negative Change', '有意なマイナスの変化');
  const resultText = (m: (typeof measurements)[number]) => (m.status === 'NG' ? `NG — ${kind(m)}` : RESULT(m.status));

  // ---- facts for the header and executive summary ----
  const ng = measurements.filter((m) => m.status === 'NG');
  const ok = measurements.filter((m) => m.status === 'OK');
  const ne = measurements.filter((m) => m.status === 'NOT_EVALUABLE');
  const overall = ng.length ? 'NG' : ok.length ? 'OK' : 'NOT_EVALUABLE';
  const overallNote = ng.length
    ? L(`${ng.length} significant change(s) detected.`, `有意な変化を ${ng.length} 件検知しました。`)
    : overall === 'OK'
      ? ne.length
        ? L('No significant change detected; some rules could not be evaluated.', '有意な変化はありません。一部のルールは評価できませんでした。')
        : L('No significant change detected.', '有意な変化はありません。')
      : L('The rules could not be evaluated.', 'ルールを評価できませんでした。');
  // Distinct (file, source) pairs in upload order.
  const used = await db.all<{ f: string; s: string }>(
    `SELECT u.file_name AS f, u.source AS s FROM measurement_sources ms JOIN measurements m ON m.id = ms.measurement_id JOIN imported_data d ON d.id = ms.imported_data_id
     JOIN uploads u ON u.id = d.upload_id WHERE m.run_id = ? GROUP BY u.file_name, u.source ORDER BY MIN(u.id)`,
    runId,
  );
  const files = used.map((u) => u.f);
  const sources = [...new Set(used.map((u) => u.s))].sort();
  const sourceNames = sources.map((s) => (s === 'GSC' ? L('Google Search Console (investigation evidence)', 'Google Search Console（調査の根拠）') : 'Google Analytics 4 (GA4)'));
  const anomalies = await listAnomalies(db, runId);
  const items = ng.map((m) => ({ m, a: anomalies.find((x) => x.measurementId === m.id) ?? null }));
  const causes: { m: (typeof items)[number]['m']; a: (typeof items)[number]['a']; c: Awaited<ReturnType<typeof getCause>> }[] = [];
  for (const { m, a } of items) causes.push({ m, a, c: a ? localize(await getCause(db, a.id), lang) : null });
  // Most important finding: a negative change first (it needs action), then the largest change.
  const lead = [...ng].sort((x, y) => Number(positive(x)) - Number(positive(y)) || Math.abs(y.changeRate ?? 0) - Math.abs(x.changeRate ?? 0))[0];
  const keyFinding = lead
    ? L(
        `${short(lead)} ${positive(lead) ? 'increased' : 'decreased'} ${changeText(lead)} week on week (${fmtVal(lead.metric, lead.previousValue)} → ${fmtVal(lead.metric, lead.currentValue)}), beyond the ${thresholdText(lead)} threshold.`,
        `${short(lead)}が前週比 ${changeText(lead)} ${positive(lead) ? '増加' : '減少'}しました（${fmtVal(lead.metric, lead.previousValue)} → ${fmtVal(lead.metric, lead.currentValue)}）。閾値 ${thresholdText(lead)} を超えています。`,
      )
    : overall === 'OK'
      ? L('All evaluated measurements stayed within their thresholds.', '評価したすべての測定は閾値内でした。')
      : L('No measurement could be evaluated for this period.', 'この期間はどの測定も評価できませんでした。');
  doc.title = L('SEO Performance Report', 'SEO パフォーマンスレポート');
  doc.meta = { runId, dataSources: sourceNames, files, overall, evaluated: ok.length + ng.length, ok: ok.length, ng: ng.length, notEvaluable: ne.length, keyFinding };

  // ---- 1. Analysis Summary (report header + executive summary) ----
  section('Analysis Summary', '分析サマリー');
  add(
    {
      t: 'kv',
      rows: [
        [L('Analysis period', '分析期間'), `${run.current.start} – ${run.current.end}`],
        [L('Compared with', '比較対象'), `${run.previous.start} – ${run.previous.end}`],
        [L('Data source', 'データソース'), sourceNames.length ? sourceNames.join(', ') : L('none', 'なし')],
        [L('Data files', 'データファイル'), files.length ? files.join(', ') : L('none', 'なし')],
        [L('Run', '実行'), `#${runId}`],
        [L('Generated', '生成日時'), when(nowIso())],
      ],
    },
    { t: 'status', status: overall, label: RESULT(overall), title: L('Overall result', '総合結果'), meta: overallNote },
    {
      t: 'kv',
      rows: [
        [L('Measurements evaluated', '評価した測定'), String(ok.length + ng.length) + (ne.length ? L(` (${ne.length} not evaluable)`, `（評価不可 ${ne.length} 件）`) : '')],
        [L('OK', 'OK'), String(ok.length)],
        [L('NG (significant change)', 'NG（有意な変化）'), String(ng.length)],
        [L('Key finding', '主な所見'), keyFinding],
      ],
    },
  );
  if (testData) add(p(L('Includes dates the uploaded file marks as test (fake) data — not business results.', 'アップロードしたファイルでテスト（フェイク）データとされた日付を含みます — 業務上の結果ではありません。'), 'warn'));

  // ---- 2. Measurement Summary ----
  section('Measurement Summary', '測定サマリー');
  add({
    t: 'table',
    columns: [L('Measurement', '測定'), L('Metric', '指標'), L('Change', '変化'), L('Threshold', '閾値'), L('Result', '結果')],
    rows: measurements.map((m) => [short(m), METRIC_LABEL[m.metric]?.[lang] ?? m.metric, changeText(m), thresholdText(m), resultText(m)]),
  });
  if (ne.length) add({ t: 'list', items: ne.map((m) => `${short(m)} — ${L('NOT EVALUABLE', '評価不可')}: ${notEvaluableReason(m)}`) });

  // ---- 3. Detected Changes / Anomalies ----
  section('Detected Changes / Anomalies', '検知した変化 / 異常');
  if (!ng.length) {
    add(p(L('No significant change detected.', '有意な変化は検知されませんでした。')));
    return finish(doc, lang);
  }
  for (const { m, a } of items)
    add({
      t: 'group',
      title: `${short(m)} — ${kind(m)}`,
      status: a?.state,
      statusLabel: a ? S(a.state) : undefined,
      blocks: [
        {
          t: 'kv',
          rows: [
            [L('Current value', '今期の値'), fmtVal(m.metric, m.currentValue)],
            [L('Previous value', '前期の値'), fmtVal(m.metric, m.previousValue)],
            [L('Change', '変化'), changeText(m)],
            [L('Threshold', '閾値'), thresholdText(m)],
            [L('Result', '結果'), resultText(m)],
            [L('Why it was detected', '検知の理由'), clean(m.reason)],
            [L('Anomaly record', '異常レコード'), a ? `#${a.id} ${S(a.state)}` : '—'],
          ],
        },
      ],
    });

  // ---- 4. Investigation ----
  section('Investigation', '調査');
  for (const { m, c } of causes) {
    const an = c?.analysis ?? null;
    const inv = an?.investigation ?? null;
    const blocks: ReportBlock[] = [];
    const observed = an?.facts[0] ?? c?.supportingEvidence.items[0]?.value ?? clean(m.reason);
    blocks.push({ t: 'kv', rows: [[L('Observed', '観測された事実'), observed]] });
    // GA4 evidence: the figures behind the result (stored with the run).
    if (m.basis.length)
      blocks.push({
        t: 'table',
        title: L('GA4 evidence — supporting metrics', 'GA4 の根拠 — 関連指標'),
        columns: [L('Figure', '項目'), L('Previous', '前期'), L('Current', '今期'), L('Change', '変化')],
        rows: m.basis.map((b) => [b.label, fmtVal(b.metric, b.previous), fmtVal(b.metric, b.current), b.changeRate === null ? '—' : fmtPct(b.changeRate)]),
      });
    // GSC evidence: only when the investigation ran for this measurement.
    if (an?.gscEvidence) blocks.push(...gscSummary(an, L, lang, false).slice(0, 1));
    if (inv) blocks.push(...investigationBlocks(inv, L));
    // What to review: data the investigation could not use, and what the analysis says is missing.
    const review = [
      ...(inv ? inv.checks.filter((k) => !k.available).map((k) => `${k.id}: ${k.reason ?? ''}`) : []),
      ...(an?.missing ?? []),
    ];
    if (review.length) blocks.push(p(L('Data to review to understand the reason:', '理由を把握するために確認すべきデータ：')), { t: 'list', items: review });
    const conclusive = !!inv?.matched;
    blocks.push(
      conclusive
        ? p(L(`GSC investigation indicates: ${inv!.cause} (confidence: ${inv!.confidence}).`, `GSC の調査が示す内容：${inv!.cause}（信頼度：${inv!.confidence}）。`))
        : p(L('Cause not conclusively determined from available data.', '利用可能なデータからは原因を確定できません。'), 'warn'),
    );
    add({ t: 'group', title: short(m), blocks });
  }

  // ---- 5. Cause ----
  section('Cause', '原因');
  for (const { m, c } of causes) {
    if (!c) {
      add(p(`${short(m)}: ${L('No cause hypothesis was generated.', '原因仮説は生成されていません。')}`, 'muted'));
      continue;
    }
    const an = c.analysis;
    const inv = an?.investigation ?? null;
    const text = c.amendments.length ? c.causeText : an ? an.title : c.causeText;
    const rows: [string, string][] = [
      [L('Possible cause', '考えられる原因'), `${text}${c.amendments.length ? ` (${L('modified by', '修正者')} ${c.amendments.at(-1)!.actor})` : ''}`],
    ];
    if (an?.facts[0]) rows.push([L('Supporting evidence', '裏付けとなる根拠'), an.facts.slice(0, 2).join(' ')]);
    else if (c.supportingEvidence.items[0]) rows.push([L('Supporting evidence', '裏付けとなる根拠'), c.supportingEvidence.items.map((i) => i.value).join(' ')]);
    // A rule match proves the pattern in the numbers, not the business reason behind it.
    rows.push([L('Rule-match confidence', 'ルール該当の信頼度'), `${S(c.confidence)} — ${L('the GA4 values match the rules.yaml pattern (calculation)', 'GA4 の値が rules.yaml のパターンに該当（計算）')}`]);
    rows.push([
      L('Cause confidence', '原因の信頼度'),
      inv?.matched ? `${inv.confidence} — ${inv.ruleId}` : L('Not determined — hypothesis until the SEO team reviews the evidence', '未確定 — SEO チームが根拠を確認するまでは仮説'),
    ]);
    rows.push([L('Review status', 'レビュー状況'), S(c.reviewStatus)]);
    add({ t: 'group', title: short(m), status: c.reviewStatus, statusLabel: S(c.reviewStatus), blocks: [{ t: 'kv', rows }] });
  }

  // ---- 6. Recommended Action / Countermeasure ----
  section('Recommended Action / Countermeasure', '推奨アクション / 対策');
  const invIds = new Set(cfg.investigations.map((x) => x.id));
  const actions: { m: (typeof causes)[number]['m']; k: Awaited<ReturnType<typeof listCountermeasures>>[number] }[] = [];
  for (const { m, c } of causes) for (const k of c ? localize(await listCountermeasures(db, c.id), lang) : []) actions.push({ m, k });
  for (const { m, k } of actions) {
    const adj = k.amendments.at(-1);
    const label = positive(m) ? L('Recommended action', '推奨アクション') : L('Countermeasure', '対策');
    add({
      t: 'group',
      title: `${short(m)} — ${label}`,
      status: k.status,
      statusLabel: S(k.status),
      blocks: [
        {
          t: 'kv',
          rows: [
            [label, `${k.actionText}${adj ? ` (${L('adjusted by', '調整者')} ${adj.actor})` : ''}`],
            [L('Target', '対象'), k.target],
            [L('Responsible team', '担当チーム'), k.responsibleTeam ?? L('not assigned', '未割当')],
            [L('Approval status', '承認状況'), S(k.status)],
            ...([...invIds].some((id) => k.reason.startsWith(id)) ? [[L('Basis', '根拠'), k.reason] as [string, string]] : []),
          ],
        },
      ],
    });
  }
  if (!actions.length) add(p(L('No action proposed.', '提案されたアクションはありません。'), 'muted'));

  // ---- 7. Team Feedback ----
  section('Team Feedback', 'チームへのフィードバック');
  const feedback = actions.filter(({ k }) => k.reason && ![...invIds].some((id) => k.reason.startsWith(id)));
  if (feedback.length) add({ t: 'kv', rows: feedback.map(({ m, k }) => [k.responsibleTeam ?? L('No team assigned', '担当チーム未割当'), `${short(m)}: ${k.reason}`] as [string, string]) });
  else add(p(L('No team feedback for this run.', 'この実行のチームへのフィードバックはありません。'), 'muted'));
  return finish(doc, lang);
}

/** GSC_R01 in the report: affected queries / pages with clicks, impressions, CTR and position. */
function investigationBlocks(inv: GscInvestigation, L: (en: string, ja: string) => string): ReportBlock[] {
  const out: ReportBlock[] = [];
  const pos = (a: number | null, b: number | null) => (a === null || b === null ? '—' : `${a.toFixed(2)} → ${b.toFixed(2)}`);
  const ctr = (a: number | null, b: number | null) => (a === null || b === null ? '—' : `${a.toFixed(2)}% → ${b.toFixed(2)}%`);
  for (const k of inv.checks.filter((x) => x.available && x.affected.length))
    out.push({
      t: 'table',
      title: `${inv.ruleId} · ${k.id} — ${L('largest clicks decrease', 'クリック減少が大きい順')}`,
      note: k.files.previous && k.files.current ? `${k.files.previous} → ${k.files.current}` : undefined,
      columns: [L('Query / page', 'クエリ / ページ'), L('Clicks', 'クリック数'), L('Impressions change', '表示回数の変化'), 'CTR', L('Position', '掲載順位')],
      rows: k.affected.slice(0, 5).map((r) => [r.key, `${fmtNum(r.clicksPrevious)} → ${fmtNum(r.clicksCurrent)}`, `${r.impressionsChange > 0 ? '+' : ''}${fmtNum(r.impressionsChange)}`, ctr(r.ctrPrevious, r.ctrCurrent), pos(r.positionPrevious, r.positionCurrent)]),
    });
  const affected = [
    inv.affectedDevice ? `${L('Device', 'デバイス')}: ${inv.affectedDevice}` : '',
    inv.affectedSearchAppearance ? `${L('Search appearance', '検索での見え方')}: ${inv.affectedSearchAppearance}` : '',
  ].filter(Boolean);
  if (affected.length) out.push({ t: 'kv', rows: [[L('Concentrated on', '集中している対象'), affected.join(' · ')]] });
  return out;
}

/** English report: the client's Japanese segment and column names in English (keywords and file names unchanged). */
const finish = (doc: ReportDoc, lang: Lang) => (lang === 'en' ? mapStrings(doc, (x) => translateDataTerms(x, false)) : doc);

/** GSC findings in a few lines: Chart by Date trend, top pages / queries, device / country only when available. */
function gscSummary(an: NonNullable<CauseHypothesisAnalysis>, L: (en: string, ja: string) => string, lang: Lang, withGa4 = true): ReportBlock[] {
  const g = an.gscEvidence!;
  const d = g.dateChart;
  const NAME: Record<string, string> = { clicks: L('Clicks', 'クリック数'), impressions: L('Impressions', '表示回数'), ctr: 'CTR', position: L('Position', '掲載順位') };
  const DIR: Record<string, string> = { down: '↓', up: '↑', same: L('→ same', '→ 横ばい'), worse: L('worse', '悪化'), better: L('better', '改善') };
  const rows: [string, string][] = [];
  if (withGa4 && an.facts[0]) rows.push([L('GA4 organic traffic', 'GA4 オーガニック流入'), an.facts[0]]);
  if (d.available)
    rows.push([
      L('Chart by Date (same weeks)', '日付別チャート（同じ週）'),
      `${d.metrics.map((m) => `${NAME[m.metric]} ${DIR[m.direction]}${m.metric === 'position' ? ` (${m.previous.toFixed(1)} → ${m.current.toFixed(1)})` : ` ${fmtPct(m.changeRate)}`}`).join(' · ')}. ${d.summary ?? ''} ${d.indicationText ?? ''}`.trim(),
    ]);
  else rows.push([L('Chart by Date', '日付別チャート'), L(`Not available for the measured weeks. ${d.reason ?? ''}`, `測定週のデータはありません。${d.reason ?? ''}`).trim()]);
  // Device and country names are whole values: translated in English (search queries and URLs are not).
  const name = (s: GscSnapshot, key: string) => (lang === 'en' && (s === g.devices || s === g.countries) ? translateDataTerms(key) : key);
  const top = (s: GscSnapshot, k = 3) => s.top.slice(0, k).map((r) => `${name(s, r.key)}${r.share !== null ? ` (${r.share}%)` : ''}`).join(', ');
  if (g.pages.available) rows.push([L('Top pages (snapshot, whole period)', '上位ページ（スナップショット・期間全体）'), top(g.pages)]);
  if (g.queries.available)
    rows.push([L('Top queries (snapshot, whole period)', '上位クエリ（スナップショット・期間全体）'), `${top(g.queries)}${g.queries.brandShare !== null ? ` — ${L('brand share', 'ブランドの割合')} ${g.queries.brandShare}%` : ''}`]);
  const split = [g.devices.available ? `${L('Devices', 'デバイス')}: ${top(g.devices)}` : '', g.countries.available ? `${L('Countries', '国')}: ${top(g.countries, 2)}` : ''].filter(Boolean);
  if (split.length) rows.push([L('Device / country (snapshot, whole period)', 'デバイス / 国（スナップショット・期間全体）'), split.join(' · ')]);
  return [
    { t: 'kv', rows },
    { t: 'p', text: L('Search Console has no OK / NG of its own: it is used by the GSC_R01 investigation when M1 is NG with organic sessions decreasing. Top pages, queries, devices and countries above are period totals (shares of clicks).', 'Search Console には独自の OK / NG はありません。M1 が NG でオーガニックのセッションが減少したときに GSC_R01 の調査で使用します。上記の上位ページ・クエリ・デバイス・国は期間合計（クリック数のシェア）です。'), tone: 'muted' },
  ];
}

/** 2026-10-07T08:41:48.853Z → 2026-10-07 08:41 UTC */
const when = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;
const VALIDATION_EN: Record<string, string> = { valid: 'Valid', valid_with_warnings: 'Valid with warnings', invalid: 'Invalid' };

function mapStrings<T>(v: T, f: (s: string) => string): T {
  if (typeof v === 'string') return f(v) as T;
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, f)) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 't' || k === 'status' ? x : mapStrings(x, f)])) as T;
  return v;
}

// ---------- TXT rendering ----------

/** The TXT file: the same document with fixed-width layout (display width counts CJK as 2). */
export function renderText(doc: ReportDoc): string {
  const out: string[] = ['='.repeat(78), doc.title.toUpperCase(), '='.repeat(78)];
  for (const s of doc.sections) {
    out.push('', `${s.n}. ${s.title.toUpperCase()}`, '-'.repeat(78));
    out.push(...blocksText(s.blocks, ''));
  }
  out.push('', '='.repeat(78), /[ぁ-ん]/.test(doc.title) ? 'レポート終わり' : 'End of report', '='.repeat(78));
  return out.join('\n') + '\n';
}

function blocksText(blocks: ReportBlock[], ind: string): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.t === 'kv') {
      const w = Math.min(24, Math.max(...b.rows.map(([k]) => width(k))) + 1);
      for (const [k, v] of b.rows) out.push(...wrapAfter(`${ind}${pad(k, w)}: `, v));
    } else if (b.t === 'table') {
      if (b.title) out.push('', `${ind}${b.title}`);
      if (b.note) out.push(...wrap(`${ind}${b.note}`));
      out.push(...table(b.columns, b.rows).map((l) => `${ind}${l}`));
    } else if (b.t === 'p') out.push(...wrap(`${ind}${b.text}`));
    else if (b.t === 'list') for (const i of b.items) out.push(...wrap(`${ind}- ${i}`));
    else if (b.t === 'status') out.push(`${ind}[${b.label}] ${b.title}${b.meta ? `  (${b.meta})` : ''}`);
    else if (b.t === 'group') {
      // A measurement group starts with its own status line; other groups get a title line.
      if (!(b.blocks[0]?.t === 'status')) out.push('', `${ind}${b.title}${b.title.endsWith(':') ? '' : ':'}`);
      else out.push('');
      const inner = blocksText(b.blocks, `${ind}  `);
      // The status line stays at the group's indent.
      if (b.blocks[0]?.t === 'status') inner[0] = inner[0]!.replace(/^\s+/, ind);
      out.push(...inner);
    }
  }
  return out;
}


// ---------- Text formatting ----------

function fmtVal(metric: string, v: number | null): string {
  if (v === null) return '—';
  if (metric === 'cvr' || metric === 'ctr') return v.toFixed(3);
  if (metric === 'position') return v.toFixed(2);
  return fmtNum(v, Number.isInteger(v) ? 0 : 2);
}

/** Display width: CJK and full-width characters count as 2. */
function width(s: string): number {
  let w = 0;
  for (const ch of s) w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1;
  return w;
}

const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - width(s)));

function table(columns: string[], rows: (string | number | null)[][]): string[] {
  const cells = rows.map((r) => r.map((c) => (c === null ? '—' : String(c))));
  const widths = columns.map((c, i) => Math.min(60, Math.max(width(c), ...cells.map((r) => width(r[i] ?? '')))));
  const line = (r: string[]) => r.map((c, i) => pad(c.length > 60 ? c.slice(0, 57) + '…' : c, widths[i]!)).join('  ').trimEnd();
  return [line(columns), widths.map((w) => '-'.repeat(w)).join('  '), ...cells.map(line)];
}

/** Wraps `body` after a fixed label, keeping the label's alignment. */
function wrapAfter(head: string, body: string, max = 100): string[] {
  const lines = wrap(' '.repeat(width(head)) + body, max);
  lines[0] = head + lines[0]!.trimStart();
  return lines;
}

function wrap(text: string, max = 100): string[] {
  const indent = text.match(/^\s*/)![0];
  const room = max - width(indent) - 4;
  // Split on spaces; break runs without spaces (Japanese) by character so lines still fit.
  const words = text.trim().split(/\s+/).flatMap((w) => {
    if (width(w) <= room) return [w];
    const parts: string[] = [];
    let cur = '';
    for (const ch of w) {
      if (width(cur + ch) > room) {
        parts.push(cur);
        cur = '';
      }
      cur += ch;
    }
    return cur ? [...parts, cur] : parts;
  });
  const lines: string[] = [];
  let cur = indent;
  for (const w of words) {
    if (width(cur) + width(w) + 1 > max && cur.trim()) {
      lines.push(cur.trimEnd());
      cur = indent + '    ';
    }
    cur += (cur.trim() ? ' ' : '') + w;
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines;
}
