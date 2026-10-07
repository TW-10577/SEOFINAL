import { type CauseHypothesis } from '@seo/shared';
import { useNextTransitions } from './ontology.tsx';
import { Decision } from './Decision.tsx';
import { EvidenceTables } from './EvidencePanel.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { t } from '../i18n.ts';

export function CauseHypothesisPanel({ cause, reviewer, onChanged }: { cause: CauseHypothesis | null; reviewer: string; onChanged: () => void }) {
  const next = useNextTransitions('cause', cause?.reviewStatus ?? '');
  if (!cause) return null;
  return (
    <section className="card">
      <div className="card-head">
        <h2>{t('Cause Hypothesis')}</h2>
        <span className="hint">{t('Generated from the client rule and available data — a possible cause, not a confirmed one.')}</span>
      </div>
      <div className="card-body">
        <div className="hypothesis">{cause.causeText}</div>
        <dl className="kv" style={{ marginTop: 12 }}>
          <dt>{t('Rule branch')}</dt><dd className="mono">{cause.branch ?? '—'}</dd>
          <dt>{t('Confidence')}</dt><dd><StatusBadge status={cause.confidence} /> <span className="small secondary">{cause.confidenceReason}</span></dd>
          <dt>{t('Review status')}</dt><dd><StatusBadge status={cause.reviewStatus} /></dd>
        </dl>
        <details style={{ marginTop: 10 }}>
          <summary className="small secondary">{t('Supporting evidence')}</summary>
          <EvidenceTables evidence={cause.supportingEvidence} />
        </details>
        <Decision path={`/causes/${cause.id}/review`} next={next} reviewer={reviewer} onDone={onChanged} label="review" />
      </div>
    </section>
  );
}
