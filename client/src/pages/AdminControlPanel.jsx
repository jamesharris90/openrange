import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { authFetchJSON, authFetch } from '../utils/api';
import { useFeatureAccess } from '../hooks/useFeatureAccess';

const TABS = ['users', 'features', 'audit', 'system'];

function roleColor(role) {
  if (role === 'admin') return 'bg-red-500/15 text-red-300';
  if (role === 'ultimate') return 'bg-purple-500/15 text-purple-300';
  if (role === 'pro') return 'bg-blue-500/15 text-blue-300';
  return 'bg-slate-500/15 text-slate-300';
}

export default function AdminControlPanel() {
  const { refreshFeatures } = useFeatureAccess();
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [registryGrouped, setRegistryGrouped] = useState({});
  const [auditRows, setAuditRows] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [selectedUserData, setSelectedUserData] = useState(null);
  const [newsletterSummary, setNewsletterSummary] = useState({ subscriberCount: 0, campaigns: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const stats = useMemo(() => {
    const base = { total: users.length, free: 0, pro: 0, ultimate: 0, admin: 0 };
    for (const user of users) {
      const role = String(user?.role || 'free');
      if (base[role] !== undefined) base[role] += 1;
    }
    return base;
  }, [users]);

  async function loadBase() {
    setLoading(true);
    setError('');
    try {
      const [usersPayload, registryPayload, auditPayload, newsletterPayload] = await Promise.all([
        authFetchJSON('/api/admin/features/users'),
        authFetchJSON('/api/admin/features/registry'),
        authFetchJSON('/api/admin/features/audit'),
        authFetchJSON('/api/admin/features/newsletter/summary'),
      ]);

      const nextUsers = usersPayload?.items || [];
      setUsers(nextUsers);
      setRegistryGrouped(registryPayload?.grouped || {});
      setAuditRows(auditPayload?.items || []);
      setNewsletterSummary({
        subscriberCount: newsletterPayload?.subscriberCount || 0,
        campaigns: newsletterPayload?.campaigns || [],
      });

      if (!selectedUserId && nextUsers[0]?.id) {
        setSelectedUserId(nextUsers[0].id);
      }
    } catch (err) {
      setError(err?.message || 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  }

  async function loadSelectedUser(userId) {
    if (!userId) return;
    setError('');
    try {
      const payload = await authFetchJSON(`/api/admin/features/user/${userId}`);
      setSelectedUserData(payload || null);
    } catch (err) {
      setSelectedUserData(null);
      setError(err?.message || 'Failed to load selected user');
    }
  }

  useEffect(() => {
    loadBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedUserId) return;
    loadSelectedUser(selectedUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserId]);

  async function updateRole(userId, role) {
    try {
      await authFetchJSON(`/api/admin/features/user/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      await loadBase();
      if (selectedUserId === userId) await loadSelectedUser(userId);
      await refreshFeatures();
    } catch (err) {
      setError(err?.message || 'Failed to update role');
    }
  }

  async function updateFeature(featureKey, enabled) {
    if (!selectedUserId) return;
    try {
      await authFetchJSON(`/api/admin/features/user/${selectedUserId}/feature`, {
        method: 'PATCH',
        body: JSON.stringify({ featureKey, enabled, reason: 'Admin control panel override' }),
      });
      await loadSelectedUser(selectedUserId);
      await loadBase();
    } catch (err) {
      setError(err?.message || 'Failed to update feature override');
    }
  }

  async function triggerNewsletterSend() {
    try {
      const res = await authFetch('/api/newsletter/send', { method: 'POST' });
      if (!res.ok) throw new Error(`Newsletter send failed (${res.status})`);
      await loadBase();
    } catch (err) {
      setError(err?.message || 'Newsletter send failed');
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-3 text-sm">
        <div className="mb-2 text-xs text-[var(--text-muted)]">Admin / Control Panel</div>
        <div className="flex flex-wrap gap-2">
          <Link className="rounded border border-[var(--border-color)] px-3 py-1" to="/admin-control">Admin</Link>
          <Link className="rounded border border-[var(--border-color)] px-3 py-1" to="/admin/diagnostics">Diagnostics</Link>
          <Link className="rounded border border-[var(--border-color)] px-3 py-1" to="/admin-control">Features</Link>
          <Link className="rounded border border-[var(--border-color)] px-3 py-1" to="/admin-control">Users</Link>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Admin Control Panel</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Role management, feature flags, and audit visibility.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { label: 'Total Users', value: stats.total },
          { label: 'Free Users', value: stats.free },
          { label: 'Pro Users', value: stats.pro },
          { label: 'Ultimate Users', value: stats.ultimate },
          { label: 'Admin Users', value: stats.admin },
        ].map((card) => (
          <div key={card.label} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-3">
            <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{card.label}</p>
            <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-3">
        <div className="mb-3 flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                activeTab === tab
                  ? 'bg-[var(--accent-blue)] text-white'
                  : 'border border-[var(--border-color)] text-[var(--text-secondary)]'
              }`}
            >
              {tab === 'users' && 'Users'}
              {tab === 'features' && 'Feature Controls'}
              {tab === 'audit' && 'Audit Trail'}
              {tab === 'system' && 'System Links'}
            </button>
          ))}
        </div>

        {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
        {loading && <p className="mb-2 text-sm text-[var(--text-muted)]">Loading admin data...</p>}

        {activeTab === 'users' && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--text-muted)]">
                  <th className="pb-2 pr-2">User</th>
                  <th className="pb-2 pr-2">Email</th>
                  <th className="pb-2 pr-2">Role</th>
                  <th className="pb-2 pr-2">Quick Role</th>
                </tr>
              </thead>
              <tbody>
                {(users || []).map((user) => (
                  <tr key={user.id} className="border-t border-[var(--border-color)]">
                    <td className="py-2 pr-2">{user.username || `User ${user.id}`}</td>
                    <td className="py-2 pr-2">{user.email || '--'}</td>
                    <td className="py-2 pr-2">
                      <span className={`rounded px-2 py-0.5 text-xs ${roleColor(user.role)}`}>{user.role || 'free'}</span>
                    </td>
                    <td className="py-2 pr-2">
                      <select
                        className="rounded border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1"
                        value={user.role || 'free'}
                        onChange={(event) => updateRole(user.id, event.target.value)}
                      >
                        <option value="free">free</option>
                        <option value="pro">pro</option>
                        <option value="ultimate">ultimate</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'features' && (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-[var(--text-muted)]">Select user</label>
              <select
                className="rounded border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1"
                value={selectedUserId || ''}
                onChange={(event) => setSelectedUserId(Number(event.target.value) || null)}
              >
                {(users || []).map((user) => (
                  <option key={user.id} value={user.id}>{`${user.username || user.email || user.id} (${user.role || 'free'})`}</option>
                ))}
              </select>
            </div>

            {selectedUserData && (
              <div className="space-y-3">
                {Object.entries(registryGrouped || {}).map(([category, items]) => (
                  <div key={category} className="rounded border border-[var(--border-color)] p-2">
                    <p className="mb-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">{category}</p>
                    <div className="grid gap-2 md:grid-cols-2">
                      {(items || []).map((feature) => {
                        const key = feature.key;
                        const resolved = Boolean(selectedUserData?.features?.[key]);
                        const hasOverride = Object.prototype.hasOwnProperty.call(selectedUserData?.overrides || {}, key);
                        const overrideValue = selectedUserData?.overrides?.[key];
                        const defaultValue = hasOverride ? !overrideValue : resolved;

                        return (
                          <label key={key} className="flex items-center justify-between rounded border border-[var(--border-color)] px-2 py-1">
                            <div>
                              <p className="text-sm text-[var(--text-primary)]">{feature.label}</p>
                              <p className="text-xs text-[var(--text-muted)]">
                                default: {String(defaultValue)} | override: {hasOverride ? String(overrideValue) : 'none'}
                              </p>
                            </div>
                            <input
                              type="checkbox"
                              checked={resolved}
                              onChange={(event) => updateFeature(key, event.target.checked)}
                            />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--text-muted)]">
                  <th className="pb-2 pr-2">Time</th>
                  <th className="pb-2 pr-2">User</th>
                  <th className="pb-2 pr-2">Action</th>
                  <th className="pb-2 pr-2">Feature/Role</th>
                  <th className="pb-2 pr-2">Actor</th>
                </tr>
              </thead>
              <tbody>
                {(auditRows || []).map((row) => (
                  <tr key={row.id} className="border-t border-[var(--border-color)]">
                    <td className="py-2 pr-2">{row.changed_at ? new Date(row.changed_at).toLocaleString() : '--'}</td>
                    <td className="py-2 pr-2">{row.email || row.username || row.user_id || '--'}</td>
                    <td className="py-2 pr-2">{row.action}</td>
                    <td className="py-2 pr-2">{row.feature_key || `${row.old_role || '--'} -> ${row.new_role || '--'}`}</td>
                    <td className="py-2 pr-2">{row.actor_username || row.changed_by || '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'system' && (
          <div className="grid gap-3 md:grid-cols-2">
            <a className="rounded border border-[var(--border-color)] p-3" href="/admin/diagnostics">System Diagnostics</a>
            <a className="rounded border border-[var(--border-color)] p-3" href="/signal-intelligence-admin">Signal Intelligence Admin</a>
            <a className="rounded border border-[var(--border-color)] p-3" href="/strategy-evaluation">Strategy Evaluation</a>
            <button type="button" className="rounded border border-[var(--border-color)] p-3 text-left" onClick={triggerNewsletterSend}>
              Newsletter Admin: Trigger Send
            </button>
            <a className="rounded border border-[var(--border-color)] p-3" href="/dashboard">Dashboard</a>
            <a className="rounded border border-[var(--border-color)] p-3" href="/cockpit">Cockpit</a>
            <div className="rounded border border-[var(--border-color)] p-3">
              <p className="text-sm font-medium">Newsletter Summary</p>
              <p className="text-xs text-[var(--text-muted)]">Subscribers: {newsletterSummary.subscriberCount || 0}</p>
              <p className="text-xs text-[var(--text-muted)]">Recent campaigns: {(newsletterSummary.campaigns || []).length}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
