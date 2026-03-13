import { NavLink } from 'react-router-dom';

const ADMIN_LINKS = [
  { to: '/admin/system', label: 'System' },
  { to: '/admin/learning', label: 'Learning' },
  { to: '/admin/signals', label: 'Signals' },
  { to: '/admin/validation', label: 'Validation' },
  { to: '/admin-control', label: 'Control' },
];

export default function AdminLayout({ title, children }) {
  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3 backdrop-blur">
        <div className="mb-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">OpenRange Admin</div>
        <div className="flex flex-wrap gap-2">
          {ADMIN_LINKS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (
                `rounded-md border px-3 py-1.5 text-sm transition ${
                  isActive
                    ? 'border-sky-500/60 bg-sky-500/15 text-sky-200'
                    : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                }`
              )}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </div>
      {title ? <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{title}</h1> : null}
      {children}
    </div>
  );
}
