import { memo, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Activity,
  Brain,
  ChevronDown,
  ChevronRight,
  Database,
  Flag,
  Gauge,
  LineChart,
  Radar,
  Shield,
  SlidersHorizontal,
  Users,
} from 'lucide-react';

const NAV_GROUPS = [
  {
    key: 'system',
    label: 'SYSTEM',
    items: [
      { to: '/admin/system-diagnostics', label: 'System Diagnostics', icon: Gauge },
      { to: '/admin/intelligence-monitor', label: 'Intelligence Monitor', icon: Brain },
      { to: '/admin/system-monitor', label: 'System Activity', icon: Activity },
    ],
  },
  {
    key: 'control',
    label: 'CONTROL',
    items: [
      { to: '/admin/users', label: 'Users', icon: Users },
      { to: '/admin-control?tab=roles', label: 'Roles', icon: Shield },
      { to: '/admin/features', label: 'Feature Flags', icon: Flag },
      { to: '/admin-control?tab=audit', label: 'Audit Trail', icon: Database },
    ],
  },
  {
    key: 'signals',
    label: 'SIGNALS',
    items: [
      { to: '/signal-intelligence-admin', label: 'Signal Intelligence', icon: Radar },
      { to: '/signal-intelligence-admin?section=order-flow', label: 'Order Flow Monitor', icon: Activity },
      { to: '/signal-intelligence-admin?section=opportunity', label: 'Opportunity Engine', icon: LineChart },
    ],
  },
  {
    key: 'learning',
    label: 'LEARNING',
    items: [
      { to: '/admin/learning-dashboard', label: 'Learning Dashboard', icon: Brain },
      { to: '/admin/strategy-edge', label: 'Strategy Edge', icon: LineChart },
      { to: '/admin/learning', label: 'Market Regime', icon: SlidersHorizontal },
    ],
  },
  {
    key: 'validation',
    label: 'VALIDATION',
    items: [
      { to: '/admin/calibration', label: 'Calibration Dashboard', icon: SlidersHorizontal },
      { to: '/admin/missed-opportunities', label: 'Missed Opportunities', icon: Activity },
      { to: '/admin/validation', label: 'Signal Validation', icon: Gauge },
    ],
  },
];

function isActivePath(current, target) {
  const cleanCurrent = current.split('?')[0];
  const cleanTarget = target.split('?')[0];
  return cleanCurrent === cleanTarget;
}

function AdminSidebar({ isOpen = true, onNavigate }) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => ({
    system: false,
    control: false,
    signals: false,
    learning: false,
    validation: false,
  }));

  const groups = useMemo(() => NAV_GROUPS, []);

  function toggleGroup(key) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleGroupKey(event, key) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleGroup(key);
    }
  }

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 w-[260px] border-r border-slate-800 bg-slate-950 transition-transform lg:static lg:translate-x-0 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
      aria-label="Admin navigation"
    >
      <div className="h-14 border-b border-slate-800 px-4">
        <div className="flex h-full items-center text-sm font-semibold tracking-wide text-slate-100">OpenRange Admin</div>
      </div>
      <nav className="h-[calc(100vh-56px)] overflow-y-auto px-3 py-4">
        {groups.map((group) => {
          const isCollapsed = Boolean(collapsed[group.key]);
          return (
            <section key={group.key} className="mb-3">
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                onKeyDown={(event) => handleGroupKey(event, group.key)}
                className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs font-semibold tracking-wider text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                aria-expanded={!isCollapsed}
                aria-controls={`group-${group.key}`}
              >
                <span>{group.label}</span>
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </button>

              {!isCollapsed ? (
                <ul id={`group-${group.key}`} className="mt-1 space-y-1">
                  {group.items.map((item) => {
                    const active = isActivePath(location.pathname, item.to);
                    const Icon = item.icon;
                    return (
                      <li key={item.to}>
                        <Link
                          to={item.to}
                          onClick={onNavigate}
                          className={`flex items-center gap-2 rounded-md px-2 py-2 text-sm transition ${
                            active
                              ? 'border border-blue-500/30 bg-blue-500/10 text-blue-300'
                              : 'text-slate-300 hover:bg-slate-900 hover:text-slate-100'
                          }`}
                        >
                          <Icon size={16} />
                          <span>{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>
          );
        })}
      </nav>
    </aside>
  );
}

export default memo(AdminSidebar);
