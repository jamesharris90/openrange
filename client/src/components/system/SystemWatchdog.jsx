import { useEffect, useState } from 'react';
import { fetchWatchdog } from '../../api/systemApi';

const WATCHDOG_TIMEOUT_MS = 10000;

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Watchdog request timed out')), timeoutMs);
    promise
      .then((data) => {
        clearTimeout(timer);
        resolve(data);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function displayDate(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') return '--';
  return String(value);
}

export default function SystemWatchdog() {
  const [watchdog, setWatchdog] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadWatchdog() {
      try {
        const payload = await withTimeout(fetchWatchdog(), WATCHDOG_TIMEOUT_MS);
        if (cancelled) return;
        setWatchdog(payload?.watchdog || null);
        setError('');
      } catch (err) {
        if (cancelled) return;
        setWatchdog(null);
        setError(err?.message || 'Failed to load watchdog');
      }
    }

    loadWatchdog();
    const timer = setInterval(loadWatchdog, 15000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <section className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
      <h3 className="m-0 mb-3 text-base">Platform Watchdog</h3>
      {error ? <div className="mb-3 text-sm text-[var(--text-muted)]">{error}</div> : null}
      <div className="grid gap-2 text-sm">
        <div className="flex items-center justify-between"><span>Stream Status</span><strong>{displayValue(watchdog?.stream_status)}</strong></div>
        <div className="flex items-center justify-between"><span>Signals Generated</span><strong>{displayValue(watchdog?.intelligence_signals)}</strong></div>
        <div className="flex items-center justify-between"><span>News Events</span><strong>{displayValue(watchdog?.news_events)}</strong></div>
        <div className="flex items-center justify-between"><span>Last Opportunity Time</span><strong>{displayDate(watchdog?.last_opportunity)}</strong></div>
      </div>
    </section>
  );
}
