import { t } from '../i18n.ts';

/** Left sidebar: LOGOS applications. SEO is the only workbench in this PoC. Collapses to a rail / drawer on small screens. */
export function AppSidebar({ active, onOpen, open, onClose }: { active: boolean; onOpen: () => void; open: boolean; onClose: () => void }) {
  return (
    <>
      <div className={`sidebar-backdrop${open ? ' open' : ''}`} onClick={onClose} />
      <aside className={`sidebar${open ? ' open' : ''}`} aria-label={t('Applications')}>
        <button
          className={`nav-item${active ? ' active' : ''}`}
          onClick={() => (onOpen(), onClose())}
          aria-current={active ? 'page' : undefined}
          title={t('Page performance analysis — GA4 and Search Console.')}
        >
          <span className="nav-text">
            <span className="nav-title">SEO</span>
            <span className="nav-desc">{t('Page performance analysis — GA4 and Search Console.')}</span>
          </span>
        </button>
      </aside>
    </>
  );
}
