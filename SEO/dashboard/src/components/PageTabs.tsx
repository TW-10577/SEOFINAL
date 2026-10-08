import { t } from '../i18n.ts';
import { Icon, type IconName } from './Icon.tsx';
export type PageKey = 'import' | 'data' | 'measurements' | 'report';

const ITEMS: { key: PageKey; label: string; icon: IconName }[] = [
  { key: 'import', label: 'Data Import', icon: 'upload' },
  { key: 'data', label: 'Data', icon: 'chart' },
  { key: 'measurements', label: 'Measurements', icon: 'gauge' },
  { key: 'report', label: 'Report', icon: 'report' },
];

/** Page navigation: underline tabs, numbered in workflow order. */
export function PageTabs({ active, onNavigate }: { active: PageKey; onNavigate: (p: PageKey) => void }) {
  return (
    <nav className="page-tabs" aria-label={t('Pages')}>
      {ITEMS.map((item) => (
        <button key={item.key} className={`tab${active === item.key ? ' active' : ''}`} onClick={() => onNavigate(item.key)} aria-current={active === item.key ? 'page' : undefined}>
          <Icon name={item.icon} size={16} />
          {t(item.label)}
        </button>
      ))}
    </nav>
  );
}
