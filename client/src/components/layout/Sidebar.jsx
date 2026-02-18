import { NavLink, Link } from 'react-router-dom';
import { BarChart2, Calendar, Gauge, LayoutGrid, Newspaper, Star, Sunrise, Target, Bot, Globe2, Clock3, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const navSections = [
  {
    id: 'main',
    label: 'Main',
    items: [
      { to: '/watchlist', key: 'dashboard', icon: BarChart2, label: 'Dashboard' },
      { to: '/screeners', icon: LayoutGrid, label: 'Screeners' },
      { to: '/watchlist', key: 'watchlist', icon: Star, label: 'Watchlist' },
    ],
  },
  {
    id: 'sessions',
    label: 'Market Sessions',
    items: [
      { to: '/premarket', icon: Sunrise, label: 'Pre-Market' },
      { to: '/open-market', icon: LayoutGrid, label: 'Open Market' },
      { to: '/postmarket', icon: LayoutGrid, label: 'Post-Market' },
    ],
  },
  {
    id: 'tools',
    label: 'Tools',
    items: [
      { to: '/market-overview', icon: Globe2, label: 'Market Overview' },
      { to: '/market-hours', icon: Clock3, label: 'Market Hours' },
      { to: '/news-scanner', icon: Newspaper, label: 'News Scanner' },
      { to: '/advanced-screener', icon: Target, label: 'Advanced Screener' },
      { to: '/research', icon: Search, label: 'Research' },
      { to: '/expected-move', icon: Gauge, label: 'Expected Move' },
      { to: '/earnings', icon: Calendar, label: 'Earnings Calendar' },
      { to: '/ai-quant', icon: Bot, label: 'Intelligence Engine' },
    ],
  },
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <NavLink to="/watchlist" className="logo">
          <img src="/OpenRange_Logo_White.png" alt="OpenRange Trader" className="logo-img" />
        </NavLink>
      </div>

      <nav className="nav-section">
        {navSections.map(({ id, label, items }) => (
          <div key={id}>
            <div className="nav-label" style={id !== 'main' ? { marginTop: 24 } : undefined}>{label}</div>
            {items.map(({ to, key, icon: Icon, label: text, disabled }) => {
              if (disabled) {
                return (
                  <div key={key || to} className="nav-link nav-link--disabled" aria-disabled="true">
                    <Icon className="icon" size={18} />
                    <span className="label">{text}</span>
                  </div>
                );
              }
              return (
                <NavLink
                  key={key || to}
                  to={to}
                  className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                >
                  <Icon className="icon" size={18} />
                  <span className="label">{text}</span>
                </NavLink>
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
  const { user, isAuthenticated, isAdmin, logout } = useAuth();

  return (
    <div className="sidebar-user">
      <div className="sidebar-user__name">{isAuthenticated ? user.username : 'Guest'}</div>
      <div className="sidebar-user__role">{isAuthenticated ? 'Signed in' : 'Not signed in'}</div>
      <div className="sidebar-user__actions">
        {!isAuthenticated ? (
          <>
            <Link to="/login" className="sidebar-user__btn">Login</Link>
            <Link to="/register" className="sidebar-user__btn">Register</Link>
          </>
        ) : (
          <>
            <Link to="/profile" className="sidebar-user__btn">Profile</Link>
            {isAdmin && <Link to="/admin" className="sidebar-user__btn">Admin</Link>}
            <button className="sidebar-user__btn sidebar-user__btn--logout" onClick={logout}>
              Logout
            </button>
          </>
        )}
      </div>
    </div>
  );
}
