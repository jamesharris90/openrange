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

const EMAIL_TYPES = [
  { key: 'morning_beacon_brief', label: 'Morning Beacon Brief' },
  { key: 'premarket_movers', label: 'Premarket Movers' },
  { key: 'sector_rotation_update', label: 'Sector Rotation Update' },
  { key: 'evening_review', label: 'Evening Review' },
  { key: 'high_conviction_alerts', label: 'High Conviction Alerts' },
];

export default function ProfilePage() {
  const [tab, setTab] = useState('settings');
  const [prefs, setPrefs] = useState(EMPTY_PREFS);
  const [layoutName, setLayoutName] = useState('');
  const [alertSetting, setAlertSetting] = useState('Open market alerts');
  const [emailPrefs, setEmailPrefs] = useState({
    isActive: false,
    timezone: '',
    emailPreferences: {},
  });
  const [emailPrefsSaving, setEmailPrefsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [profileResponse, emailResponse] = await Promise.all([
          authFetch('/api/users/profile/preferences'),
          authFetch('/api/newsletter/preferences'),
        ]);

        if (!cancelled && profileResponse?.ok) {
          const payload = await profileResponse.json();
          setPrefs(payload?.preferences || EMPTY_PREFS);
        }

        if (!cancelled && emailResponse?.ok) {
          const emailPayload = await emailResponse.json();
          setEmailPrefs({
            isActive: Boolean(emailPayload?.data?.isActive),
            timezone: String(emailPayload?.data?.timezone || ''),
            emailPreferences: emailPayload?.data?.emailPreferences || {},
          });
        }
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

  async function persistEmailPreferences(next) {
    setEmailPrefs(next);
    setEmailPrefsSaving(true);
    try {
      await authFetch('/api/newsletter/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          isActive: next.isActive,
          timezone: next.timezone || null,
          emailPreferences: next.emailPreferences || {},
        }),
      });
    } catch {
    } finally {
      setEmailPrefsSaving(false);
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
              {(prefs.layouts || [])?.map((name) => (
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
              {(prefs.alerts || [])?.map((name) => (
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

          <div className="rounded border border-[var(--border-color)] p-3">
            <h3 className="m-0 mb-2 text-sm">Email Subscriptions</h3>
            <label className="mb-2 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={Boolean(emailPrefs.isActive)}
                onChange={(event) => persistEmailPreferences({ ...emailPrefs, isActive: event.target.checked })}
              />
              Enable OpenRange emails
            </label>

            <div className="mb-2">
              <label className="mb-1 block text-xs text-[var(--text-muted)]">Timezone (optional)</label>
              <input
                className="input-field"
                placeholder="America/New_York"
                value={emailPrefs.timezone || ''}
                onChange={(event) => setEmailPrefs((prev) => ({ ...prev, timezone: event.target.value }))}
                onBlur={() => persistEmailPreferences(emailPrefs)}
              />
            </div>

            <div className="space-y-2 text-xs">
              {EMAIL_TYPES.map((item) => (
                <label key={item.key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(emailPrefs?.emailPreferences?.[item.key])}
                    onChange={(event) => {
                      const next = {
                        ...emailPrefs,
                        emailPreferences: {
                          ...(emailPrefs.emailPreferences || {}),
                          [item.key]: event.target.checked,
                        },
                      };
                      persistEmailPreferences(next);
                    }}
                  />
                  {item.label}
                </label>
              ))}
            </div>

            {emailPrefsSaving ? <p className="mt-2 text-xs text-[var(--text-muted)]">Saving email preferences...</p> : null}
          </div>
        </div>
      )}
    </div>
  );
}
