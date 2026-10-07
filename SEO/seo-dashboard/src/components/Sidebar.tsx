import { useI18n } from '../i18n'
import './Sidebar.css'

export default function Sidebar() {
  const { t } = useI18n()
  return (
    <aside>
      <nav className="nav-items">
        <button className="nav active" aria-current="page">
          <div className="nav-text">
            <div className="nav-title">SEO</div>
            <span>{t('app.sidebar')}</span>
          </div>
        </button>
      </nav>
    </aside>
  )
}
