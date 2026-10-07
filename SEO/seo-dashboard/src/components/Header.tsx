import { useI18n } from '../i18n'
import './Header.css'

export default function Header() {
  const { lang, setLang, t } = useI18n()
  return (
    <header>
      <div className="header-left">
        <div className="brand">LOGOS</div>
        <div className="domain">{t('app.domain')}</div>
      </div>
      <div className="header-right">
        <div className="lang-switch" role="group" aria-label="Language">
          <button className={lang === 'en' ? 'active' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
            EN
          </button>
          <button className={lang === 'ja' ? 'active' : ''} aria-pressed={lang === 'ja'} onClick={() => setLang('ja')}>
            日本語
          </button>
        </div>
      </div>
    </header>
  )
}
