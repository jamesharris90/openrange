import { Activity, BarChart2, Bot, Calendar, Clock3, Globe2, LayoutGrid, LineChart, Mail, Moon, Newspaper, Search, Sunrise, Target, TrendingUp } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import UserPanel from './UserPanel';

type NavItem = {
  to: string;
  label: string;
  icon: typeof BarChart2;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    label: 'Main',
    items: [
      { to: '/dashboard',         label: 'Dashboard',         icon: BarChart2 },
      { to: '/screeners',         label: 'Screeners',         icon: LayoutGrid },
      { to: '/watchlists',        label: 'Watchlist',         icon: TrendingUp },
    ],
  },
  {
    label: 'Market Sessions',
    items: [
      { to: '/pre-market',        label: 'Pre-Market',        icon: Sunrise },
      { to: '/open-market',       label: 'Open Market',       icon: Activity },
      { to: '/post-market',       label: 'Post-Market',       icon: Moon },
    ],
  },
  {
    label: 'Tools',
    items: [
      { to: '/market-overview',   label: 'Market Overview',   icon: Globe2 },
      { to: '/market-hours',      label: 'Market Hours',      icon: Clock3 },
      { to: '/news-scanner',      label: 'News Scanner',      icon: Newspaper },
      { to: '/advanced-screener', label: 'Advanced Screener', icon: Target },
      { to: '/research',          label: 'Research',          icon: Search },
      { to: '/expected-move',     label: 'Expected Move',     icon: LineChart },
      { to: '/earnings',          label: 'Earnings Calendar', icon: Calendar },
      { to: '/intelligence-engine', label: 'Intelligence',    icon: Bot },
      { to: '/intelligence-inbox',  label: 'Intel Inbox',     icon: Mail },
    ],
  },
];

export default function Sidebar() {
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);

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
        {navGroups.map(({ label: groupLabel, items }) => (
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
