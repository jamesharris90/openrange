import { useEffect, useMemo, useState } from 'react';
import Card from '../components/shared/Card';
import TickerLink from '../components/shared/TickerLink';
import MarketPulseCards from '../components/market/MarketPulseCards';
import ButtonPrimary from '../components/ui/ButtonPrimary';
import ButtonSecondary from '../components/ui/ButtonSecondary';
import { apiJSON } from '../config/api';
import { ensurePushSubscription, getAlertPreferences, setAlertPreferences } from '../utils/pushNotifications';

function fmt(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return num.toFixed(digits);
}

export default function MobileDashboard() {
  const [signals, setSignals] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [prefs, setPrefs] = useState(getAlertPreferences());
  const [pushState, setPushState] = useState('idle');

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem('openrange:quick-watchlist') || '[]');
    setWatchlist(Array.isArray(saved) ? saved.slice(0, 8) : []);

    let cancelled = false;
    async function load() {
      try {
        const [signalsPayload, alertsPayload] = await Promise.all([
          apiJSON('/api/signals'),
          apiJSON('/api/alerts').catch(() => []),
        ]);

        if (cancelled) return;
        setSignals(Array.isArray(signalsPayload?.signals) ? signalsPayload.signals.slice(0, 8) : []);
        setAlerts(Array.isArray(alertsPayload) ? alertsPayload.slice(0, 8) : []);
      } catch {
        if (!cancelled) {
          setSignals([]);
          setAlerts([]);
        }
      }
    }

    load();
    const timer = setInterval(load, 45000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const watchlistRows = useMemo(() => (watchlist || []).map((symbol) => ({ symbol })), [watchlist]);

  const updatePref = (key) => {
    const next = setAlertPreferences({ ...prefs, [key]: !prefs[key] });
    setPrefs(next);
  };

  const enablePush = async () => {
    setPushState('loading');
    try {
      const nextPrefs = setAlertPreferences({ ...prefs, enabled: true });
      setPrefs(nextPrefs);
      await ensurePushSubscription(import.meta.env.VITE_VAPID_PUBLIC_KEY, nextPrefs);
      setPushState('enabled');
    } catch (error) {
      setPushState(`error:${error?.message || 'Failed to enable push'}`);
    }
  };

  return (
    <div className="space-y-3 md:hidden">
      <Card>
        <h2 className="m-0 text-lg font-semibold">Mobile Dashboard</h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">Compact mobile command center for indices, signals, watchlist, and alerts.</p>
      </Card>

      <Card>
        <h3 className="mb-2 mt-0 text-sm font-semibold">Market Indices</h3>
        <MarketPulseCards />
      </Card>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="m-0 text-sm font-semibold">Signals</h3>
          <span className="text-xs text-[var(--text-muted)]">{signals.length}</span>
        </div>
        <div className="space-y-2">
          {(signals || []).length === 0 ? <div className="text-xs text-[var(--text-muted)]">No signal alerts right now.</div> : (signals || []).map((row, idx) => (
            <div key={`${row?.symbol || 's'}-${idx}`} className="rounded border border-[var(--border-default)] p-2 text-xs">
              <div className="flex items-center justify-between">
                <TickerLink symbol={row?.symbol} />
                <strong>Score {fmt(row?.score, 1)}</strong>
              </div>
              <div className="mt-1 text-[var(--text-muted)]">{row?.strategy || row?.setup_type || '--'} · Gap {fmt(row?.gap_percent, 2)}%</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="mb-2 mt-0 text-sm font-semibold">Watchlist</h3>
        <div className="grid grid-cols-2 gap-2">
          {(watchlistRows || []).length === 0 ? <div className="text-xs text-[var(--text-muted)]">No watchlist symbols saved.</div> : (watchlistRows || []).map((row) => (
            <div key={row.symbol} className="rounded border border-[var(--border-default)] p-2 text-xs">
              <TickerLink symbol={row.symbol} />
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="m-0 text-sm font-semibold">Alerts</h3>
          <span className="text-xs text-[var(--text-muted)]">{alerts.length}</span>
        </div>
        <div className="space-y-2">
          {(alerts || []).length === 0 ? <div className="text-xs text-[var(--text-muted)]">No active alerts.</div> : (alerts || []).map((row, idx) => (
            <div key={`${row?.id || idx}`} className="rounded border border-[var(--border-default)] p-2 text-xs">
              <div className="font-semibold">{row?.symbol || '--'} · {row?.condition || row?.type || 'Alert'}</div>
              <div className="text-[var(--text-muted)]">{row?.message || row?.description || '--'}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="mb-2 mt-0 text-sm font-semibold">Push Alerts</h3>
        <div className="mb-2 grid grid-cols-1 gap-2 text-xs">
          <label className="flex items-center justify-between rounded border border-[var(--border-default)] p-2"><span>Price alerts</span><input type="checkbox" checked={prefs.priceAlerts} onChange={() => updatePref('priceAlerts')} /></label>
          <label className="flex items-center justify-between rounded border border-[var(--border-default)] p-2"><span>Signal alerts</span><input type="checkbox" checked={prefs.signalAlerts} onChange={() => updatePref('signalAlerts')} /></label>
          <label className="flex items-center justify-between rounded border border-[var(--border-default)] p-2"><span>News alerts</span><input type="checkbox" checked={prefs.newsAlerts} onChange={() => updatePref('newsAlerts')} /></label>
        </div>
        <div className="flex items-center gap-2">
          <ButtonPrimary onClick={enablePush} disabled={pushState === 'loading'}>Enable Push</ButtonPrimary>
          <ButtonSecondary onClick={() => setPushState('idle')}>Reset</ButtonSecondary>
        </div>
        <div className="mt-2 text-xs text-[var(--text-muted)]">State: {pushState}</div>
      </Card>
    </div>
  );
}
