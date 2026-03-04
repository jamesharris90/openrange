import { X } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';

const mobileItems = [
  { to: '/pre-market-command', label: 'Pre-Market Command' },
  { to: '/open-market-radar', label: 'Open Market Radar' },
  { to: '/post-market-review', label: 'Post-Market Review' },
  { to: '/screeners', label: 'Scanner' },
  { to: '/research', label: 'Research' },
  { to: '/dashboard', label: 'Dashboard' },
];

export default function MobileDrawer() {
  const mobileSidebarOpen = useAppStore((state) => state.mobileSidebarOpen);
  const toggleMobileSidebar = useAppStore((state) => state.toggleMobileSidebar);

  if (!mobileSidebarOpen) return null;

  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <button
        type="button"
        aria-label="Close drawer backdrop"
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={toggleMobileSidebar}
      />

      <aside className="relative z-50 h-full w-64 border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] p-3 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-[var(--text-secondary)]">OpenRange</div>
          <button
            type="button"
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-[var(--border-color)] text-[var(--text-secondary)]"
            onClick={toggleMobileSidebar}
            aria-label="Close drawer"
          >
            <X size={16} />
          </button>
        </div>

        <nav className="space-y-1 overflow-y-auto">
          {mobileItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={toggleMobileSidebar}
              className={({ isActive }) =>
                `flex min-h-10 items-center rounded-md px-3 text-sm ${
                  isActive
                    ? 'bg-[rgba(74,158,255,0.15)] text-[var(--accent-blue)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
    </div>
  );
}
