import './Sidebar.css'

export default function Sidebar() {
  return (
    <aside>
      <nav className="nav-items">
        <button className="nav active" aria-current="page">
          <div className="nav-text">
            <div className="nav-title">SEO</div>
            <span>Page performance: GSC and GA4 analysis, anomalies and countermeasures.</span>
          </div>
        </button>
      </nav>
    </aside>
  )
}
