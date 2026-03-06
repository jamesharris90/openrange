import { useEffect, useState } from 'react';
import ProfileSettingsTab from '../components/profile/ProfileSettingsTab';
import PerformanceTab from '../components/profile/PerformanceTab';
import { authFetch } from '../utils/api';

const EMPTY_PREFS = {
  layouts: [],
  watchlists: [],
  alerts: [],
  theme: 'light',
  scannerPresets: [],
  dataPreference: 'standard',
};

export default function ProfilePage() {
  const [tab, setTab] = useState('settings');
  const [prefs, setPrefs] = useState(EMPTY_PREFS);
  const [layoutName, setLayoutName] = useState('');
  const [alertSetting, setAlertSetting] = useState('Open market alerts');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await authFetch('/api/users/profile/preferences');
        if (!response.ok) return;
        const payload = await response.json();
        if (cancelled) return;
        setPrefs(payload?.preferences || EMPTY_PREFS);
      } catch {
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function persist(next) {
    setPrefs(next);
    try {
      await authFetch('/api/users/profile/preferences', {
        method: 'PUT',
        body: JSON.stringify(next),
      });
    } catch {
    }
  }

  return (
    <div className="page-container profile-page">
      <div className="profile-header">
        <h2>Account & Settings</h2>
        <div className="profile-tabs">
          <button className={`profile-tab${tab === 'settings' ? ' active' : ''}`} onClick={() => setTab('settings')}>Settings</button>
          <button className={`profile-tab${tab === 'performance' ? ' active' : ''}`} onClick={() => setTab('performance')}>Performance</button>
          <button className={`profile-tab${tab === 'workspace' ? ' active' : ''}`} onClick={() => setTab('workspace')}>Workspace</button>
        </div>
      </div>

      {tab === 'settings' && <ProfileSettingsTab />}
      {tab === 'performance' && <PerformanceTab />}

      {tab === 'workspace' && (
        <div className="space-y-3">
          <div className="rounded border border-[var(--border-color)] p-3">
            <h3 className="m-0 mb-2 text-sm">Saved Layouts</h3>
            <div className="mb-2 flex gap-2">
              <input
                className="input-field"
                placeholder="Layout name"
                value={layoutName}
                onChange={(event) => setLayoutName(event.target.value)}
              />
              <button
                type="button"
                className="btn-primary px-3 py-1"
                onClick={() => {
                  const name = layoutName.trim();
                  if (!name) return;
                  const next = { ...prefs, layouts: Array.from(new Set([...(prefs.layouts || []), name])) };
                  setLayoutName('');
                  persist(next);
                }}
              >
                Save
              </button>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {(prefs.layouts || []).map((name) => (
                <span key={name} className="rounded border border-[var(--border-color)] px-2 py-1">{name}</span>
              ))}
              {!(prefs.layouts || []).length && <span className="muted">No saved layouts.</span>}
            </div>
          </div>

          <div className="rounded border border-[var(--border-color)] p-3">
            <h3 className="m-0 mb-2 text-sm">Alert Settings</h3>
            <div className="mb-2 flex gap-2">
              <input
                className="input-field"
                placeholder="Alert preference"
                value={alertSetting}
                onChange={(event) => setAlertSetting(event.target.value)}
              />
              <button
                type="button"
                className="btn-primary px-3 py-1"
                onClick={() => {
                  const value = alertSetting.trim();
                  if (!value) return;
                  persist({ ...prefs, alerts: Array.from(new Set([...(prefs.alerts || []), value])) });
                  setAlertSetting('');
                }}
              >
                Add
              </button>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {(prefs.alerts || []).map((name) => (
                <span key={name} className="rounded border border-[var(--border-color)] px-2 py-1">{name}</span>
              ))}
              {!(prefs.alerts || []).length && <span className="muted">No alert settings saved.</span>}
            </div>
          </div>

          <div className="rounded border border-[var(--border-color)] p-3">
            <h3 className="m-0 mb-2 text-sm">Data Preference</h3>
            <select
              className="input-field"
              value={prefs.dataPreference || 'standard'}
              onChange={(event) => persist({ ...prefs, dataPreference: event.target.value })}
            >
              <option value="standard">Standard</option>
              <option value="institutional">Institutional</option>
              <option value="execution">Execution Focused</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
