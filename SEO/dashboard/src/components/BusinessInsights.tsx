import type { ComparisonRow, Ga4Overview, MeasurementStatus, Period } from '@seo/shared';
import { useMemo } from 'react';
import { fmtDiff, fmtRate, fmtValue, period } from '../format.ts';
import { t } from '../i18n.ts';
import { analyze, type Analysis, type Confidence, type Fact, type RuleInfo } from '../insights.ts';
import { Icon } from './Icon.tsx';

export type RuleSummary = RuleInfo;

const CONF_CLASS: Record<Confidence, string> = { High: 'ok', Medium: 'warn', Low: '' };

/** The rule's verdict on a figure: "Within ±3.9% (M1)", "Beyond ±0.7% (M2)" or not evaluable. */
function ThresholdBadge({ rule }: { rule: Fact['rule'] }) {
  if (!rule) return <span className="muted small">{t('No threshold')}</span>;
  if (rule.result === 'NOT_EVALUABLE' || rule.value === null) return <span className="badge">{t('Not evaluable ({code})', { code: rule.code })}</span>;
  const th = rule.unit === 'percentage_points' ? `±${rule.value} pt` : `±${rule.value}%`;
  const ng = rule.result === 'NG';
  return (
    <span className={`badge ${ng ? 'ng' : 'ok'}`}>
      <Icon name={ng ? 'alert' : 'check'} size={12} />
      {t(ng ? 'Beyond {th} ({code})' : 'Within {th} ({code})', { th, code: rule.code })}
    </span>
  );
}

/**
 * Business insights for the selected week-on-week comparison: the finding against M1 / M2 and the one next check →
 * observed facts → evidence → the likely cause (the strongest hypothesis, never a confirmed root cause) and the data
 * missing for a deeper analysis. The analysis (src/insights.ts) uses the comparison rows, the rules.yaml rules and the
 * stored M1 / M2 results, so OK / NG here matches the Measurements page.
 */
export function BusinessInsights({ rows, weeks, overview, rules, results, testData, gscAvailable }: {
  rows: ComparisonRow[];
  weeks: { current: Period; previous: Period } | null;
  overview: Ga4Overview | null;
  rules: RuleSummary[];
  /** Stored M1 / M2 results by rule code. */
  results?: Record<string, MeasurementStatus>;
  testData: boolean;
  gscAvailable: boolean;
}) {
  const a: Analysis = useMemo(
    () => analyze({ rows, rules, segments: overview?.segments ?? null, purchasesMetric: overview?.purchasesMetric ?? 'ecommerce_purchases', gscAvailable, results }),
    [rows, rules, overview, gscAvailable, results],
  );
  if (a.kind === 'none')
    return (
      <Frame weeks={weeks} testData={false}>
        <div className="secondary">{t('No week-on-week comparison is available for the selected data, so no insights can be generated.')}</div>
      </Frame>
    );
  const lead = a.lead;
  const missing = [...new Set([...(lead?.missing ?? []), ...a.limitations])];

  return (
    <Frame weeks={weeks} testData={testData}>
      <div className="bi">
        {/* Finding against M1 / M2 and the one next check */}
        <div className={`bi-headline ${!lead ? 'ok' : a.inconclusive ? '' : 'warn'}`}>
          <Icon name={lead ? 'info' : 'check'} size={18} />
          <div>
            <div className="bi-label-sm">{t('Executive finding')}</div>
            <strong>{a.finding}</strong>
            {lead && <div className="bi-action"><span>{t('Recommended next step')}:</span> {lead.action}</div>}
            {testData && <div className="bi-illustrative">{t('Illustrative only: derived from test data, not an actual business conclusion.')}</div>}
          </div>
        </div>

        {/* Observed facts */}
        <div className="bi-block">
          <h3 className="bi-label">{t('Observed facts')}</h3>
          <div className="table-wrap" style={{ maxHeight: 'none' }}>
            <table className="data bi-facts">
              <thead>
                <tr>
                  <th>{t('Metric')}</th>
                  <th className="num">{t('Previous')}</th>
                  <th className="num">{t('Current')}</th>
                  <th className="num">{t('Absolute change')}</th>
                  <th className="num">{t('Relative change')}</th>
                  <th>{t('Threshold')}</th>
                </tr>
              </thead>
              <tbody>
                {a.facts.map((f) => (
                  <tr key={f.label}>
                    <td><strong>{f.label}</strong></td>
                    <td className="num">{fmtValue(f.metric, f.previous)}</td>
                    <td className="num">{fmtValue(f.metric, f.current)}</td>
                    <td className="num">{fmtDiff(f.metric, f.abs)}</td>
                    <td className="num">{fmtRate(f.rate)}</td>
                    <td><ThresholdBadge rule={f.rule} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {a.facts.some((f) => f.metric === 'cvr') && <div className="small muted">{t('Relative change is the percentage change of the value; for rates, the absolute change is in percentage points (pt).')}</div>}
        </div>

        <div className="bi-cols">
          {/* Evidence */}
          <div className="bi-block">
            <h3 className="bi-label">{t('Supporting evidence')}</h3>
            <ul>{a.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>

          {/* Likely cause (hypothesis) and the data missing for a deeper analysis */}
          <div className="bi-block">
            <h3 className="bi-label">{t('Likely cause')}</h3>
            {lead ? (
              <div className="bi-lead">
                <div className="bi-lead-head">
                  <strong>{lead.title}</strong>
                  <span className={`badge ${CONF_CLASS[lead.confidence]}`}>{t('{level} confidence', { level: t(lead.confidence) })}</span>
                </div>
                <div className="small muted">{t('Hypothesis — not confirmed')}</div>
                {a.inconclusive && <p>{t('Inconclusive: the available data does not distinguish between these explanations.')}</p>}
              </div>
            ) : (
              <p className="secondary">{t('No figure moved beyond its threshold, so no cause analysis is needed.')}</p>
            )}
            {missing.length > 0 && (
              <div className="bi-missing">
                <div className="small"><strong>{t('Missing evidence')}</strong></div>
                <ul>{missing.map((m) => <li key={m}>{m}</li>)}</ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </Frame>
  );
}

function Frame({ testData, weeks, children }: { testData: boolean; weeks: { current: Period; previous: Period } | null; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{t('Business Insights')}</h2>
          {weeks && <div className="hint">{t('Current week {current} vs previous week {previous}', { current: period(weeks.current), previous: period(weeks.previous) })}</div>}
        </div>
        {testData && <span className="badge warn" title={t('Based on dates the uploaded file marks as not real — not business results.')}>{t('TEST DATA — not business results')}</span>}
      </div>
      <div className="card-body">{children}</div>
    </section>
  );
}
