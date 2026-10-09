import { t } from '../i18n.ts';
export type PageKey = 'import' | 'data' | 'measurements' | 'report';

const ITEMS: { key: PageKey; label: string }[] = [
  { key: 'import', label: 'Data Import' },
  { key: 'data', label: 'Data' },
  { key: 'measurements', label: 'Measurements' },
  { key: 'report', label: 'Report' },
];

/** Page navigation: underline tabs, numbered in workflow order. */
export function PageTabs({ active, onNavigate }: { active: PageKey; onNavigate: (p: PageKey) => void }) {
  return (
    <nav className="page-tabs" aria-label={t('Pages')}>
      {ITEMS.map((item, i) => {
        const done = i < ITEMS.findIndex((x) => x.key === active);
        return (
          <button key={item.key} className={`tab${active === item.key ? ' active' : ''}${done ? ' done' : ''}`} onClick={() => onNavigate(item.key)} aria-current={active === item.key ? 'page' : undefined}>
            <span className="step" aria-hidden>{i + 1}</span>
            {t(item.label)}
          </button>
        );
      })}
    </nav>
  );
}
