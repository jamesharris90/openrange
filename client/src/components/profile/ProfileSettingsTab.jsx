import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { authFetch } from '../../utils/api';

export default function ProfileSettingsTab() {
  const { user, logout } = useAuth();

  // Trading preferences
  const [currency, setCurrency] = useState('USD');
  const [timeZone, setTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [riskType, setRiskType] = useState('percent');
  const [riskValue, setRiskValue] = useState(1);
  const [settingsMsg, setSettingsMsg] = useState('');

  // Broker state
  const [broker, setBroker] = useState({ connected: false, provider: null });
  const [brokerModal, setBrokerModal] = useState(null);
  const [brokerForm, setBrokerForm] = useState({ username: '', password: '', accessToken: '', refreshToken: '' });
  const [brokerStatus, setBrokerStatus] = useState('');
  const [brokerLoading, setBrokerLoading] = useState(false);

  // Password modal
  const [showPwModal, setShowPwModal] = useState(false);
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwStatus, setPwStatus] = useState({ msg: '', color: '' });

  const loadBrokerStatus = useCallback(async () => {
    try {
      const res = await authFetch('/api/broker/status');
      const data = await res.json();
      setBroker({ connected: !!data.connected, provider: (data.provider || data.broker || '').toUpperCase() || null });
    } catch {
      setBroker({ connected: false, provider: null });
    }
  }, []);

  useEffect(() => { loadBrokerStatus(); }, [loadBrokerStatus]);

  const handleSaveSettings = () => {
    setSettingsMsg('Settings saved locally.');
    setTimeout(() => setSettingsMsg(''), 2000);
  };

  const openBrokerModal = (provider) => {
    setBrokerModal(provider);
    setBrokerForm({ username: '', password: '', accessToken: '', refreshToken: '' });
    setBrokerStatus('Sign in with broker credentials or paste an existing session token.');
  };

  const connectBroker = async () => {
    setBrokerLoading(true);
    setBrokerStatus('Connecting…');
    try {
      const res = await authFetch(`/api/broker/connect/${brokerModal}`, {
        method: 'POST',
        body: JSON.stringify({
          username: brokerForm.username || null,
          password: brokerForm.password || null,
          accessToken: brokerForm.accessToken || null,
          refreshToken: brokerForm.refreshToken || null,
        }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error || 'Connection failed');
      }
      setBrokerStatus('Connected successfully.');
      await loadBrokerStatus();
      setTimeout(() => setBrokerModal(null), 600);
    } catch (err) {
      setBrokerStatus(err.message || 'Connection failed');
    } finally {
      setBrokerLoading(false);
    }
  };

  const disconnectBroker = async () => {
    try {
      await authFetch('/api/broker/disconnect', { method: 'POST' });
      await loadBrokerStatus();
    } catch (err) {
      console.error('Disconnect failed', err);
    }
  };

  const savePassword = async () => {
    if (!pwForm.current || !pwForm.next) {
      setPwStatus({ msg: 'Please enter your current and new password.', color: 'var(--accent-orange)' });
      return;
    }
    if (pwForm.next !== pwForm.confirm) {
      setPwStatus({ msg: 'New passwords do not match.', color: 'var(--accent-red)' });
      return;
    }
    setPwStatus({ msg: 'Saving…', color: 'var(--text-muted)' });
    try {
      const res = await authFetch('/api/users/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.next }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error || 'Password change failed');
      }
      setPwStatus({ msg: 'Password updated.', color: 'var(--accent-green)' });
      setTimeout(() => setShowPwModal(false), 800);
    } catch (err) {
      setPwStatus({ msg: err.message || 'Password change failed', color: 'var(--accent-red)' });
    }
  };

  return (
    <>
      <div className="profile-grid">
        {/* Account Card */}
        <div className="panel profile-account">
          <h3 className="panel-title">Account</h3>
          <div className="profile-field">
            <label className="profile-label">Username</label>
            <div className="profile-value">{user?.username || 'Unknown'}</div>
          </div>
          <div className="profile-field">
            <label className="profile-label">Email</label>
            <div className="profile-value">{user?.email || 'Not set'}</div>
          </div>
          <div className="profile-actions">
            <button className="btn-primary" onClick={() => { setShowPwModal(true); setPwForm({ current: '', next: '', confirm: '' }); setPwStatus({ msg: '', color: '' }); }}>
              Change password
            </button>
            <button className="btn-secondary" onClick={logout}>Log Out</button>
          </div>
        </div>

        {/* Trading Preferences Card */}
        <div className="panel profile-prefs">
          <h3 className="panel-title">Trading Preferences</h3>
          <div className="profile-field">
            <label className="profile-label">Default account currency</label>
            <select className="profile-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="GBP">GBP</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
            <div className="profile-helper">Used for default position sizing and P&L display.</div>
          </div>
          <div className="profile-field">
            <label className="profile-label">Time zone</label>
            <input className="profile-input" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} />
            <div className="profile-helper">Adapts market open countdown across the app.</div>
          </div>
          <div className="profile-field">
            <label className="profile-label">Default risk per trade</label>
            <div className="profile-radio-group">
              <label className="profile-radio"><input type="radio" name="riskType" value="percent" checked={riskType === 'percent'} onChange={() => setRiskType('percent')} /> Percent of equity</label>
              <label className="profile-radio"><input type="radio" name="riskType" value="amount" checked={riskType === 'amount'} onChange={() => setRiskType('amount')} /> Fixed amount</label>
            </div>
            <input className="profile-input" type="number" min="0" step="0.1" value={riskValue} onChange={(e) => setRiskValue(Number(e.target.value) || 0)} placeholder={riskType === 'percent' ? 'e.g. 1 for 1%' : 'e.g. 500'} />
          </div>
          <button className="btn-primary" onClick={handleSaveSettings}>Save</button>
          {settingsMsg && <div className="profile-helper" style={{ color: 'var(--accent-green)', marginTop: 8 }}>{settingsMsg}</div>}
        </div>
      </div>

      {/* Broker Connections */}
      <div className="panel profile-broker">
        <div className="profile-broker-header">
          <h3 className="panel-title">Broker Connections</h3>
          <span className={`profile-broker-pill ${broker.connected ? 'connected' : ''}`}>
            {broker.connected ? `Connected · ${broker.provider}` : 'Not connected'}
          </span>
        </div>
        <div className="profile-broker-tiles">
          <button className="profile-broker-tile" onClick={() => openBrokerModal('ibkr')}>
            <div className="profile-broker-icon ibkr">IB</div>
            <div>
              <div className="profile-broker-name">IBKR</div>
              <div className="profile-broker-desc">Username / password or session token</div>
            </div>
          </button>
          <button className="profile-broker-tile" onClick={() => openBrokerModal('saxo')}>
            <div className="profile-broker-icon saxo">SX</div>
            <div>
              <div className="profile-broker-name">Saxo Trader</div>
              <div className="profile-broker-desc">Username / password or session token</div>
            </div>
          </button>
          {broker.connected && (
            <button className="btn-secondary" onClick={disconnectBroker}>Disconnect</button>
          )}
        </div>
        <div className="profile-helper">Tokens are stored server-side, read-only.</div>
      </div>

      {/* Broker Modal */}
      {brokerModal && (
        <div className="modal-overlay" onClick={() => setBrokerModal(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Connect {brokerModal.toUpperCase()}</h3>
              <button className="btn-secondary btn-sm" onClick={() => setBrokerModal(null)}>Close</button>
            </div>
            <div className="modal-body">
              <div className="profile-helper">{brokerStatus}</div>
              <div className="profile-field">
                <label className="profile-label">Username</label>
                <input className="profile-input" value={brokerForm.username} onChange={(e) => setBrokerForm(f => ({ ...f, username: e.target.value }))} placeholder="Broker username" />
              </div>
              <div className="profile-field">
                <label className="profile-label">Password</label>
                <input className="profile-input" type="password" value={brokerForm.password} onChange={(e) => setBrokerForm(f => ({ ...f, password: e.target.value }))} placeholder="Broker password" />
              </div>
              <div className="profile-field">
                <label className="profile-label">Access token</label>
                <input className="profile-input" type="password" value={brokerForm.accessToken} onChange={(e) => setBrokerForm(f => ({ ...f, accessToken: e.target.value }))} placeholder="Paste access token" />
              </div>
              <div className="profile-field">
                <label className="profile-label">Refresh token (optional)</label>
                <input className="profile-input" type="password" value={brokerForm.refreshToken} onChange={(e) => setBrokerForm(f => ({ ...f, refreshToken: e.target.value }))} placeholder="Paste refresh token" />
              </div>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setBrokerModal(null)}>Cancel</button>
                <button className="btn-primary" onClick={connectBroker} disabled={brokerLoading}>
                  {brokerLoading ? 'Connecting…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Password Modal */}
      {showPwModal && (
        <div className="modal-overlay" onClick={() => setShowPwModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Change Password</h3>
              <button className="btn-secondary btn-sm" onClick={() => setShowPwModal(false)}>Close</button>
            </div>
            <div className="modal-body">
              <div className="profile-field">
                <label className="profile-label">Current password</label>
                <input className="profile-input" type="password" value={pwForm.current} onChange={(e) => setPwForm(f => ({ ...f, current: e.target.value }))} />
              </div>
              <div className="profile-field">
                <label className="profile-label">New password</label>
                <input className="profile-input" type="password" value={pwForm.next} onChange={(e) => setPwForm(f => ({ ...f, next: e.target.value }))} />
              </div>
              <div className="profile-field">
                <label className="profile-label">Confirm new password</label>
                <input className="profile-input" type="password" value={pwForm.confirm} onChange={(e) => setPwForm(f => ({ ...f, confirm: e.target.value }))} />
              </div>
              {pwStatus.msg && <div className="profile-helper" style={{ color: pwStatus.color }}>{pwStatus.msg}</div>}
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowPwModal(false)}>Cancel</button>
                <button className="btn-primary" onClick={savePassword}>Save Password</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
