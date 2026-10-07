import type { ReactNode } from 'react';
import { t, type Lang } from '../i18n.ts';

export function TopBar({ lang, onLang }: { lang: Lang; onLang: (l: Lang) => void }) {
  return (
    <header className="topbar">
      <div>
        <div className="wordmark">LOGOS</div>
        <div className="tagline">{t('SEO Workbench · Page Performance PoC')}</div>
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

export function Header({ title, subtitle, nav }: { title: string; subtitle: string; nav?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">{t('SEO Page Performance')}</div>
        <h1>{title}</h1>
        <div className="sub">{subtitle}</div>
      </div>
      {nav}
    </div>
  );
}
