import { NavLink, useLocation } from 'react-router-dom';
import { BarChart2, Search, Star, Sunrise, LayoutGrid, Sunset, Globe2, TrendingUp, Newspaper, Target, Microscope, Bot, Gauge, Calendar } from 'lucide-react';

const vanillaLinks = [
  { section: 'Main', links: [
    { href: '/index.html', icon: BarChart2, label: 'Dashboard' },
    { href: '/screeners.html', icon: Search, label: 'Screeners' },
  ]},
  { section: 'Market Sessions', links: [
    { href: '/premarket.html', icon: Sunrise, label: 'Pre-Market' },
    { href: '/open-market.html', icon: LayoutGrid, label: 'Open Market' },
    { href: '/postmarket.html', icon: Sunset, label: 'Post-Market' },
  ]},
  { section: 'Tools', links: [
    { href: '/market-overview.html', icon: Globe2, label: 'Market Overview' },
    { href: '/market-hours.html', icon: TrendingUp, label: 'Market Hours' },
    { href: '/news-scanner.html', icon: Newspaper, label: 'News Scanner' },
    { href: '/advanced-screener.html', icon: Target, label: 'Advanced Screener' },
    { href: '/research.html', icon: Microscope, label: 'Research' },
  ]},
];

const reactLinks = [
  { to: '/watchlist', icon: Star, label: 'Watchlist', afterSection: 'Main' },
  { to: '/ai-quant', icon: Bot, label: 'Intelligence Engine', afterSection: 'Tools' },
  { href: '/options-expected-move.html', icon: Gauge, label: 'Expected Move', afterSection: 'Tools' },
  { to: '/earnings', icon: Calendar, label: 'Earnings Calendar', afterSection: 'Tools' },
];

export default function Sidebar() {
  const location = useLocation();

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <a href="/index.html" className="logo">
          <div className="logo-icon">
            <img src="/logo pack/openrange_icon.png" alt="OpenRange Trader" />
          </div>
          <div className="logo-text">
            <div className="brand-name">
              <span className="open">Open</span><span className="range">Range</span>
            </div>
            <div className="brand-tagline">TRADER</div>
          </div>
        </a>
      </div>

      <nav className="nav-section">
        {vanillaLinks.map(({ section, links }) => (
          <div key={section}>
            <div className="nav-label" style={section !== 'Main' ? { marginTop: 24 } : undefined}>{section}</div>
            {links.map(({ href, icon: Icon, label }) => (
              <a key={href} href={href} className="nav-link">
                <Icon className="icon" size={18} />
                <span className="label">{label}</span>
              </a>
            ))}
            {reactLinks.filter(r => r.afterSection === section).map(({ to, href, icon: Icon, label }) => {
              if (to) {
                return (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                  >
                    <Icon className="icon" size={18} />
                    <span className="label">{label}</span>
                  </NavLink>
                );
              }
              return (
                <a key={href} href={href} className="nav-link">
                  <Icon className="icon" size={18} />
                  <span className="label">{label}</span>
                </a>
              );
            })}
          </div>
        ))}
      </nav>

      <UserPanel />
    </aside>
  );
}

function UserPanel() {
  let username = 'Guest';
  let isLoggedIn = false;
  let isAdmin = false;

  try {
    const token = localStorage.getItem('authToken');
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1]));
      username = payload.username || 'User';
      isLoggedIn = true;
      isAdmin = !!payload.is_admin;
    }
  } catch {}

  return (
    <div className="sidebar-user">
      <div className="sidebar-user__name">{username}</div>
      <div className="sidebar-user__role">{isLoggedIn ? 'Signed in' : 'Not signed in'}</div>
      <div className="sidebar-user__actions">
        {!isLoggedIn && (
          <>
            <a href="/login.html" className="sidebar-user__btn">Login</a>
            <a href="/register.html" className="sidebar-user__btn">Register</a>
          </>
        )}
        {isLoggedIn && (
          <>
            <a href="/user.html" className="sidebar-user__btn">Profile</a>
            {isAdmin && <a href="/admin.html" className="sidebar-user__btn">Admin</a>}
            <button className="sidebar-user__btn sidebar-user__btn--logout" onClick={() => { localStorage.removeItem('authToken'); window.location.href = '/login.html'; }}>Logout</button>
          </>
        )}
      </div>
    </div>
  );
}
