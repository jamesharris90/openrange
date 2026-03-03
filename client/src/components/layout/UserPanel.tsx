import { LogOut, Settings, User } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

type UserPanelProps = {
  compact?: boolean;
  inSidebar?: boolean;
};

export default function UserPanel({ compact = false, inSidebar = false }: UserPanelProps) {
  const { user, logout } = useAuth();

  if (!user) return null;

  if (compact) {
    return (
      <aside className={`user-panel user-panel--compact${inSidebar ? ' user-panel--sidebar' : ''}`} aria-label="User panel">
        <Link to="/profile" className="user-panel__avatar" title={user.username || 'User'}>
          {(user.username || 'U').slice(0, 1).toUpperCase()}
        </Link>
      </aside>
    );
  }

  return (
    <aside className={`user-panel${inSidebar ? ' user-panel--sidebar' : ''}`} aria-label="User panel">
      <div className="user-panel__name">{user.username || 'User'}</div>
      <div className="user-panel__meta">{user.email || 'Account'}</div>
      <div className="user-panel__actions">
        <Link to="/profile" className="user-panel__btn" title="Profile">
          <User size={14} />
          Profile
        </Link>
        <Link to="/profile" className="user-panel__btn" title="Settings">
          <Settings size={14} />
          Settings
        </Link>
        <button type="button" className="user-panel__btn user-panel__btn--logout" onClick={logout} title="Logout">
          <LogOut size={14} />
          Logout
        </button>
      </div>
    </aside>
  );
}
