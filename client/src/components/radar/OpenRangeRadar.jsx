import { useEffect, useMemo, useState } from 'react';
import { fetchRadar, fetchRadarTopTrades } from '../../api/radarApi';
import RadarSection from './RadarSection';
import RadarDiagnostics from '../system/RadarDiagnostics';
import SystemWatchdog from '../system/SystemWatchdog';

const RADAR_TIMEOUT_MS = 10000;

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Radar request timed out')), timeoutMs);
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

function normalizeRadarPayload(payload) {
  const radar = payload?.radar && typeof payload.radar === 'object' ? payload.radar : {};
  return {
    generated_at: payload?.generated_at || null,
    radar: {
      market_summary: Array.isArray(radar.market_summary) ? radar.market_summary : [],
      stocks_in_play: Array.isArray(radar.stocks_in_play) ? radar.stocks_in_play : [],
      momentum_leaders: Array.isArray(radar.momentum_leaders) ? radar.momentum_leaders : [],
      news_catalysts: Array.isArray(radar.news_catalysts) ? radar.news_catalysts : [],
      a_plus_setups: Array.isArray(radar.a_plus_setups) ? radar.a_plus_setups : [],
    },
  };
}

export default function OpenRangeRadar() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState(() => normalizeRadarPayload({}));
  const [topTrades, setTopTrades] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function loadRadar() {
      setLoading(true);
      setError('');
      try {
        const [radarResult, topTradesResult] = await Promise.allSettled([
          withTimeout(fetchRadar(), RADAR_TIMEOUT_MS),
          withTimeout(fetchRadarTopTrades(), RADAR_TIMEOUT_MS),
        ]);

        if (cancelled) return;

        if (radarResult.status === 'fulfilled') {
          setPayload(normalizeRadarPayload(radarResult.value));
        } else {
          setPayload(normalizeRadarPayload({}));
        }

        if (topTradesResult.status === 'fulfilled') {
          setTopTrades(Array.isArray(topTradesResult.value?.trades) ? topTradesResult.value.trades : []);
        } else {
          setTopTrades([]);
        }

        const errors = [];
        if (radarResult.status === 'rejected') errors.push(radarResult.reason?.message || 'Failed to load radar data');
        if (topTradesResult.status === 'rejected') errors.push(topTradesResult.reason?.message || 'Failed to load top trades');
        setError(errors.join(' | '));
      } catch (err) {
        if (!cancelled) {
          setPayload(normalizeRadarPayload({}));
          setTopTrades([]);
          setError(err?.message || 'Failed to load radar data');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadRadar();
    const timer = setInterval(loadRadar, 15000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const sections = useMemo(() => {
    const radar = payload.radar;
    return [
      { title: 'Top Trades Today', items: topTrades },
      { title: 'Stocks in Play', items: radar.stocks_in_play },
      { title: 'Momentum Leaders', items: radar.momentum_leaders },
      { title: 'News Catalysts', items: radar.news_catalysts },
      { title: 'A+ Setups', items: radar.a_plus_setups },
    ];
  }, [payload, topTrades]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
        <h2 className="m-0 text-lg">OpenRange Radar Command Center</h2>
        <p className="m-0 mt-1 text-sm text-[var(--text-muted)]">
          Live command view sourced from <code>/api/radar/today</code> and <code>/api/radar/top-trades</code>.
        </p>
      </div>

      {loading && (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 text-sm text-[var(--text-muted)]">
          Loading radar signal grid...
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-red-400/40 bg-red-500/10 p-4 text-sm">
          {error}
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-2">
        <RadarDiagnostics generatedAt={payload.generated_at} radar={payload.radar} />
        <SystemWatchdog />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {sections.map((section) => (
          <RadarSection key={section.title} title={section.title} items={section.items} />
        ))}
      </div>
    </div>
  );
}
