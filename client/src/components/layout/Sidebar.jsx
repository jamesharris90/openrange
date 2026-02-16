import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { BarChart2, Calendar, Gauge, LayoutGrid, Newspaper, Star, Sunrise, Target, Bot, Globe2, Clock3, Search } from 'lucide-react';

const navSections = [
  {
    id: 'main',
    label: 'Main',
    items: [
      { to: '/watchlist', icon: BarChart2, label: 'Dashboard' },
      { to: '/screeners', icon: LayoutGrid, label: 'Screeners' },
      { to: '/watchlist', icon: Star, label: 'Watchlist' },
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
          <div className="logo-icon">
            <img src="/logo pack/openrange_icon.png" alt="OpenRange Trader" />
          </div>
          <div className="logo-text">
            <div className="brand-name">
              <span className="open">Open</span><span className="range">Range</span>
            </div>
            <div className="brand-tagline">TRADER</div>
          </div>
        </NavLink>
      </div>

      <nav className="nav-section">
        {navSections.map(({ id, label, items }) => (
          <div key={id}>
            <div className="nav-label" style={id !== 'main' ? { marginTop: 24 } : undefined}>{label}</div>
            {items.map(({ to, icon: Icon, label: text, disabled }) => {
              if (disabled) {
                return (
                  <div key={to} className="nav-link nav-link--disabled" aria-disabled="true">
                    <Icon className="icon" size={18} />
                    <span className="label">{text}</span>
                  </div>
                );
              }
              return (
                <NavLink
                  key={to}
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
  const [user, setUser] = useState({ username: 'Guest', isLoggedIn: false, isAdmin: false });

  useEffect(() => {
    try {
      const token = localStorage.getItem('authToken');
      if (token) {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUser({
          username: payload.username || 'User',
          isLoggedIn: true,
          isAdmin: !!payload.is_admin,
        });
        return;
      }
    } catch (e) {
      console.warn('Failed to parse auth token', e);
    }
    setUser({ username: 'Guest', isLoggedIn: false, isAdmin: false });
  }, []);

  const actions = useMemo(() => {
    if (!user.isLoggedIn) {
      return (
        <>
          <a href="/pages/login.html" className="sidebar-user__btn">Login</a>
          <a href="/pages/register.html" className="sidebar-user__btn">Register</a>
        </>
      );
    }
    return (
      <>
        <a href="/pages/user.html" className="sidebar-user__btn">Profile</a>
        {user.isAdmin && <a href="/pages/admin.html" className="sidebar-user__btn">Admin</a>}
        <button
          className="sidebar-user__btn sidebar-user__btn--logout"
          onClick={() => {
            localStorage.removeItem('authToken');
            window.location.href = '/pages/login.html';
          }}
        >
          Logout
        </button>
      </>
    );
  }, [user]);

  return (
    <div className="sidebar-user">
      <div className="sidebar-user__name">{user.username}</div>
      <div className="sidebar-user__role">{user.isLoggedIn ? 'Signed in' : 'Not signed in'}</div>
      <div className="sidebar-user__actions">{actions}</div>
    </div>
  );
}
