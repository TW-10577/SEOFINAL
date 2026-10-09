import type { ComparisonRow, Ga4Overview, Period } from '@seo/shared';
import { useMemo } from 'react';
import { fmtDiff, fmtRate, fmtValue, period } from '../format.ts';
import { t } from '../i18n.ts';
import { analyze, type Analysis, type Confidence, type Hypothesis, type RuleInfo } from '../insights.ts';
import { Icon } from './Icon.tsx';

export type RuleSummary = RuleInfo;

const CONF_CLASS: Record<Confidence, string> = { High: 'ok', Medium: 'warn', Low: '' };

/**
 * Business insights for the selected week-on-week comparison: executive finding → observed facts → likely cause and
 * confidence → supporting evidence → alternative hypotheses → recommended next steps. The analysis (src/insights.ts)
 * only uses the comparison rows and the rules.yaml rules; a likely cause is never presented as a confirmed root cause.
 */
export function BusinessInsights({ rows, weeks, overview, rules, testData, gscAvailable }: {
  rows: ComparisonRow[];
  weeks: { current: Period; previous: Period } | null;
  overview: Ga4Overview | null;
  rules: RuleSummary[];
  testData: boolean;
  gscAvailable: boolean;
}) {
  const a: Analysis = useMemo(
    () => analyze({ rows, rules, segments: overview?.segments ?? null, purchasesMetric: overview?.purchasesMetric ?? 'ecommerce_purchases', gscAvailable }),
    [rows, rules, overview, gscAvailable],
  );
  if (a.kind === 'none')
    return (
      <Frame weeks={weeks} testData={false}>
        <div className="secondary">{t('No week-on-week comparison is available for the selected data, so no insights can be generated.')}</div>
      </Frame>
    );
  const [top, ...rest] = a.hypotheses;
  // Inconclusive: show the competing explanations side by side instead of picking one.
  const leads = a.inconclusive ? a.hypotheses.filter((h) => !h.id.startsWith('rule:')).slice(0, 2) : top ? [top] : [];
  const alternatives = a.inconclusive ? a.hypotheses.filter((h) => !leads.includes(h)) : rest;
  const steps = leads.length ? leads : [];

  return (
    <Frame weeks={weeks} testData={testData}>
      <div className="bi">
        {/* 1. Executive finding */}
        <div className={`bi-headline ${a.inconclusive ? '' : 'warn'}`}>
          <Icon name="info" size={18} />
          <div>
            <div className="bi-label-sm">{t('Executive finding')}</div>
            <strong>{a.finding}</strong>
            {testData && <div className="bi-illustrative">{t('Illustrative only: derived from test data, not an actual business conclusion.')}</div>}
          </div>
        </div>

        {/* 2. Observed facts */}
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
                    <td className="num">{f.metric === 'position' ? '—' : fmtRate(f.rate)}</td>
                    <td>
                      {f.threshold ? (
                        <span className={`badge ${f.threshold.exceeded ? 'ng' : 'ok'}`}>
                          <Icon name={f.threshold.exceeded ? 'alert' : 'check'} size={12} />
                          {f.threshold.exceeded ? t('Beyond ±{v}% ({code})', { v: f.threshold.value, code: f.threshold.code }) : t('Within ±{v}% ({code})', { v: f.threshold.value, code: f.threshold.code })}
                        </span>
                      ) : (
                        <span className="muted small">{t('No threshold')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {a.facts.some((f) => f.metric === 'cvr' || f.metric === 'ctr') && <div className="small muted">{t('Relative change is the percentage change of the value; for rates, the absolute change is in percentage points (pt).')}</div>}
          {a.sources.length > 0 && (
            <div className="table-wrap" style={{ maxHeight: 'none' }}>
              <table className="data bi-facts">
                <thead>
                  <tr>
                    <th>{t('Traffic source')}</th>
                    <th className="num">{t('Sessions')}</th>
                    <th className="num">{t('Purchases')}</th>
                    <th className="num">CVR</th>
                    <th className="num">{t('CVR change')}</th>
                  </tr>
                </thead>
                <tbody>
                  {a.sources.map((x) => (
                    <tr key={x.name}>
                      <td>{x.name}{x.derived && <span className="cell-sub">{t('site total minus the listed sources')}</span>}</td>
                      <td className="num">{fmtRate(((x.sessions[1] - x.sessions[0]) / x.sessions[0]) * 100)}</td>
                      <td className="num">{x.purchases[0] ? fmtRate(((x.purchases[1] - x.purchases[0]) / x.purchases[0]) * 100) : '—'}</td>
                      <td className="num">{fmtValue('cvr', x.cvr[0])} → {fmtValue('cvr', x.cvr[1])}</td>
                      <td className="num">{fmtRate(((x.cvr[1] - x.cvr[0]) / x.cvr[0]) * 100)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 3. Likely cause and confidence */}
        <div className="bi-block">
          <h3 className="bi-label">{t('Likely cause and confidence')}</h3>
          {a.inconclusive && (
            <div className="notice">{t('Inconclusive: the available data does not distinguish between these explanations.')}</div>
          )}
          <div className="bi-leads">
            {leads.map((h) => (
              <div key={h.id} className="bi-lead">
                <div className="bi-lead-head">
                  <strong>{h.title}</strong>
                  <span className={`badge ${CONF_CLASS[h.confidence]}`}>{t('{level} confidence', { level: t(h.confidence) })}</span>
                </div>
                <div className="small muted">{t('Likely cause — not a confirmed root cause.')}</div>
                <p>{h.basis}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 4. Supporting evidence */}
        <div className="bi-block">
          <h3 className="bi-label">{t('Supporting evidence')}</h3>
          {leads.map((h) => <Evidence key={h.id} h={h} title={leads.length > 1 ? h.title : undefined} />)}
          {a.ruleMappings.length > 0 && (
            <div className="small secondary">
              {t('rules.yaml mapping for these figures')}: {a.ruleMappings.map((m) => `${m.code} → ${m.label}`).join(' · ')}
            </div>
          )}
        </div>

        {/* 5. Alternative hypotheses */}
        {alternatives.length > 0 && (
          <div className="bi-block">
            <h3 className="bi-label">{t('Alternative hypotheses')}</h3>
            <div className="bi-alts">
              {alternatives.map((h) => (
                <details key={h.id} className="bi-alt">
                  <summary>
                    <span className="bi-alt-title">{h.title}</span>
                    <span className={`badge ${CONF_CLASS[h.confidence]}`}>{t(h.confidence)}</span>
                  </summary>
                  <p className="small secondary">{h.basis}</p>
                  <Evidence h={h} />
                  {h.team && <div className="small">{t('Team per rules.yaml')}: <strong>{h.team}</strong></div>}
                </details>
              ))}
            </div>
          </div>
        )}

        {/* 6. Recommended next steps */}
        <div className="bi-block">
          <h3 className="bi-label">{t('Recommended next steps')}</h3>
          {steps.map((h) => (
            <div key={h.id} className="bi-steps">
              {steps.length > 1 && <div className="small"><strong>{h.title}</strong></div>}
              <ol>{h.checks.map((c) => <li key={c}>{c}</li>)}</ol>
              <dl className="bi-cr">
                <dt>{t('Would confirm')}</dt><dd>{h.confirm}</dd>
                <dt>{t('Would reject')}</dt><dd>{h.reject}</dd>
                {h.team && (<><dt>{t('Team per rules.yaml')}</dt><dd>{h.team}</dd></>)}
              </dl>
            </div>
          ))}
          {(() => {
            const missing = [...new Set([...steps.flatMap((h) => h.missing), ...a.limitations])];
            return missing.length ? (
              <div className="bi-missing">
                <div className="small"><strong>{t('Missing evidence')}</strong></div>
                <ul>{missing.map((m) => <li key={m}>{m}</li>)}</ul>
              </div>
            ) : null;
          })()}
        </div>
      </div>
    </Frame>
  );
}

function Evidence({ h, title }: { h: Hypothesis; title?: string }) {
  return (
    <div>
      {title && <div className="small"><strong>{title}</strong></div>}
      <ul className="bi-signals">
        {h.signals.map((s) => (
          <li key={s.text} className={s.ok ? 'ok' : 'no'}>
            <Icon name={s.ok ? 'check' : 'x'} size={13} />
            <span><span className="visually-hidden">{s.ok ? t('Supports') : t('Against')}: </span>{s.text}</span>
          </li>
        ))}
      </ul>
    </div>
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
