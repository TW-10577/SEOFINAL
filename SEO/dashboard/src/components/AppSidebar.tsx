import { t } from '../i18n.ts';
import type { OntologyView } from './ontology.tsx';

/** Left sidebar: LOGOS applications. SEO is the only workbench in this PoC. */
export function AppSidebar({ active, onOpen, ontology }: { active: boolean; onOpen: () => void; ontology: OntologyView | null }) {
  return (
    <aside className="sidebar">
      <div className="section-label">{t('Applications')}</div>
      <button className={`app-item${active ? ' active' : ''}`} onClick={onOpen} aria-current={active ? 'page' : undefined}>
        <div className="app-title">SEO</div>
        <div className="app-desc">{t('Page performance analysis — GA4 and Search Console.')}</div>
      </button>
      {ontology && (
        <div className="ontology-note" title={ontology.packageId}>
          {t('Ontology')}: <span className="mono">{ontology.packageId}@{ontology.version}</span>
          <br />
          {t('{objects} objects · {actions} actions · {relations} relations', { objects: ontology.counts.ObjectType ?? 0, actions: ontology.counts.ActionType ?? 0, relations: ontology.counts.RelationType ?? 0 })}
        </div>
      )}
    </aside>
  );
}
