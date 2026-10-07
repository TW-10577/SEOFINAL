import { t } from '../i18n.ts';
export type PageKey = 'import' | 'data' | 'measurements';

const ITEMS: { key: PageKey; label: string }[] = [
  { key: 'import', label: t('Data Import') },
  { key: 'data', label: t('Data') },
  { key: 'measurements', label: t('Measurements') },
];

/** Page navigation, shown as tabs at the top right of the page header. */
export function PageTabs({ active, onNavigate }: { active: PageKey; onNavigate: (p: PageKey) => void }) {
  return (
    <nav className="page-tabs" aria-label={t('Data')}>
      {ITEMS.map((item) => (
        <button key={item.key} className={`tab${active === item.key ? ' active' : ''}`} onClick={() => onNavigate(item.key)} aria-current={active === item.key ? 'page' : undefined}>
          {t(item.label)}
        </button>
      ))}
    </nav>
  );
}
