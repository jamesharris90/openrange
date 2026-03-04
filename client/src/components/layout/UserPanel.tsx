import { LogOut, Settings, User } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

type UserPanelProps = {
  compact?: boolean;
  inSidebar?: boolean;
};

export default function UserPanel({ compact = false }: UserPanelProps) {
  const { user, logout } = useAuth();

  if (!user) return null;

  const initial = (user.username || 'U').slice(0, 1).toUpperCase();

  if (compact) {
    return (
      <div className="flex justify-center" aria-label="User panel">
        <Link
          to="/profile"
          title={user.username || 'User'}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent-blue)] text-xs font-semibold text-white hover:opacity-90"
        >
          {initial}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2" aria-label="User panel">
      <div className="flex items-center gap-2 px-1">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-blue)] text-xs font-semibold text-white">
          {initial}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--text-primary)]">{user.username || 'User'}</p>
          <p className="truncate text-[11px] text-[var(--text-muted)]">{user.email || 'Account'}</p>
        </div>
      </div>
      <div className="flex gap-1">
        <Link
          to="/profile"
          title="Profile"
          className="flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
        >
          <User size={12} />
          <span>Profile</span>
        </Link>
        <Link
          to="/profile"
          title="Settings"
          className="flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-primary)]"
        >
          <Settings size={12} />
          <span>Settings</span>
        </Link>
        <button
          type="button"
          onClick={logout}
          title="Logout"
          className="flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[rgba(239,68,68,0.15)] hover:text-red-400"
        >
          <LogOut size={12} />
          <span>Logout</span>
        </button>
      </div>
    </div>
  );
}
