import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from './api/client'
import type { OntologySummary } from './types'

export type Lang = 'en' | 'ja'

// Japanese text is a draft: business terms are to be confirmed by the SEO team.
const en = {
  'app.domain': 'SEO DOMAIN · 0.0.1',
  'app.sidebar': 'Page performance: GSC and GA4 analysis, anomalies and countermeasures.',
  'tab.dashboard': 'Dashboard',
  'tab.upload': 'Upload data',
  'tab.data': 'Data',
  'tab.measurements': 'Measurements',
  'tab.anomalies': 'Anomalies',
  'tab.countermeasures': 'Countermeasures',
  'tab.reports': 'Reports',
  loading: 'Loading…',
  unconfirmed: 'unconfirmed',
  confirmed: 'confirmed',
  'api.unreachable': 'Cannot reach the SEO API. Start it with `npm run dev` in SEO/seo-api.',

  'dash.eyebrow': 'SEO page performance',
  'dash.empty': 'No data uploaded yet.',
  'dash.emptyHint': 'Upload a GSC daily export (平均読み込み時間のチャート.csv) or a GA4 daily export to start.',
  'dash.datasets': 'Datasets',
  'dash.openAnomalies': 'Open anomalies',
  'dash.totalAnomalies': 'Anomalies detected',
  'dash.causesToReview': 'Causes to review',
  'dash.proposed': 'Awaiting decision',
  'dash.active': 'Countermeasures in progress',
  'dash.latestVsPrevious': '{source}: latest week vs previous week',
  'dash.notEnoughDays': 'Not enough days in this file for a week-over-week comparison.',
  'dash.noOpen': 'No open anomalies: no metric crossed its judgment condition in the latest week.',
  'dash.trend': 'Weekly trend (GSC)',
  'dash.week': 'Week',
  'dash.trendEmpty': 'Upload a GSC daily export to see weekly trends.',

  'data.eyebrow': 'Step 2 · Analyze data',
  'data.lead': 'Metrics and trends from uploaded files. Week-over-week comparisons show changes that matter.',
  'data.datasetsUploaded': 'Datasets uploaded',
  'data.dailyDatasets': 'Daily data files',
  'data.weeklyTrend': 'Weekly trend',
  'dash.conditions': 'Judgment conditions',
  'dash.conditionsSource': 'config/judgment-conditions.yaml · validated against the SEO ontology',
  'dash.flatBands': 'Flat (横ばい) bands used by rule ②',
  'dash.warnings': 'Data quality warnings',

  'cmp.metric': 'Metric',
  'cmp.scope': 'Subject',
  'cmp.previous': 'Previous week',
  'cmp.latest': 'Latest week',
  'cmp.change': 'Change',
  'cmp.condition': 'Condition',
  'cmp.significant': 'Significant',
  'cmp.footnote': '* Condition not yet confirmed by the SEO team.',

  'cond.id': 'ID',
  'cond.name': 'Name',
  'cond.direction': 'Direction',
  'cond.threshold': 'Threshold',
  'cond.type': 'Type',
  'cond.status': 'Status',
  'cond.source': 'Source',

  'up.eyebrow': 'Step 1 · Receive data',
  'up.title': 'Upload data',
  'up.lead': 'GSC and GA4 exports as CSV, TXT/TSV or Excel. Each file is validated, standardised and compared week over week.',
  'up.uploading': 'Uploading…',
  'up.drop': 'Drop files here or click to choose',
  'up.formats': 'CSV, TXT / TSV (comma or tab separated), Excel (.xlsx, .xls). UTF-8, Shift_JIS and UTF-16 are all read.',
  'up.analysed': 'Week-over-week analysis: GSC 平均読み込み時間のチャート.csv, GA4 自由形式 export with 日付 rows (at least 14 days).',
  'up.reference': 'Stored for reference: GSC ページ / クエリ / デバイス / 国 exports. In an Excel file every sheet is read as its own dataset.',
  'up.results': 'Upload results',
  'up.duplicate': 'already uploaded, skipped.',
  'up.summary': '{type}, {rows} rows, {period}. {n} anomaly(ies) detected.',
  'up.datasets': 'Uploaded datasets',
  'up.file': 'File',
  'up.type': 'Type',
  'up.period': 'Period',
  'up.rows': 'Rows',
  'up.warnings': 'Warnings',
  'up.delete': 'Delete',
  'up.deleting': 'Deleting…',
  'up.nothing': 'Nothing uploaded yet.',
  'up.confirmDelete': 'Delete {id} ({file})? It will be hidden, together with its anomalies and countermeasures. Nothing is erased and it can be restored.',
  'up.confirmImpact': 'Hidden with it: {a} anomaly(ies), {c} countermeasure(s).',
  'up.confirmDecided': '{n} of those countermeasures already have an SEO team decision; it is kept and comes back on restore.',
  'up.deleted': 'Deleted datasets',
  'up.deletedHint': 'Hidden from every list, report and count. Their data and decision history are kept.',
  'up.deletedAt': 'Deleted at',
  'up.restore': 'Restore',

  'an.eyebrow': 'Steps 4–6 · Detect, record, explain',
  'an.lead': 'Week-over-week changes that met a judgment condition. Each has a cause hypothesis that the SEO team reviews.',
  'an.allStatuses': 'All statuses',
  'an.allMetrics': 'All metrics',
  'an.noMatch': 'No anomalies match these filters.',
  'an.none': 'No anomalies detected yet.',
  'an.condition': 'Condition {id}: {threshold}',
  'an.moveTo': 'Move to: {status}',
  'an.cause': 'Cause hypothesis',
  'an.evidence': 'Evidence',
  'an.rule': 'Rule',
  'an.confidence': 'Confidence',
  'an.notAssessed': 'not assessed (scale to be confirmed)',
  'an.review': 'Review',
  'an.markReview': 'Mark: {status}',
  'an.countermeasure': 'Countermeasure',

  'cm.eyebrow': 'Measurements ① ② · Suggest and decide',
  'cm.lead': 'The system proposes; the SEO team approves, runs and verifies each action. Nothing is executed automatically.',
  'cm.allTeams': 'All teams',
  'cm.noMatch': 'No countermeasures match these filters.',
  'cm.none': 'No countermeasures yet. One is proposed for each cause hypothesis.',
  'cm.for': 'For {anomaly} · cause {cause}',
  'cm.target': 'Target: {target}',
  'cm.owner': 'Owner: {owner}',
  'cm.final': 'Final status',
  'ms.measurements': 'Measurements',
  'ms.measurementsHint': 'config/measurements.yaml · thresholds from judgment-conditions.yaml',
  'ms.condition': 'Condition',
  'ms.primary': 'Primary data',
  'ms.supportedBy': 'Supported by',
  'ms.latest': 'Latest week',
  'ms.noLatest': 'No GA4 daily data uploaded yet.',
  'ms.openAnomalies': '{n} open anomaly(ies)',
  'ms.sources': 'Data sources',

  'meas.eyebrow': 'Step 3 · Judge results',
  'meas.lead': 'Apply measurement rules to imported data. Each measurement shows whether the metric stayed OK or changed (NG).',
  'meas.summary': 'Summary',
  'meas.totalMeasurements': 'Total measurements',
  'meas.okCount': 'OK',
  'meas.ngCount': 'NG',
  'meas.results': 'Measurement results',
  'meas.resultsHint': 'Week-over-week comparison against defined thresholds',
  'meas.noMeasurements': 'No measurements defined yet.',
  'meas.col.measurement': 'Measurement',
  'meas.col.result': 'Result',
  'meas.col.status': 'Status',
  'meas.col.reason': 'Reason',
  'meas.col.rule': 'Rule',
  'meas.detail': 'Detail',
  'meas.noData': 'No data',
  'meas.ok': 'OK',
  'meas.ng': 'NG',
  'meas.close': 'Close',
  'meas.reason.withinThreshold': 'Within threshold',
  'meas.reason.exceededThreshold': 'Threshold exceeded',
  'meas.detail.measurement': 'Measurement',
  'meas.detail.result': 'Result',
  'meas.detail.status': 'Status',
  'meas.detail.reason': 'Reason',
  'meas.detail.rule': 'Rule',
  'meas.detail.threshold': 'Threshold',
  'meas.detail.previous': 'Previous period',
  'meas.detail.current': 'Current period',
  'meas.detail.change': 'Change',
  'ms.no': 'No',
  'ms.file': 'File name',
  'ms.source': 'Source',
  'ms.memo': 'Memo',
  'ms.import': 'Import?',
  'ms.sampleRange': 'Sample date range',
  'ms.dummyRange': 'Dummy date range',
  'ms.m1': 'Measurement 1',
  'ms.m2': 'Measurement 2',
  'ms.uploaded': 'Uploaded',
  'ms.notUploaded': 'Not uploaded',
  'ms.actions': 'Actions from the measurements',

  'rep.eyebrow': 'Step 8 · Weekly monitoring',
  'rep.title': 'Weekly report',
  'rep.generated': 'Generated {time}',
  'rep.regenerate': 'Regenerate',
  'rep.generateTxt': 'Download TXT report',
  'rep.print': 'Print / PDF',
  'rep.empty': 'Upload data to generate a report.',
  'rep.s1': '1. Data sources and analysis period',
  'rep.s2': '2. Metric changes (latest week vs previous week)',
  'rep.s3': '3. Anomalies and cause hypotheses',
  'rep.s4': '4. Countermeasures and SEO team decisions',
  'rep.s5': '5. Open monitoring items',
  'rep.s6': '6. Data quality warnings',
  'rep.notEnough': '{file}: not enough days for a week-over-week comparison.',
  'rep.noDaily': 'No daily data uploaded.',
  'rep.noAnomalies': 'No metric met its judgment condition.',
  'rep.noCountermeasures': 'No countermeasures proposed.',
  'rep.noOpen': 'No open items.',
  'rep.none': 'None.',
  'rep.id': 'ID',
  'rep.hypothesis': 'Cause hypothesis (system suggestion)',
  'rep.reviewStatus': 'Review',
  'rep.status': 'Status',
  'rep.action': 'Action',
  'rep.owner': 'Owner',
  'rep.priority': 'Priority',

  'metric.clicks': 'Clicks',
  'metric.impressions': 'Impressions',
  'metric.ctr': 'CTR',
  'metric.position': 'Average position',
  'metric.sessions': 'Sessions',
  'metric.purchases': 'Purchases',
  'metric.cvr': 'CVR',
  'metric.organicSessions': 'Sessions',
  'metric.paidSessions': 'Sessions',
  'metric.directSessions': 'Sessions',
  'scope.site': 'Site (GSC)',
  'unit.rank': 'rank',
  'source.gsc-daily': 'GSC daily',
  'source.ga4-daily': 'GA4 daily',
  'source.ga4-snapshot': 'GA4 totals',
  'source.gsc-pages': 'GSC pages',
  'source.gsc-queries': 'GSC queries',
  'source.gsc-other': 'GSC breakdown',
}

type Key = keyof typeof en

const ja: Record<Key, string> = {
  'app.domain': 'SEOドメイン · 0.0.1',
  'app.sidebar': 'ページパフォーマンス：GSC・GA4分析、異常検知、対策。',
  'tab.dashboard': 'ダッシュボード',
  'tab.upload': 'データアップロード',
  'tab.data': 'データ',
  'tab.measurements': '測定',
  'tab.anomalies': '異常',
  'tab.countermeasures': '対策',
  'tab.reports': 'レポート',
  loading: '読み込み中…',
  unconfirmed: '未確認',
  confirmed: '確認済',
  'api.unreachable': 'SEO APIに接続できません。SEO/seo-api で `npm run dev` を実行してください。',

  'dash.eyebrow': 'SEOページパフォーマンス',
  'dash.empty': 'データがまだアップロードされていません。',
  'dash.emptyHint': 'GSCの日別データ（平均読み込み時間のチャート.csv）またはGA4の日別データをアップロードしてください。',
  'dash.datasets': 'データセット',
  'dash.openAnomalies': '未完了の異常',
  'dash.totalAnomalies': '検出された異常',
  'dash.causesToReview': '確認待ちの原因',
  'dash.proposed': '判断待ちの対策',
  'dash.active': '実施中の対策',
  'dash.latestVsPrevious': '{source}：最新週と前週の比較',
  'dash.notEnoughDays': 'このファイルは前週比較に必要な日数がありません。',
  'dash.noOpen': '未完了の異常はありません。最新週に判断条件を満たした指標はありません。',
  'dash.trend': '週次推移（GSC）',
  'dash.week': '週',
  'dash.trendEmpty': '週次推移を表示するにはGSCの日別データをアップロードしてください。',

  'data.eyebrow': 'ステップ2 · データ分析',
  'data.lead': 'アップロードされたファイルの指標とトレンド。前週比較は重要な変化を示します。',
  'data.datasetsUploaded': 'アップロード済みデータセット',
  'data.dailyDatasets': '日別データファイル',
  'data.weeklyTrend': '週次トレンド',
  'dash.conditions': '判断条件',
  'dash.conditionsSource': 'config/judgment-conditions.yaml · SEOオントロジーで検証済み',
  'dash.flatBands': 'ルール②で使う「横ばい」の幅',
  'dash.warnings': 'データ品質の警告',

  'cmp.metric': '指標',
  'cmp.scope': '対象',
  'cmp.previous': '前週',
  'cmp.latest': '最新週',
  'cmp.change': '変化',
  'cmp.condition': '判断条件',
  'cmp.significant': '重要な変化',
  'cmp.footnote': '* SEO担当による判断条件の確認がまだです。',

  'cond.id': 'ID',
  'cond.name': '条件名',
  'cond.direction': '方向',
  'cond.threshold': '閾値',
  'cond.type': 'タイプ',
  'cond.status': '状態',
  'cond.source': '出典',

  'up.eyebrow': 'ステップ1 · データ受領',
  'up.title': 'データアップロード',
  'up.lead': 'GSC・GA4のデータをCSV、TXT/TSV、Excelでアップロードします。各ファイルは検証・標準化され、前週と比較されます。',
  'up.uploading': 'アップロード中…',
  'up.drop': 'ここにファイルをドロップ、またはクリックして選択',
  'up.formats': 'CSV、TXT / TSV（カンマ区切りまたはタブ区切り）、Excel（.xlsx、.xls）。UTF-8、Shift_JIS、UTF-16に対応。',
  'up.analysed': '前週比較の対象：GSCの平均読み込み時間のチャート.csv、日付行のあるGA4自由形式データ（14日以上）。',
  'up.reference': '参照用に保存：GSCのページ／クエリ／デバイス／国。Excelは各シートを別々のデータセットとして読み込みます。',
  'up.results': 'アップロード結果',
  'up.duplicate': 'アップロード済みのためスキップしました。',
  'up.summary': '{type}、{rows}行、{period}。異常を{n}件検出。',
  'up.datasets': 'アップロード済みデータセット',
  'up.file': 'ファイル',
  'up.type': '種類',
  'up.period': '期間',
  'up.rows': '行数',
  'up.warnings': '警告',
  'up.delete': '削除',
  'up.deleting': '削除中…',
  'up.nothing': 'まだアップロードされていません。',
  'up.confirmDelete': '{id}（{file}）を削除しますか？関連する異常・対策とともに非表示になります。データは消去されず、復元できます。',
  'up.confirmImpact': '一緒に非表示になるもの：異常{a}件、対策{c}件。',
  'up.confirmDecided': 'そのうち{n}件の対策にはSEO担当の判断が記録されています。判断は保持され、復元時に戻ります。',
  'up.deleted': '削除済みデータセット',
  'up.deletedHint': '一覧・レポート・件数には表示されません。データと判断履歴は保持されています。',
  'up.deletedAt': '削除日時',
  'up.restore': '復元',

  'an.eyebrow': 'ステップ4〜6 · 検出・記録・原因',
  'an.lead': '判断条件を満たした前週比の変化です。各異常の原因仮説はSEO担当が確認します。',
  'an.allStatuses': 'すべてのステータス',
  'an.allMetrics': 'すべての指標',
  'an.noMatch': '条件に一致する異常はありません。',
  'an.none': 'まだ異常は検出されていません。',
  'an.condition': '判断条件 {id}：{threshold}',
  'an.moveTo': '{status} へ',
  'an.cause': '原因仮説',
  'an.evidence': '根拠',
  'an.rule': '判断ルール',
  'an.confidence': '確信度',
  'an.notAssessed': '未評価（尺度は確認中）',
  'an.review': '確認',
  'an.markReview': '{status} にする',
  'an.countermeasure': '対策',

  'cm.eyebrow': '測定 ① ② · 提案と判断',
  'cm.lead': 'システムは提案のみ行い、SEO担当が承認・実施・検証します。自動では実行されません。',
  'cm.allTeams': 'すべてのチーム',
  'cm.noMatch': '条件に一致する対策はありません。',
  'cm.none': 'まだ対策はありません。原因仮説ごとに1件提案されます。',
  'cm.for': '対象の異常 {anomaly} · 原因 {cause}',
  'cm.target': '対象：{target}',
  'cm.owner': '担当：{owner}',
  'cm.final': '最終ステータス',
  'ms.measurements': '測定項目',
  'ms.measurementsHint': 'config/measurements.yaml · 閾値は judgment-conditions.yaml',
  'ms.condition': '判断条件',
  'ms.primary': '主データ',
  'ms.supportedBy': '補助データ',
  'ms.latest': '最新週',
  'ms.noLatest': 'GA4の日別データがまだアップロードされていません。',
  'ms.openAnomalies': '未完了の異常 {n}件',
  'ms.sources': 'データソース',

  'meas.eyebrow': 'ステップ3 · 結果判定',
  'meas.lead': '定義した測定ルールをインポートされたデータに適用します。各測定項目は、指標が「OK」のままか「NG」に変化したかを表示します。',
  'meas.summary': 'サマリー',
  'meas.totalMeasurements': '測定項目数',
  'meas.okCount': 'OK',
  'meas.ngCount': 'NG',
  'meas.results': '測定結果',
  'meas.resultsHint': '定義された閾値に基づいた前週比較',
  'meas.noMeasurements': 'まだ測定項目が定義されていません。',
  'meas.col.measurement': '測定項目',
  'meas.col.result': '結果',
  'meas.col.status': 'ステータス',
  'meas.col.reason': '理由',
  'meas.col.rule': 'ルール',
  'meas.detail': '詳細',
  'meas.noData': 'データなし',
  'meas.ok': 'OK',
  'meas.ng': 'NG',
  'meas.close': '閉じる',
  'meas.reason.withinThreshold': 'しきい値内',
  'meas.reason.exceededThreshold': 'しきい値超過',
  'meas.detail.measurement': '測定項目',
  'meas.detail.result': '結果',
  'meas.detail.status': 'ステータス',
  'meas.detail.reason': '理由',
  'meas.detail.rule': 'ルール',
  'meas.detail.threshold': 'しきい値',
  'meas.detail.previous': '前の期間',
  'meas.detail.current': '現在の期間',
  'meas.detail.change': '変化',
  'ms.no': 'No',
  'ms.file': 'ファイル名',
  'ms.source': 'ソース',
  'ms.memo': 'メモ',
  'ms.import': '取込',
  'ms.sampleRange': 'サンプル期間',
  'ms.dummyRange': 'ダミー期間',
  'ms.m1': '測定1',
  'ms.m2': '測定2',
  'ms.uploaded': 'アップロード済',
  'ms.notUploaded': '未アップロード',
  'ms.actions': '測定にもとづく対応',

  'rep.eyebrow': 'ステップ8 · 週次モニタリング',
  'rep.title': '週次レポート',
  'rep.generated': '作成日時 {time}',
  'rep.regenerate': '再作成',
  'rep.generateTxt': 'TXTレポートをダウンロード',
  'rep.print': '印刷 / PDF',
  'rep.empty': 'レポートを作成するにはデータをアップロードしてください。',
  'rep.s1': '1. データソースと分析期間',
  'rep.s2': '2. 指標の変化（最新週と前週）',
  'rep.s3': '3. 異常と原因仮説',
  'rep.s4': '4. 対策とSEO担当の判断',
  'rep.s5': '5. 継続監視項目',
  'rep.s6': '6. データ品質の警告',
  'rep.notEnough': '{file}：前週比較に必要な日数がありません。',
  'rep.noDaily': '日別データがアップロードされていません。',
  'rep.noAnomalies': '判断条件を満たした指標はありません。',
  'rep.noCountermeasures': '提案された対策はありません。',
  'rep.noOpen': '継続監視項目はありません。',
  'rep.none': 'なし。',
  'rep.id': 'ID',
  'rep.hypothesis': '原因仮説（システムの提案）',
  'rep.reviewStatus': '確認',
  'rep.status': 'ステータス',
  'rep.action': '対策',
  'rep.owner': '担当',
  'rep.priority': '優先度',

  'metric.clicks': 'クリック数',
  'metric.impressions': '表示回数',
  'metric.ctr': 'CTR',
  'metric.position': '平均掲載順位',
  'metric.sessions': 'セッション',
  'metric.purchases': '購入数',
  'metric.cvr': 'CVR',
  'metric.organicSessions': 'セッション',
  'metric.paidSessions': 'セッション',
  'metric.directSessions': 'セッション',
  'scope.site': 'サイト全体（GSC）',
  'unit.rank': '位',
  'source.gsc-daily': 'GSC 日別',
  'source.ga4-daily': 'GA4 日別',
  'source.ga4-snapshot': 'GA4 合計',
  'source.gsc-pages': 'GSC ページ',
  'source.gsc-queries': 'GSC クエリ',
  'source.gsc-other': 'GSC 内訳',
}

const dictionaries: Record<Lang, Record<Key, string>> = { en, ja }

export type Translate = (key: Key, params?: Record<string, string | number>) => string

interface I18n {
  lang: Lang
  setLang: (lang: Lang) => void
  t: Translate
  enumLabel: (enumId: string, value: string) => string
  next: (lifecycleId: string, value: string) => string[]
  ontology: OntologySummary | null
}

const Ctx = createContext<I18n | null>(null)
const STORAGE_KEY = 'seo-dashboard.lang'

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'ja') return saved
  } catch {
    // storage unavailable: fall back to the browser language
  }
  return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)
  const [ontology, setOntology] = useState<OntologySummary | null>(null)

  useEffect(() => {
    api.ontology().then(setOntology).catch(() => setOntology(null))
  }, [])
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      // not persisted; the choice still applies for this visit
    }
  }, [])

  const value = useMemo<I18n>(() => {
    const t: Translate = (key, params) =>
      (dictionaries[lang][key] ?? en[key] ?? key).replace(/\{(\w+)\}/g, (_m, p: string) => String(params?.[p] ?? `{${p}}`))
    // Status, priority and other enum labels come from the ontology's displayName.
    const enumLabel = (enumId: string, value: string) => {
      const v = ontology?.enums[`logos.seo.value.${enumId}`]?.find((e) => e.value === value)
      return v?.displayName[lang] ?? v?.displayName.en ?? value
    }
    const next = (lifecycleId: string, value: string) => ontology?.lifecycles[`logos.seo.value.${lifecycleId}`]?.transitions[value] ?? []
    return { lang, setLang, t, enumLabel, next, ontology }
  }, [lang, setLang, ontology])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n(): I18n {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}
