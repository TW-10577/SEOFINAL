// Weekly monitoring report (TXT), generated from database records of one measurement run.
// The report is a generated view: it is stored only so that a download matches its preview.
import type { EvidenceTable, Report } from '@seo/shared';
import { unresolvedItems, type AppConfig } from './config.ts';
import { nowIso, parseJson, type DB } from './db.ts';
import { loc, localize, tx, type Lang, type LText } from './i18n.ts';
import { fmtNum, fmtPct } from './measure/logic.ts';
import {
  getCause,
  getRun,
  listAnalysisResults,
  listAnomalies,
  listCountermeasures,
  listMeasurements,
  sourceRefs,
  toEvent,
} from './measure/read.ts';

type Row = Record<string, any>;

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

export function generateReport(db: DB, cfg: AppConfig, runId: number, lang: Lang = 'en'): Report {
  const content = buildReportText(db, cfg, runId, lang);
  const generatedAt = nowIso();
  const fileName = `LOGOS_SEO_Report_${generatedAt.slice(0, 10)}.txt`;
  const id = Number(db.prepare('INSERT INTO reports (run_id, file_name, content, generated_at) VALUES (?, ?, ?, ?)').run(runId, fileName, content, generatedAt).lastInsertRowid);
  return { id, runId, fileName, generatedAt, content };
}

export function getReport(db: DB, id: number): Report | null {
  const r = db.prepare('SELECT * FROM reports WHERE id = ?').get(id) as Row | undefined;
  return r ? { id: r.id, runId: r.run_id, fileName: r.file_name, generatedAt: r.generated_at, content: r.content } : null;
}

export function buildReportText(db: DB, cfg: AppConfig, runId: number, lang: Lang = 'en'): string {
  const run = localize(getRun(db, runId), lang);
  if (!run) throw new Error(`Measurement run ${runId} not found.`);
  const L = (en: string, ja: string) => (lang === 'ja' ? ja : en);
  const S = (v: string) => (lang === 'ja' ? (STATE_JA[v] ?? v) : v);
  const M = (m: string) => METRIC_LABEL[m]?.[lang] ?? m;
  const measurements = localize(listMeasurements(db, cfg, runId), lang);
  const results = localize(listAnalysisResults(db, runId), lang);
  const anomalies = listAnomalies(db, runId);
  const out: string[] = [];
  const h = (n: number, en: string, ja: string) => out.push('', `${n}. ${L(en.toUpperCase(), ja)}`, '-'.repeat(78));
  const kv = (label: string, value: string) => `${pad(label, 19)}: ${value}`;

  out.push('='.repeat(78), L('LOGOS SEO PAGE PERFORMANCE ANALYSIS — WEEKLY MONITORING REPORT', 'LOGOS SEO ページパフォーマンス分析 — 週次モニタリングレポート'), '='.repeat(78));

  h(1, 'Report information', 'レポート情報');
  out.push(
    kv(L('Generated at', '生成日時'), nowIso()),
    kv(L('Measurement run', '測定実行'), `#${run.id} (${L('run at', '実行')} ${run.createdAt})`),
    kv(L('Generated from', '生成元'), L('LOGOS SEO PoC database records', 'LOGOS SEO PoC のデータベースレコード')),
    kv(L('Decision boundary', '判断の範囲'), L('The system suggests possible causes and countermeasures. The SEO team', 'システムは可能性のある原因と対策を提案します。SEO チームが')),
    `${' '.repeat(21)}${L('reviews, confirms or rejects them and decides the action.', '内容を確認・承認・却下し、対応を決定します。')}`,
  );

  h(2, 'Analysis period', '分析期間');
  out.push(
    kv(L('Current period', '今期'), `${run.current.start} – ${run.current.end}`),
    kv(L('Previous period', '前期'), `${run.previous.start} – ${run.previous.end}`),
    kv(L('Comparison', '比較'), L('Week on week (WoW)', '前週比')),
  );

  h(3, 'Data source', 'データソース');
  const uploadIds = new Set<number>();
  for (const m of measurements) for (const r of sourceRefs(db, m.id)) uploadIds.add(r.uploadId);
  const uploads = uploadIds.size
    ? (db.prepare(`SELECT * FROM uploads WHERE id IN (${[...uploadIds].map(() => '?').join(',')}) ORDER BY id`).all(...uploadIds) as Row[])
    : [];
  if (!uploads.length) out.push(L('No source data was used by this run.', 'この実行で使用したソースデータはありません。'));
  out.push(
    ...table(
      [L('Upload', 'アップロード'), L('Source', 'ソース'), L('File', 'ファイル'), L('Structure', '構造'), L('Period', '期間'), L('Validation', '検証')],
      uploads.map((u) => [`#${u.id}`, u.source, u.file_name, u.structure, u.analysis_period_start ? `${u.analysis_period_start} – ${u.analysis_period_end}` : L('unknown', '不明'), S(u.validation_status)]),
    ),
  );
  out.push('', L('Source mappings used:', '使用した対応付け：'));
  const roleJa: Record<string, string> = { total: '全体', organic: 'オーガニック流入', advertising: '広告流入' };
  const unconfirmed = L(' (not confirmed by the client)', '（クライアント未確認）');
  for (const [role, m] of Object.entries(cfg.segments))
    out.push(`  - ${L(`${role} traffic = GA4 segment "${m.value}"`, `${roleJa[role]} = GA4 セグメント「${m.value}」`)}${m.confirmed ? '' : unconfirmed}`);
  const cvCols = cfg.metricNames.cv.value.map((n) => `"${n}"`).join(' / ');
  out.push(`  - ${L(`CV = GA4 column ${cvCols}`, `CV = GA4 の列 ${cvCols}`)}${cfg.metricNames.cv.confirmed ? '' : unconfirmed}`);

  h(4, 'Overall SEO summary', 'SEO 全体サマリー');
  const count = (s: string) => measurements.filter((m) => m.status === s).length;
  out.push(
    kv(L('Measurements', '測定'), `${measurements.length}  (OK ${count('OK')}, NG ${count('NG')}, ${L('NOT_EVALUABLE', '評価不可')} ${count('NOT_EVALUABLE')})`),
    kv(L('Anomalies detected', '検知した異常'), String(anomalies.length)),
  );
  for (const r of results.filter((x) => x.subjectType === 'site'))
    out.push(kv(M(r.metric), `${fmtVal(r.metric, r.previousValue)} → ${fmtVal(r.metric, r.currentValue)}  (${fmtPct(r.changeRate)})`));

  h(5, 'Important metric changes', '主要指標の変化');
  out.push(
    ...table(
      [L('Source', 'ソース'), L('Subject', '対象'), L('Metric', '指標'), L('Previous', '前期'), L('Current', '今期'), L('Abs. change', '絶対変化'), L('Change rate', '変化率'), L('Note', '備考')],
      results.map((r) => [r.source, r.subjectKey, M(r.metric), fmtVal(r.metric, r.previousValue), fmtVal(r.metric, r.currentValue), fmtVal(r.metric, r.absoluteChange), fmtPct(r.changeRate), r.note ?? '']),
    ),
  );
  out.push(L('Absolute change = current − previous; change rate = (current − previous) ÷ previous × 100.', '絶対変化 = 今期 − 前期、変化率 = (今期 − 前期) ÷ 前期 × 100。'));

  h(6, 'Measurement results', '測定結果');
  for (const m of measurements) {
    out.push(
      `[${m.status === 'NOT_EVALUABLE' ? L('NOT_EVALUABLE', '評価不可') : m.status}] ${m.name}  (${L('rule', 'ルール')} ${m.ruleId})`,
      `    ${pad(L('Threshold', '閾値'), 10)}: ${m.thresholdValue === null ? L('not configured', '未設定') : `±${m.thresholdValue}`} ${S(m.thresholdUnit)}`,
      `    ${pad(L('Result', '結果'), 10)}: ${m.result}`,
      ...wrapAfter(`    ${pad(L('Reason', '理由'), 10)}: `, m.reason),
    );
  }
  out.push(L('NG = significant business-rule change. It does not mean the uploaded data is invalid.', 'NG = ビジネスルール上の有意な変化。アップロードデータが無効という意味ではありません。'));

  h(7, 'Significant SEO anomalies', '有意な SEO 異常');
  if (!anomalies.length) out.push(L('No anomaly detected in this run.', 'この実行では異常は検知されませんでした。'));
  for (const a of anomalies)
    out.push(
      `${L('Anomaly', '異常')} #${a.id}  ${a.subjectKey} / ${M(a.metric)}: ${fmtVal(a.metric, a.previousValue)} → ${fmtVal(a.metric, a.currentValue)} (${fmtVal(a.metric, a.change)}, ${fmtPct(a.changeRate)})  ${L('detected', '検知日')} ${a.detectionDate}  ${L('state', '状態')} ${S(a.state)}`,
    );

  h(8, 'Numerical analysis comments', '数値分析コメント');
  const comments = results
    .filter((r) => r.previousValue !== null && r.currentValue !== null && r.subjectType !== 'segment')
    .map((r) => {
      const d = r.absoluteChange!;
      const from = fmtVal(r.metric, r.previousValue);
      const to = fmtVal(r.metric, r.currentValue);
      return L(
        `- ${r.subjectKey} ${M(r.metric)} ${d < 0 ? 'decreased' : d > 0 ? 'increased' : 'did not change'} from ${from} to ${to} (${fmtPct(r.changeRate)}).`,
        `- ${r.subjectKey} の${M(r.metric)}は ${from} から ${to} に${d < 0 ? '減少' : d > 0 ? '増加' : '変化なし'}（${fmtPct(r.changeRate)}）。`,
      );
    });
  out.push(...(comments.length ? comments : [L('No complete period comparison is available.', '完全な期間比較はありません。')]));
  out.push(L('These are numerical facts. Interpretations are listed separately under Possible causes.', 'これらは数値上の事実です。解釈は「可能性のある原因」に分けて記載します。'));

  h(9, 'Possible causes (hypotheses — not confirmed)', '可能性のある原因（仮説 — 未確定）');
  const causes = anomalies.map((a) => ({ a, c: localize(getCause(db, a.id), lang) })).filter((x) => x.c);
  if (!causes.length) out.push(L('No cause hypothesis — no anomaly in this run.', '原因仮説はありません — この実行に異常はありません。'));
  for (const { a, c } of causes)
    out.push(
      ...wrap(`${L('Anomaly', '異常')} #${a.id}: ${c!.causeText}`),
      ...wrap(`    ${L('Confidence', '信頼度')}: ${S(c!.confidence)} — ${c!.confidenceReason}`),
      `    ${L('Review status', 'レビュー状況')}: ${S(c!.reviewStatus)}`,
    );

  h(10, 'Supporting evidence', '裏付けとなる根拠');
  for (const m of measurements) {
    const ev = localize(
      parseJson<{ items: { label: string; value: string; caveat?: string }[]; tables: EvidenceTable[] }>(
        db.prepare('SELECT evidence_json FROM measurements WHERE id = ?').pluck().get(m.id) as string,
        { items: [], tables: [] },
      ),
      lang,
    );
    out.push(`${m.name}:`);
    for (const i of ev.items) out.push(...wrap(`  - ${i.label}: ${i.value}${i.caveat ? ` [${i.caveat}]` : ''}`));
    for (const t of ev.tables) {
      out.push('', `  ${t.title}`);
      if (t.note) out.push(...wrap(`  ${t.note}`));
      out.push(...table(t.columns, t.rows.map((r) => r.map((v) => (typeof v === 'number' ? fmtNum(v, Number.isInteger(v) ? 0 : 2) : v ?? '—')))).map((l) => `  ${l}`));
    }
    const refs = sourceRefs(db, m.id);
    const byUpload = new Map<string, number>();
    for (const r of refs) {
      const k = `${L('upload', 'アップロード')} #${r.uploadId} ${r.fileName}`;
      byUpload.set(k, (byUpload.get(k) ?? 0) + 1);
    }
    out.push(
      `  ${L('Source records used', '使用したソースレコード')}: ${refs.length ? [...byUpload].map(([k, n]) => `${k} (${n} ${L('values', '値')})`).join('; ') : L('none', 'なし')}`,
      '',
    );
  }

  h(11, 'Countermeasure suggestions', '対策の提案');
  let anyCm = false;
  for (const { a, c } of causes)
    for (const k of localize(listCountermeasures(db, c!.id), lang)) {
      anyCm = true;
      out.push(
        `${L('Anomaly', '異常')} #${a.id} → ${k.actionText}`,
        `    ${pad(L('Target', '対象'), 8)}: ${k.target}`,
        ...wrapAfter(`    ${pad(L('Reason', '理由'), 8)}: `, k.reason),
        `    ${pad(L('Status', 'ステータス'), 8)}: ${S(k.status)}`,
      );
    }
  if (!anyCm) out.push(L('No countermeasure suggested (no anomaly, or no client-defined follow-up applies).', '対策の提案はありません（異常がない、またはクライアント定義のフォローアップが該当しない）。'));

  h(12, 'SEO team decision / status', 'SEO チームの判断 / ステータス');
  for (const { a, c } of causes) {
    const cms = listCountermeasures(db, c!.id).map((k) => `#${k.id} ${S(k.status)}`).join(', ') || L('none', 'なし');
    out.push(
      L(
        `Anomaly #${a.id}: state ${a.state}; cause review ${c!.reviewStatus}; countermeasures ${cms}`,
        `異常 #${a.id}：状態 ${S(a.state)}、原因レビュー ${S(c!.reviewStatus)}、対策 ${cms}`,
      ),
    );
  }
  const events = (
    db
      .prepare(
        `SELECT e.* FROM state_events e WHERE
           (e.entity = 'anomaly' AND e.entity_id IN (SELECT a.id FROM anomalies a JOIN measurements m ON m.id = a.measurement_id WHERE m.run_id = ?))
        OR (e.entity = 'cause' AND e.entity_id IN (SELECT c.id FROM cause_hypotheses c JOIN anomalies a ON a.id = c.anomaly_id JOIN measurements m ON m.id = a.measurement_id WHERE m.run_id = ?))
        OR (e.entity = 'countermeasure' AND e.entity_id IN (SELECT k.id FROM countermeasures k JOIN cause_hypotheses c ON c.id = k.cause_id JOIN anomalies a ON a.id = c.anomaly_id JOIN measurements m ON m.id = a.measurement_id WHERE m.run_id = ?))
         ORDER BY e.id`,
      )
      .all(runId, runId, runId) as Row[]
  ).map(toEvent);
  if (!events.length) out.push(L('No SEO team decision recorded yet.', 'SEO チームの判断はまだ記録されていません。'));
  for (const e of events)
    out.push(`  ${e.at.slice(0, 16).replace('T', ' ')}  ${e.actor}: ${S(e.entity)} #${e.entityId} ${S(e.fromState)} → ${S(e.toState)}${e.note ? ` — ${e.note}` : ''}`);

  h(13, 'Open monitoring items', '未完了の監視項目');
  const open = listAnomalies(db).filter((a) => !['Resolved', 'Dismissed'].includes(a.state));
  if (!open.length) out.push(L('No open anomalies.', '未完了の異常はありません。'));
  for (const a of open) {
    const r = getRun(db, a.runId)!;
    out.push(`${L('Anomaly', '異常')} #${a.id} (${r.current.start} – ${r.current.end}${a.runId === runId ? L(', this run', '、今回の実行') : ''}): ${a.subjectKey} / ${M(a.metric)} — ${S(a.state)}`);
  }

  h(14, 'Data quality warnings', 'データ品質の警告');
  for (const i of run.issues) out.push(...wrap(`- [${L('run', '実行')}] ${i.message}`));
  for (const u of uploads) {
    const issues = db.prepare('SELECT code, COUNT(*) n, MIN(message) example FROM upload_issues WHERE upload_id = ? GROUP BY code ORDER BY code').all(u.id) as Row[];
    for (const i of issues) out.push(...wrap(`- [${L('upload', 'アップロード')} #${u.id} ${u.file_name}] ${i.code}${i.n > 1 ? ` ×${i.n}` : ''}: ${loc(i.example, lang)}`));
  }
  out.push('', L('Unresolved client questions affecting this report:', 'このレポートに影響するクライアントへの未解決事項：'));
  for (const u of unresolvedItems(cfg)) out.push(...wrap(`- ${loc(u.description, lang)}`));

  out.push('', '='.repeat(78), L('End of report', 'レポート終わり'), '='.repeat(78));
  return out.join('\n') + '\n';
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
