import { useEffect, useState } from 'react';
import { apiFetch } from '../api/apiClient';
import SignalCard from './SignalCard';

const REFRESH_MS = 60_000;

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function computeTradeScore(signal = {}) {
  const confidence = toNumber(signal.confidence, 0);
  const edge = Number.isFinite(Number(signal.historical_edge)) ? Number(signal.historical_edge) : 0.5;
  return Math.round((confidence * 0.6) + ((edge * 100) * 0.4));
}

function normalizeSignal(raw = {}) {
  const confidence = toNumber(raw.confidence, 0);
  const historicalEdge = Number.isFinite(Number(raw.historical_edge))
    ? Number(raw.historical_edge)
    : 0.5;

  return {
    symbol: String(raw.symbol || '--').toUpperCase(),
    confidence,
    bias: String(raw.bias || 'neutral').toLowerCase(),
    why: String(raw.why || '').trim(),
    how: raw.how && typeof raw.how === 'object' ? raw.how : null,
    historical_edge: historicalEdge,
    signal_age_minutes: Number.isFinite(Number(raw.signal_age_minutes))
      ? Number(raw.signal_age_minutes)
      : null,
    priority: String(raw.priority || 'LOW').toUpperCase(),
    sector: String(raw.sector || '').trim(),
  };
}

export default function StocksInPlayPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);
  const [mode, setMode] = useState('live');
  const [filters, setFilters] = useState({
    priority: 'ALL',
    minConfidence: 0,
    sector: 'ALL',
    maxAgeHours: 24,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const now = new Date();
        const hour = now.getUTCHours();

        // UK pre-market / off-hours logic
        const computedMode = hour < 13 ? 'research' : 'live';
        setMode(computedMode);

        const payload = await apiFetch(`/api/stocks-in-play?mode=${computedMode}`, { method: 'GET', fallback: { data: [] } });
        if (cancelled) return;

        const mapped = Array.isArray(payload?.data)
          ? payload.data.map((row) => normalizeSignal(row))
          : [];

        setRows(mapped);
        setError('');
      } catch (err) {
        if (cancelled) return;
        setError(err?.message || 'Unable to load Stocks In Play');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const timer = setInterval(load, REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const sectors = Array.from(new Set(rows.map((row) => row.sector).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));

  const filteredRows = rows
    .filter((signal) => {
      if (filters.priority === 'HIGH' && signal.priority !== 'HIGH') return false;
      if (Number(signal.confidence) < Number(filters.minConfidence || 0)) return false;
      if (filters.sector !== 'ALL' && signal.sector !== filters.sector) return false;
      if (signal.signal_age_minutes > filters.maxAgeHours * 60) return false;
      return true;
    })
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));

  const topSignals = filteredRows.slice(0, 3);
  const restSignals = filteredRows.slice(3);
  const signalCount = filteredRows.length;
  const topScore = signalCount ? Math.max(...filteredRows.map((signal) => computeTradeScore(signal))) : 0;
  const averageScore = signalCount
    ? Math.round(filteredRows.reduce((sum, signal) => sum + computeTradeScore(signal), 0) / signalCount)
    : 0;

  const showSkeleton = loading && rows.length === 0;
  const displayedMinConfidence = Math.max(60, Number(filters.minConfidence || 0));

  return (
    <section className="rounded-xl border border-slate-700/70 bg-slate-900/75 p-4 shadow-[0_12px_40px_rgba(2,6,23,0.45)]">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="m-0 text-sm font-semibold uppercase tracking-[0.14em] text-cyan-200">Stocks In Play</h3>
        {loading ? <span className="text-xs text-slate-400">Refreshing...</span> : null}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-700/80 bg-slate-950/60 p-1 text-xs">
          <button
            type="button"
            className={`rounded-md px-2.5 py-1 ${filters.priority === 'ALL' ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-300'}`}
            onClick={() => setFilters((prev) => ({ ...prev, priority: 'ALL' }))}
          >
            All
          </button>
          <button
            type="button"
            className={`rounded-md px-2.5 py-1 ${filters.priority === 'HIGH' ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-300'}`}
            onClick={() => setFilters((prev) => ({ ...prev, priority: 'HIGH' }))}
          >
            High Only
          </button>
        </div>

        <label className="inline-flex items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-950/60 px-2.5 py-1.5 text-xs text-slate-300">
          <span>Min Confidence: {displayedMinConfidence}</span>
          <input
            type="range"
            min="60"
            max="95"
            step="1"
            value={displayedMinConfidence}
            onChange={(event) => {
              const value = Number(event.target.value);
              setFilters((prev) => ({ ...prev, minConfidence: Number.isFinite(value) ? value : 0 }));
            }}
          />
        </label>

        <select
          className="rounded-lg border border-slate-700/80 bg-slate-950/70 px-2.5 py-1.5 text-xs text-slate-200"
          value={filters.sector}
          onChange={(event) => setFilters((prev) => ({ ...prev, sector: event.target.value }))}
        >
          <option value="ALL">All Sectors</option>
          {sectors.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>

        <label className="inline-flex items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-950/60 px-2.5 py-1.5 text-xs text-slate-300">
          <span>Max Age</span>
          <select
            className="rounded border border-slate-700/80 bg-slate-950/80 px-1.5 py-0.5 text-xs text-slate-200"
            value={filters.maxAgeHours}
            onChange={(event) => {
              const value = Number(event.target.value);
              setFilters((prev) => ({ ...prev, maxAgeHours: Number.isFinite(value) ? value : 24 }));
            }}
          >
            <option value={6}>6h</option>
            <option value={12}>12h</option>
            <option value={24}>24h</option>
            <option value={48}>48h</option>
          </select>
        </label>

        <span className="text-xs text-slate-400">
          Showing {filteredRows.length} of {rows.length} opportunities
        </span>
      </div>

      {showSkeleton ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <div key={item} className="rounded-2xl border border-slate-700/70 bg-slate-950/55 p-4">
              <div className="h-5 w-20 animate-pulse rounded bg-slate-700/70" />
              <div className="mt-3 h-4 w-32 animate-pulse rounded bg-slate-700/70" />
              <div className="mt-2 h-4 w-28 animate-pulse rounded bg-slate-700/70" />
              <div className="mt-4 h-16 animate-pulse rounded bg-slate-700/50" />
              <div className="mt-3 h-20 animate-pulse rounded bg-slate-700/50" />
            </div>
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      {!loading && !error ? (
        <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-3">
          <div className="rounded-lg border border-cyan-400/35 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-200">
            <div className="uppercase tracking-[0.12em] text-cyan-300/80">Top Score</div>
            <div className="mt-1 text-base font-semibold text-cyan-100">{topScore}</div>
          </div>
          <div className="rounded-lg border border-indigo-400/35 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-200">
            <div className="uppercase tracking-[0.12em] text-indigo-300/80">Average Score</div>
            <div className="mt-1 text-base font-semibold text-indigo-100">{averageScore}</div>
          </div>
          <div className="rounded-lg border border-emerald-400/35 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            <div className="uppercase tracking-[0.12em] text-emerald-300/80">Signal Count</div>
            <div className="mt-1 text-base font-semibold text-emerald-100">{signalCount}</div>
          </div>
        </div>
      ) : null}

      {topSignals.length > 0 ? (
        <div className="mb-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">Top 3 Focus</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {topSignals.map((row, index) => (
              <SignalCard key={`focus-${row.symbol || 'signal'}-${index}`} signal={row} isTop />
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {restSignals.map((row, index) => (
          <SignalCard key={`${row.symbol || 'signal'}-${index}`} signal={row} />
        ))}
      </div>

      {!loading && !error && rows.length === 0 ? (
        <div className="mt-2 text-sm text-slate-400">
          {mode === 'research'
            ? 'Market closed — showing recent opportunities'
            : 'No fresh tradeable opportunities right now'}
        </div>
      ) : null}

      {!loading && !error && rows.length > 0 && filteredRows.length === 0 ? (
        <div className="mt-2 text-sm text-slate-400">No matches — try lowering filters</div>
      ) : null}
    </section>
  );
}
