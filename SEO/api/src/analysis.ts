// Upload → detect GA4 / GSC → apply that source's rules → analyse → result, for each uploaded file.
// GA4 data is judged by the GA4 rules (SEO.txt ① ②). Search Console data has no judgment criteria of
// its own: it is used by the GSC_R01 investigation when GA4_R01 is NG with organic sessions decreasing (rules.yaml).
import type { Source, UploadDetail } from '@seo/shared';
import type { AppConfig } from './config.ts';
import type { DB } from './db.ts';
import { enc, tx, type LText } from './i18n.ts';
import { latestGa4Date, runMeasurements } from './measure/engine.ts';
import { getMeasurementDetail, listMeasurements } from './measure/read.ts';
import { withScope } from './periods.ts';

export interface AppliedRule {
  ruleId: string;
  name: string; // bilingual (encoded)
  role: 'judgment' | 'supporting_evidence';
}

export interface RuleOutcome {
  ruleId: string;
  name: string;
  status: string; // OK / NG / NOT_EVALUABLE
  result: string;
  measurementId: number;
  anomalyId: number | null;
}

export interface UploadAnalysis {
  uploadId: number;
  fileName: string;
  source: Source | null;
  detectedBy: string; // layout / fields / user / none
  signals: string[];
  /** Validation criteria applied for the detected source. */
  validation: string[]; // bilingual (encoded)
  appliedRules: AppliedRule[];
  results: RuleOutcome[];
  note: string | null; // bilingual (encoded)
  /** Readable, but GA4 / GSC could not be identified: the SEO team must select the source. */
  needsSource: boolean;
}

export interface BatchAnalysis {
  runId: number | null;
  uploads: UploadAnalysis[];
}

const VALIDATION: Record<Source, LText[]> = {
  GA4: [
    tx('GA4 Explorations layout: segment and metric header rows', 'GA4 探索の形式：セグメント行と指標の見出し行'),
    tx('Required column: セッション', '必須列：セッション'),
    tx('Dates (YYYYMMDD), numbers, no negative values', '日付（YYYYMMDD）・数値・負の値なし'),
    tx('Duplicate dates and missing days', '日付の重複と欠損日'),
    tx('Daily rows reconcile with the 総計 totals row', '日次行と総計行の突合'),
  ],
  GSC: [
    tx('Search Console layout: dimension column + クリック数 / 表示回数 / CTR / 掲載順位', 'Search Console の形式：ディメンション列＋クリック数 / 表示回数 / CTR / 掲載順位'),
    tx('Required columns: クリック数, 表示回数', '必須列：クリック数、表示回数'),
    tx('Dates, page URLs and numbers are valid', '日付・ページ URL・数値が正しい'),
    tx('CTR = clicks ÷ impressions; clicks ≤ impressions', 'CTR = クリック数 ÷ 表示回数、クリック数 ≤ 表示回数'),
    tx('Duplicate rows; 1,000-row export cap', '重複行、1,000 行のエクスポート上限'),
  ],
};

export async function analyzeUploads(db: DB, cfg: AppConfig, uploads: UploadDetail[]): Promise<BatchAnalysis> {
  const imported = uploads.some((u) => u.importStatus === 'imported');
  // Measure the uploaded files right away (their own latest week), so "Continue" finds this run for the same context.
  const ctx = await withScope(db, cfg, uploads.filter((u) => u.importStatus === 'imported').map((u) => u.id));
  const runId = imported && (await latestGa4Date(db, cfg)) ? await runMeasurements(db, ctx) : null;
  const measurements = runId ? await listMeasurements(db, cfg, runId) : [];
  const outcome = (ruleId: string): RuleOutcome | null => {
    const m = measurements.find((x) => x.ruleId === ruleId);
    return m ? { ruleId, name: m.name, status: m.status, result: m.result, measurementId: m.id, anomalyId: m.anomalyId } : null;
  };
  const ruleName = (id: string) => {
    const r = cfg.rules.find((x) => x.id === id);
    return r ? enc(tx(`${r.number} ${JSON.parse(r.name).en}`, `${r.number} ${JSON.parse(r.name).ja}`)) : id;
  };

  return {
    runId,
    uploads: await Promise.all(uploads.map(async (u) => {
      const detection = (u.metadata as any)?.detection ?? { method: 'none', signals: [] };
      const base: UploadAnalysis = {
        uploadId: u.id,
        fileName: u.fileName,
        source: u.source,
        detectedBy: detection.method,
        signals: detection.signals ?? [],
        validation: u.source ? VALIDATION[u.source].map(enc) : [],
        appliedRules: [],
        results: [],
        note: null,
        needsSource: u.importStatus !== 'imported' && u.issues.some((i) => i.code === 'unknown-source'),
      };
      if (u.importStatus !== 'imported') {
        base.note = base.needsSource
          ? enc(tx('Source: Unknown. Select GA4 or Google Search Console to analyse this file.', 'ソース：不明。分析するには GA4 または Google Search Console を選択してください。'))
          : u.source
            ? detection.method === 'user'
              ? enc(tx(`Analysed as ${u.source === 'GSC' ? 'Google Search Console' : 'GA4'} (selected by you), but no data could be imported, so no rules were applied.`, `${u.source === 'GSC' ? 'Google Search Console' : 'GA4'} として分析しました（あなたが選択）が、データを取り込めなかったためルールは適用していません。`))
              : enc(tx(`Detected as ${u.source === 'GSC' ? 'Google Search Console' : 'GA4'}, but no data could be imported, so no rules were applied.`, `${u.source === 'GSC' ? 'Google Search Console' : 'GA4'} と判定しましたが、データを取り込めなかったためルールは適用していません。`))
            : enc(tx('Not analysed: the file could not be read.', '分析していません：ファイルを読み込めませんでした。'));
        return base;
      }
      if (u.source === 'GA4') {
        const rules = cfg.rules.filter((r) => r.source === 'GA4');
        base.appliedRules = rules.map((r) => ({ ruleId: r.id, name: ruleName(r.id), role: 'judgment' }));
        base.results = rules.map((r) => outcome(r.id)).filter((x): x is RuleOutcome => !!x);
        if (!runId) base.note = enc(tx('No complete GA4 week yet, so the rules could not be run.', 'GA4 の完全な週がまだないため、ルールを実行できませんでした。'));
        return base;
      }
      // Search Console: supporting evidence for one GA4 rule; never judged with GA4 rules.
      const supported = cfg.gscRole.supports;
      base.appliedRules = [{ ruleId: supported, name: ruleName(supported), role: 'supporting_evidence' }];
      const r1 = outcome(supported);
      if (!r1) {
        base.note = enc(tx(`${cfg.gscRole.text.en} No GA4 data has been uploaded yet, so there is nothing to support: upload GA4 data to run the rules.`, `${cfg.gscRole.text.ja}GA4 のデータがまだないため、裏付ける対象がありません。ルールを実行するには GA4 のデータをアップロードしてください。`));
        return base;
      }
      base.results = [r1];
      const usesGsc = r1.anomalyId !== null && !!(await getMeasurementDetail(db, cfg, r1.measurementId))?.cause?.analysis?.gscEvidence;
      base.note = usesGsc
        ? enc(tx(`Used by the GSC investigation for anomaly #${r1.anomalyId} (${supported} NG with organic sessions decreasing).`, `異常 #${r1.anomalyId}（${supported} が NG、オーガニックのセッションが減少）の GSC 調査で使用しました。`))
        : enc(tx(`${cfg.gscRole.text.en} This week ${supported} is ${r1.status}, so the investigation did not run.`, `${cfg.gscRole.text.ja}今週の ${supported} は ${r1.status} のため、調査は実行していません。`));
      return base;
    })),
  };
}
