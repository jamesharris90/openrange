import { Link } from 'react-router-dom';

const LINKS = [
  { to: '/admin-control', label: 'Admin Control Panel' },
  { to: '/admin/diagnostics', label: 'Diagnostics' },
  { to: '/admin/system-monitor', label: 'System Monitor' },
  { to: '/admin/intelligence-monitor', label: 'Intelligence Monitor' },
  { to: '/admin/features', label: 'Feature Controls' },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin-control', label: 'Audit Trail' },
];

export default function AdminLayout({ section = 'Admin' }) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-3 text-sm">
      <div className="mb-2 text-xs text-[var(--text-muted)]">{`Admin / ${section}`}</div>
      <div className="flex flex-wrap gap-2">
        {LINKS.map((item) => (
          <Link key={`${item.to}-${item.label}`} className="rounded border border-[var(--border-color)] px-3 py-1" to={item.to}>{item.label}</Link>
        ))}
        <Link className="rounded border border-[var(--border-color)] px-3 py-1" to="/admin-control">Back to Admin Panel</Link>
      </div>
    </div>
  );
}
