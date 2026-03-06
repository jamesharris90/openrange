import { useMemo, useState } from 'react';

const STORAGE_KEY = 'openrange:broker-token';

function getStoredToken() {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export default function BrokerConnectPanel() {
  const [broker, setBroker] = useState('interactive-brokers');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState(getStoredToken());
  const [status, setStatus] = useState(token ? 'Connected (local token)' : 'Not connected');

  const canConnect = useMemo(() => username.trim() && password.trim(), [username, password]);

  function handleConnect() {
    if (!canConnect) return;

    const pseudoToken = `bk_${Date.now()}_${btoa(`${broker}:${username}`).replace(/=/g, '')}`;
    try {
      localStorage.setItem(STORAGE_KEY, pseudoToken);
      setToken(pseudoToken);
      setStatus('Connected (token stored locally)');
      setPassword('');
    } catch {
      setStatus('Failed to persist token in local storage');
    }
  }

  return (
    <section className="rounded border border-[var(--border-default)] bg-[var(--bg-card)] p-3">
      <h3 className="m-0 mb-2 text-sm font-semibold">Broker Connect</h3>

      <label className="mb-2 block text-xs">
        Broker
        <select
          value={broker}
          onChange={(event) => setBroker(event.target.value)}
          className="mt-1 w-full rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1"
        >
          <option value="interactive-brokers">Interactive Brokers</option>
        </select>
      </label>

      <label className="mb-2 block text-xs">
        Username
        <input
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          className="mt-1 w-full rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1"
          placeholder="Enter broker username"
        />
      </label>

      <label className="mb-3 block text-xs">
        Password
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1 w-full rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1"
          placeholder="Enter broker password"
        />
      </label>

      <button
        type="button"
        onClick={handleConnect}
        disabled={!canConnect}
        className="w-full rounded bg-[var(--accent-blue)] px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        Connect
      </button>

      <div className="mt-2 text-[11px] text-[var(--text-muted)]">{status}</div>
      {token ? <div className="mt-1 break-all text-[10px] text-[var(--text-muted)]">token: {token}</div> : null}
    </section>
  );
}
