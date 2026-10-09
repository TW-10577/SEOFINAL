import type { CauseHypothesis, Countermeasure } from '@seo/shared';
import { useNextTransitions } from './ontology.tsx';
import { Decision, EditHistory, EditText } from './Decision.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { t } from '../i18n.ts';

export function CountermeasurePanel({ cause, countermeasures, reviewer, onChanged }: { cause: CauseHypothesis | null; countermeasures: Countermeasure[]; reviewer: string; onChanged: () => void }) {
  if (!cause) return null;
  return (
    <section className="card">
      <div className="card-head">
        <h2>{t('Countermeasure')}</h2>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {!countermeasures.length &&
          (cause.analysis && !cause.analysis.determined ? (
            <div>
              <div className="secondary">{t('Not proposed — the cause is not determined yet. A countermeasure is proposed only after the evidence determines the cause.')}</div>
              {cause.analysis.missing.length > 0 && (
                <ul className="caveat small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{cause.analysis.missing.map((m) => <li key={m}>{m}</li>)}</ul>
              )}
            </div>
          ) : (
            <div className="secondary">{t('No countermeasure suggested — the client rule defines no action for this case.')}</div>
          ))}
        {countermeasures.map((k) => (
          <div key={k.id} className="facts">
            <dl className="kv">
              <dt>{k.amendments.length ? t('Action (adjusted by the SEO team)') : t('Recommended action')}</dt>
              <dd>
                <strong>{k.actionText}</strong>
                <EditHistory amendments={k.amendments} />
                {k.editable && <div><EditText path={`/countermeasures/${k.id}/adjust`} current={k.actionText} reviewer={reviewer} onDone={onChanged} label="Adjust" /></div>}
              </dd>
              <dt>{t('Reason')}</dt><dd>{k.reason}</dd>
              <dt>{t('Target')}</dt><dd>{k.target}{k.targetType && <span className="muted small"> ({t(k.targetType)})</span>}</dd>
              {k.responsibleTeam && (<><dt>{t('Responsible team')}</dt><dd>{k.responsibleTeam}</dd></>)}
              <dt>{t('Approval status')}</dt><dd><StatusBadge status={k.status} /></dd>
            </dl>
            <CountermeasureDecision id={k.id} status={k.status} reviewer={reviewer} onDone={onChanged} blocked={k.blocked} />
          </div>
        ))}
      </div>
    </section>
  );
}

function CountermeasureDecision({ id, status, reviewer, onDone, blocked }: { id: number; status: string; reviewer: string; onDone: () => void; blocked?: Record<string, string> }) {
  const next = useNextTransitions('countermeasure', status);
  return <Decision path={`/countermeasures/${id}/status`} next={next} reviewer={reviewer} onDone={onDone} label="status" blocked={blocked} />;
}
