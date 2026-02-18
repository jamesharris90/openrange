import { useState, useEffect, useCallback } from 'react';
import { Shield, Users, Activity, Settings, RefreshCw, UserPlus, LogIn, Link2, UserCheck, X } from 'lucide-react';
import { authFetch } from '../utils/api';

const TABS = [
  { id: 'overview', label: 'Overview', icon: Shield },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'activity', label: 'Activity Log', icon: Activity },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function AdminPage() {
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [search, setSearch] = useState('');
  const [alert, setAlert] = useState(null);

  // Create user modal
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ username: '', email: '', password: '', is_admin: false });

  const showAlert = (msg, type = 'success') => {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 4000);
  };

  const loadStats = useCallback(async () => {
    try {
      const res = await authFetch('/api/users/admin/stats');
      if (res.ok) setStats(await res.json());
    } catch {}
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const res = await authFetch('/api/users/admin/list');
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || data || []);
      }
    } catch {}
  }, []);

  const loadActivity = useCallback(async () => {
    try {
      const res = await authFetch('/api/users/admin/activity');
      if (res.ok) {
        const data = await res.json();
        setActivityLog(data.activities || data || []);
      }
    } catch {}
  }, []);

  const loadAll = useCallback(() => {
    loadStats();
    loadUsers();
    loadActivity();
  }, [loadStats, loadUsers, loadActivity]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const deleteUser = async (id, username) => {
    if (!window.confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    try {
      const res = await authFetch('/api/users/admin/delete', {
        method: 'POST',
        body: JSON.stringify({ userId: id }),
      });
      if (res.ok) {
        showAlert(`User "${username}" deleted.`);
        loadUsers();
        loadStats();
      } else {
        const data = await res.json().catch(() => ({}));
        showAlert(data.error || 'Delete failed', 'error');
      }
    } catch {
      showAlert('Network error', 'error');
    }
  };

  const createUser = async () => {
    try {
      const res = await authFetch('/api/users/admin/create', {
        method: 'POST',
        body: JSON.stringify(createForm),
      });
      if (res.ok) {
        showAlert(`User "${createForm.username}" created.`);
        setShowCreate(false);
        setCreateForm({ username: '', email: '', password: '', is_admin: false });
        loadUsers();
        loadStats();
      } else {
        const data = await res.json().catch(() => ({}));
        showAlert(data.error || 'Create failed', 'error');
      }
    } catch {
      showAlert('Network error', 'error');
    }
  };

  const filteredUsers = users.filter(u =>
    !search || u.username?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page-container admin-page">
      <div className="admin-top">
        <div className="admin-title">
          <Shield size={28} className="admin-title-icon" />
          <h2>Admin Dashboard</h2>
        </div>
        <button className="btn-secondary btn-sm" onClick={loadAll}><RefreshCw size={14} /> Refresh</button>
      </div>

      {alert && <div className={`admin-alert admin-alert--${alert.type}`}>{alert.msg}</div>}

      <nav className="admin-tabs">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} className={`admin-tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </nav>

      {/* Overview */}
      {tab === 'overview' && (
        <div>
          <div className="admin-stats-grid">
            <StatCard icon={Users} gradient="blue" value={stats?.totalUsers ?? '-'} label="Total Users" />
            <StatCard icon={UserCheck} gradient="purple" value={stats?.activeUsers ?? '-'} label="Active Users" />
            <StatCard icon={Shield} gradient="orange" value={stats?.adminCount ?? '-'} label="Admins" />
            <StatCard icon={Link2} gradient="green" value={stats?.brokerConnected ?? '-'} label="Brokers Connected" />
            <StatCard icon={UserPlus} gradient="amber" value={stats?.newToday ?? '-'} label="New Today" />
            <StatCard icon={LogIn} gradient="pink" value={stats?.loginsToday ?? '-'} label="Logins Today" />
          </div>
          <div className="admin-overview-grid">
            <div className="panel">
              <h3 className="panel-title">Recent Users</h3>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th>Username</th><th>Email</th><th>Created</th></tr></thead>
                  <tbody>
                    {users.slice(0, 5).map(u => (
                      <tr key={u.id}>
                        <td>{u.username}</td>
                        <td>{u.email}</td>
                        <td className="text-muted">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}</td>
                      </tr>
                    ))}
                    {users.length === 0 && <tr><td colSpan={3} className="admin-empty">No users found</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="panel">
              <h3 className="panel-title">Recent Activity</h3>
              <div className="admin-activity-list">
                {activityLog.slice(0, 8).map((a, i) => (
                  <div key={i} className="admin-activity-item">
                    <div className="admin-activity-action">{a.action}</div>
                    <div className="admin-activity-details">{a.username || a.user_id} · {a.ip_address || ''}</div>
                    <div className="admin-activity-time">{a.created_at ? new Date(a.created_at).toLocaleString() : ''}</div>
                  </div>
                ))}
                {activityLog.length === 0 && <div className="admin-empty">No activity yet</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Users */}
      {tab === 'users' && (
        <div>
          <div className="admin-users-toolbar">
            <input className="admin-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users…" />
            <button className="btn-primary btn-sm" onClick={() => setShowCreate(true)}><UserPlus size={14} /> Create User</button>
          </div>
          <div className="panel">
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Username</th><th>Email</th><th>Role</th><th>Broker</th><th>Created</th><th>Actions</th></tr></thead>
                <tbody>
                  {filteredUsers.map(u => (
                    <tr key={u.id}>
                      <td>{u.username}</td>
                      <td>{u.email}</td>
                      <td>{u.is_admin ? <span className="admin-badge admin-badge--admin">Admin</span> : <span className="admin-badge admin-badge--user">User</span>}</td>
                      <td>{u.broker_connected ? <span className="admin-badge admin-badge--connected">Connected</span> : '-'}</td>
                      <td className="text-muted">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}</td>
                      <td>
                        <button className="admin-action-btn admin-action-btn--danger" onClick={() => deleteUser(u.id, u.username)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                  {filteredUsers.length === 0 && <tr><td colSpan={6} className="admin-empty">No users found</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Activity Log */}
      {tab === 'activity' && (
        <div className="panel">
          <div className="admin-activity-list">
            {activityLog.map((a, i) => (
              <div key={i} className="admin-activity-item">
                <div className="admin-activity-action">{a.action}</div>
                <div className="admin-activity-details">{a.username || a.user_id} · {a.ip_address || ''}</div>
                <div className="admin-activity-time">{a.created_at ? new Date(a.created_at).toLocaleString() : ''}</div>
              </div>
            ))}
            {activityLog.length === 0 && <div className="admin-empty">No activity logged yet.</div>}
          </div>
        </div>
      )}

      {/* Settings */}
      {tab === 'settings' && (
        <div className="panel">
          <h3 className="panel-title">System Settings</h3>
          <div className="admin-empty">Settings management coming soon.</div>
        </div>
      )}

      {/* Create User Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create User</h3>
              <button className="modal-close" onClick={() => setShowCreate(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="profile-field">
                <label className="profile-label">Username</label>
                <input className="profile-input" value={createForm.username} onChange={(e) => setCreateForm(f => ({ ...f, username: e.target.value }))} />
              </div>
              <div className="profile-field">
                <label className="profile-label">Email</label>
                <input className="profile-input" type="email" value={createForm.email} onChange={(e) => setCreateForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="profile-field">
                <label className="profile-label">Password</label>
                <input className="profile-input" type="password" value={createForm.password} onChange={(e) => setCreateForm(f => ({ ...f, password: e.target.value }))} />
              </div>
              <div className="profile-field">
                <label className="profile-radio">
                  <input type="checkbox" checked={createForm.is_admin} onChange={(e) => setCreateForm(f => ({ ...f, is_admin: e.target.checked }))} />
                  Admin privileges
                </label>
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button className="btn-primary" onClick={createUser}>Create</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, gradient, value, label }) {
  return (
    <div className="admin-stat-card">
      <div className={`admin-stat-icon admin-stat-icon--${gradient}`}>
        <Icon size={20} />
      </div>
      <div className="admin-stat-value">{value}</div>
      <div className="admin-stat-label">{label}</div>
    </div>
  );
}
