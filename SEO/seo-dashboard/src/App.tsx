import { useState } from 'react'
import './App.css'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import DataUpload from './pages/DataUpload'
import Dashboard from './pages/Dashboard'
import AnomaliesPage from './pages/Anomalies'
import CountermeasuresPage from './pages/Countermeasures'
import ReportsPage from './pages/Reports'

type CurrentPage = 'dashboard' | 'upload' | 'anomalies' | 'countermeasures' | 'reports'

const TABS: { id: CurrentPage; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'upload', label: 'Upload data' },
  { id: 'anomalies', label: 'Anomalies' },
  { id: 'countermeasures', label: 'Countermeasures' },
  { id: 'reports', label: 'Reports' },
]

function App() {
  const [currentPage, setCurrentPage] = useState<CurrentPage>('dashboard')
  const renderPage = () => {
    switch (currentPage) {
      case 'upload':
        return <DataUpload />
      case 'dashboard':
        return <Dashboard onUpload={() => setCurrentPage('upload')} />
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
          {TABS.map((t) => (
            <button
              key={t.id}
              className={currentPage === t.id ? 'active' : ''}
              aria-current={currentPage === t.id ? 'page' : undefined}
              onClick={() => setCurrentPage(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        {renderPage()}
      </main>
    </div>
  )
}

export default App
