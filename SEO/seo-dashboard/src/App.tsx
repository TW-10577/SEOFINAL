import { useState } from 'react'
import './App.css'
import Header from './components/Header'
import { I18nProvider, useI18n } from './i18n'
import Sidebar from './components/Sidebar'
import DataUpload from './pages/DataUpload'
import Dashboard from './pages/Dashboard'
import AnomaliesPage from './pages/Anomalies'
import CountermeasuresPage from './pages/Countermeasures'
import ReportsPage from './pages/Reports'
import DataPage from './pages/Data'
import MeasurementsPage from './pages/Measurements'

type CurrentPage = 'dashboard' | 'upload' | 'data' | 'measurements' | 'anomalies' | 'countermeasures' | 'reports'

const TABS = [
  { id: 'dashboard', label: 'tab.dashboard' },
  { id: 'upload', label: 'tab.upload' },
  { id: 'data', label: 'tab.data' },
  { id: 'measurements', label: 'tab.measurements' },
  { id: 'anomalies', label: 'tab.anomalies' },
  { id: 'countermeasures', label: 'tab.countermeasures' },
  { id: 'reports', label: 'tab.reports' },
] as const

function App() {
  return (
    <I18nProvider>
      <Shell />
    </I18nProvider>
  )
}

function Shell() {
  const { t } = useI18n()
  const [currentPage, setCurrentPage] = useState<CurrentPage>('dashboard')
  const renderPage = () => {
    switch (currentPage) {
      case 'upload':
        return <DataUpload />
      case 'dashboard':
        return <Dashboard onUpload={() => setCurrentPage('upload')} />
      case 'data':
        return <DataPage />
      case 'measurements':
        return <MeasurementsPage />
      case 'anomalies':
        return <AnomaliesPage />
      case 'countermeasures':
        return <CountermeasuresPage />
      case 'reports':
        return <ReportsPage />
      default:
        return <Dashboard onUpload={() => setCurrentPage('upload')} />
    }
  }

  return (
    <div className="shell">
      <Header />
      <Sidebar />
      <main className="main-content">
        <nav className="surface-tabs" aria-label="SEO sections">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={currentPage === tab.id ? 'active' : ''}
              aria-current={currentPage === tab.id ? 'page' : undefined}
              onClick={() => setCurrentPage(tab.id)}
            >
              {t(tab.label)}
            </button>
          ))}
        </nav>
        {renderPage()}
      </main>
    </div>
  )
}

export default App
