import type { CauseHypothesis, Countermeasure } from '@seo/shared';
import { useNextTransitions } from './ontology.tsx';
import { Decision } from './Decision.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { t } from '../i18n.ts';

export function CountermeasurePanel({ cause, countermeasures, reviewer, onChanged }: { cause: CauseHypothesis | null; countermeasures: Countermeasure[]; reviewer: string; onChanged: () => void }) {
  if (!cause) return null;
  return (
    <section className="card">
      <div className="card-head">
        <h2>{t('Countermeasure')}</h2>
        <span className="hint">{t('Suggested by the system. Only the SEO team approves or carries it out.')}</span>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {!countermeasures.length && <div className="secondary">{t('No countermeasure suggested — the client rule defines no action for this case.')}</div>}
        {countermeasures.map((k) => (
          <div key={k.id} className="facts">
            <dl className="kv">
              <dt>{t('Suggested action')}</dt><dd><strong>{k.actionText}</strong></dd>
              <dt>{t('Reason')}</dt><dd>{k.reason}</dd>
              <dt>{t('Target')}</dt><dd>{k.target}</dd>
              {k.responsibleTeam && (<><dt>{t('Responsible team')}</dt><dd>{k.responsibleTeam}</dd></>)}
              <dt>{t('Status')}</dt><dd><StatusBadge status={k.status} /></dd>
            </dl>
            <CountermeasureDecision id={k.id} status={k.status} reviewer={reviewer} onDone={onChanged} />
          </div>
        ))}
      </div>
    </section>
  );
}

function CountermeasureDecision({ id, status, reviewer, onDone }: { id: number; status: string; reviewer: string; onDone: () => void }) {
  const next = useNextTransitions('countermeasure', status);
  return <Decision path={`/countermeasures/${id}/status`} next={next} reviewer={reviewer} onDone={onDone} label="status" />;
}
