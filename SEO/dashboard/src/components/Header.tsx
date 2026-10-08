import type { ReactNode } from 'react';
import { t, type Lang } from '../i18n.ts';
import { Icon } from './Icon.tsx';

/** Slim app header: logo on the left, language segmented control on the right. */
export function TopBar({ lang, onLang, onMenu }: { lang: Lang; onLang: (l: Lang) => void; onMenu: () => void }) {
  return (
    <header className="topbar">
      <button className="btn icon ghost menu-toggle" onClick={onMenu} aria-label={t('Menu')}>
        <Icon name="menu" size={18} />
      </button>
      <div className="brand">
        <span className="brand-mark" aria-hidden>L</span>
        <span className="brand-name">LOGOS</span>
        <span className="brand-divider" aria-hidden />
        <span className="brand-tagline">{t('SEO Workbench')}</span>
      </div>
      <span className="spacer" />
      <div className="lang-switch" role="group" aria-label={t('Language')}>
        {(['en', 'ja'] as Lang[]).map((l) => (
          <button key={l} className={lang === l ? 'on' : ''} onClick={() => onLang(l)} aria-pressed={lang === l}>
            {l === 'en' ? 'English' : '日本語'}
          </button>
        ))}
      </div>
    </header>
  );
}

/** Element id of the top-right action area; a page fills it with a portal (e.g. the report on Measurements). */
export const PAGE_ACTIONS_ID = 'page-actions';

/** Page title block (page actions on the right) with the page tabs underneath. */
export function Header({ title, subtitle, nav }: { title: string; subtitle: string; nav?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-head-top">
        <div>
          <div className="eyebrow">{t('SEO Page Performance')}</div>
          <h1>{title}</h1>
          <div className="sub">{subtitle}</div>
        </div>
        <div id={PAGE_ACTIONS_ID} className="page-actions" />
      </div>
      {nav}
    </div>
  );
}
