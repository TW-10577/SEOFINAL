import { type CauseHypothesis } from '@seo/shared';
import { t } from '../i18n.ts';
import { Decision, EditHistory, EditText } from './Decision.tsx';
import { EvidenceTables } from './EvidencePanel.tsx';
import { useNextTransitions } from './ontology.tsx';
import { StatusBadge } from './StatusBadge.tsx';

/**
 * Possible cause found by investigating the evidence. Detected facts, the possible cause and the
 * confirmed cause are kept apart: only the SEO team can turn the hypothesis into a confirmed cause.
 */
export function CauseHypothesisPanel({ cause, reviewer, onChanged }: { cause: CauseHypothesis | null; reviewer: string; onChanged: () => void }) {
  const next = useNextTransitions('cause', cause?.reviewStatus ?? '');
  if (!cause) return null;
  const a = cause.analysis;
  const confirmed = cause.reviewStatus === 'Confirmed';
  return (
    <section className="card">
      <div className="card-head">
        <h2>{t('Cause Hypothesis')}</h2>
        <span className="hint">
          {confirmed ? t('Confirmed by the SEO team.') : t('A possible cause from the available evidence — not a confirmed cause until the SEO team confirms it.')}
        </span>
      </div>
      <div className="card-body">
        <div className="small secondary">{confirmed ? t('Confirmed cause') : t('Possible cause (hypothesis)')}</div>
        {cause.amendments.length > 0 ? (
          <>
            <div className="hypothesis" style={{ fontWeight: 600, fontSize: 16 }}>{cause.causeText}</div>
            <div className="small secondary">{t('Modified by the SEO team. Generated: {title}', { title: a ? a.title : '' })}</div>
            <EditHistory amendments={cause.amendments} />
          </>
        ) : (
          <div className="hypothesis" style={{ fontWeight: 600, fontSize: 16 }}>{a ? a.title : cause.causeText}</div>
        )}
        {cause.editable && <EditText path={`/causes/${cause.id}/amend`} current={cause.amendments.length ? cause.causeText : a ? a.title : cause.causeText} reviewer={reviewer} onDone={onChanged} label="Modify" />}
        <dl className="kv" style={{ marginTop: 12 }}>
          {a && (
            <>
              <dt>{t('Evidence (detected facts)')}</dt>
              <dd>
                <ul style={{ margin: 0, paddingLeft: 18 }}>{a.facts.map((f) => <li key={f}>{f}</li>)}</ul>
              </dd>
              <dt>{t('Affected metric')}</dt>
              <dd>{a.affectedMetric}</dd>
              <dt>{t('Contribution')}</dt>
              <dd>{a.contribution ?? '—'}</dd>
            </>
          )}
          <dt>{t('Confidence')}</dt>
          <dd><StatusBadge status={cause.confidence} /> <span className="small secondary">{cause.confidenceReason}</span></dd>
          {a && a.missing.length > 0 && (
            <>
              <dt>{t('Missing evidence')}</dt>
              <dd>
                <ul className="caveat" style={{ margin: 0, paddingLeft: 18 }}>{a.missing.map((m) => <li key={m}>{m}</li>)}</ul>
              </dd>
            </>
          )}
          {a?.limitation && (
            <>
              <dt>{t('Limitation')}</dt>
              <dd className="small">{a.limitation}</dd>
            </>
          )}
          <dt>{t('Review status')}</dt>
          <dd><StatusBadge status={cause.reviewStatus} /></dd>
        </dl>
        {a?.affected && (
          <div style={{ marginTop: 12 }}>
            <EvidenceTables evidence={{ items: [], tables: [{ ...a.affected, title: t('Affected pages / queries') }] }} />
          </div>
        )}
        {a && (
          <details style={{ marginTop: 10 }}>
            <summary className="small secondary">{t('Full analysis text')}</summary>
            <div className="small" style={{ marginTop: 6 }}>{cause.causeText}</div>
          </details>
        )}
        <Decision path={`/causes/${cause.id}/review`} next={next} reviewer={reviewer} onDone={onChanged} label="review" />
      </div>
    </section>
  );
}
