import { Activity, BarChart2, Bell, BookOpen, CandlestickChart, Compass, Inbox, LayoutDashboard, LineChart, Moon, Newspaper, Search, Sunrise, UserCircle } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { useFeatureAccess } from '../../hooks/useFeatureAccess';
import UserPanel from './UserPanel';

type NavItem = {
  to: string;
  label: string;
  icon: typeof BarChart2;
  feature?: string;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    label: 'Command Centers',
    items: [
      { to: '/pre-market-command', label: 'Pre-Market Command', icon: Sunrise },
      { to: '/open-market-radar',  label: 'Open Market Radar',  icon: Activity },
      { to: '/post-market-review', label: 'Post-Market Review', icon: Moon },
    ],
  },
  {
    label: 'Discovery',
    items: [
      { to: '/screener',          label: 'Scanner',            icon: BarChart2 },
      { to: '/screener-full',     label: 'Full Screener',      icon: Compass, feature: 'full_screener' },
      { to: '/sector-heatmap',    label: 'Sector Heatmap',     icon: Activity },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { to: '/intelligence-inbox',  label: 'Intel Inbox',        icon: Inbox },
      { to: '/intelligence-engine', label: 'Intelligence Engine', icon: LineChart },
      { to: '/news-feed',           label: 'News Feed',          icon: Newspaper },
    ],
  },
  {
    label: 'Trading Tools',
    items: [
      { to: '/charts',             label: 'Charts',             icon: CandlestickChart },
      { to: '/cockpit',            label: 'Trading Cockpit',    icon: LayoutDashboard, feature: 'trading_cockpit' },
      { to: '/expected-move',      label: 'Expected Move',      icon: LineChart },
      { to: '/earnings-calendar',  label: 'Earnings Calendar',  icon: BookOpen },
      { to: '/strategy-evaluation', label: 'Strategy Evaluation', icon: LineChart },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: BarChart2 },
      { to: '/mobile-dashboard', label: 'Mobile Dashboard', icon: Activity },
      { to: '/alerts', label: 'Alerts', icon: Bell, feature: 'alerts' },
      { to: '/research', label: 'Research', icon: Search },
      { to: '/admin/features', label: 'Admin Control', icon: LayoutDashboard, feature: 'admin_panel' },
      { to: '/profile', label: 'Profile', icon: UserCircle },
    ],
  },
];

export default function Sidebar() {
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const { features, loading } = useFeatureAccess();

  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: loading
        ? group.items
        : group.items.filter((item) => !item.feature || Boolean(features?.[item.feature])),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <aside
      className={`fixed left-0 top-14 z-40 hidden h-[calc(100vh-56px)] flex-col border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] transition-[width] duration-300 ease-in-out md:flex ${
        sidebarCollapsed ? 'w-16' : 'w-60'
      }`}
    >
      <div className="flex items-center justify-end p-2">
        <button
          type="button"
          onClick={toggleSidebar}
          className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-[var(--border-color)] text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]"
          aria-label="Toggle sidebar"
        >
          {sidebarCollapsed ? '»' : '«'}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {visibleGroups.map(({ label: groupLabel, items }) => (
          <div key={groupLabel} className="mb-3">
            {!sidebarCollapsed && (
              <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                {groupLabel}
              </p>
            )}
            <div className="space-y-0.5">
              {items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex min-h-10 items-center rounded-md px-2.5 text-sm transition-colors ${
                      isActive
                        ? 'bg-[rgba(74,158,255,0.15)] text-[var(--accent-blue)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]'
                    }`
                  }
                  title={label}
                >
                  <Icon size={18} className="shrink-0" />
                  {!sidebarCollapsed && <span className="ml-3 truncate">{label}</span>}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-[var(--border-color)] p-2">
        <UserPanel compact={sidebarCollapsed} inSidebar />
      </div>
    </aside>
  );
}
