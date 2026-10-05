import { FC } from 'react'
import './Header.css'

const Header: FC = () => {
  return (
    <header>
      <div className="header-left">
        <div className="brand">LOGOS</div>
        <div className="domain">SEO DOMAIN · 0.0.1</div>
      </div>
      <div className="header-right"></div>
    </header>
  )
}

export default Header
