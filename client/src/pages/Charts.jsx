import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ChartEngine from '../components/chartEngine/ChartEngine';
import ChartContainer from '../components/layout/ChartContainer';
import { getProfileForTimeframe, normalizeTimeframe } from '../components/chartEngine/indicatorRegistry';
import { useSymbolData } from '../context/symbol/useSymbolData';
import { authFetch } from '../utils/api';

const DEFAULT_WATCHLIST = ['SPY', 'QQQ', 'AMD', 'AMZN'];
const TIMEFRAME_BUTTONS = [
  { value: '1m', label: '1m' },
  { value: '3m', label: '3m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '1H', label: '1h' },
  { value: '4H', label: '4h' },
  { value: '1D', label: '1D' },
  { value: '1W', label: '1W' },
  { value: 'ALL', label: 'All' },
];
const INDICATOR_BUTTONS = [
  { key: 'ema9', label: 'EMA9' },
  { key: 'ema20', label: 'EMA20' },
  { key: 'ema50', label: 'EMA50' },
  { key: 'ema200', label: 'EMA200' },
  { key: 'vwap', label: 'VWAP' },
  { key: 'volume', label: 'Volume' },
  { key: 'rsi', label: 'RSI' },
  { key: 'macd', label: 'MACD' },
];

const SECTOR_TO_ETF = {
  technology: 'XLK',
  financials: 'XLF',
  energy: 'XLE',
  healthcare: 'XLV',
  communication: 'XLC',
  industrials: 'XLI',
  materials: 'XLB',
  'real estate': 'XLRE',
  utilities: 'XLU',
  'consumer staples': 'XLP',
  'consumer discretionary': 'XLY',
};

function mapSectorToEtf(rawSector) {
  const normalized = String(rawSector || '').trim().toLowerCase();
  if (!normalized) return null;
  if (SECTOR_TO_ETF[normalized]) return SECTOR_TO_ETF[normalized];
  if (normalized.includes('tech')) return 'XLK';
  if (normalized.includes('financial')) return 'XLF';
  if (normalized.includes('energy')) return 'XLE';
  if (normalized.includes('health')) return 'XLV';
  if (normalized.includes('communication')) return 'XLC';
  if (normalized.includes('industrial')) return 'XLI';
  if (normalized.includes('material')) return 'XLB';
  if (normalized.includes('real estate')) return 'XLRE';
  if (normalized.includes('utilit')) return 'XLU';
  if (normalized.includes('staples')) return 'XLP';
  if (normalized.includes('discretionary')) return 'XLY';
  return null;
}

export default function Charts() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { state, setSymbol, setTimeframe } = useSymbolData();

  const initialSymbol = String(searchParams.get('symbol') || 'SPY').toUpperCase();
  const initialTimeframe = normalizeTimeframe(String(searchParams.get('timeframe') || '5m'));

  const [symbolInput, setSymbolInput] = useState(state.symbol || initialSymbol);
  const [indicatorState, setIndicatorState] = useState({
    ema9: false,
    ema20: false,
    ema50: false,
    ema200: false,
    vwap: false,
    volume: false,
    rsi: false,
    macd: false,
    structures: false,
  });
  const [marketOverlay, setMarketOverlay] = useState('none');
  const [patternMode, setPatternMode] = useState(false);
  const [drawingsBusy, setDrawingsBusy] = useState(false);
  const [sectorEtfSymbol, setSectorEtfSymbol] = useState(null);
  const symbol = state.symbol || initialSymbol;
  const timeframe = state.timeframe || initialTimeframe;

  const profile = useMemo(() => getProfileForTimeframe(timeframe), [timeframe]);

  useEffect(() => {
    const querySymbol = String(searchParams.get('symbol') || '').toUpperCase();
    const queryTimeframe = normalizeTimeframe(String(searchParams.get('timeframe') || ''));
    if (querySymbol && querySymbol !== symbol) setSymbol(querySymbol);
    if (queryTimeframe && queryTimeframe !== timeframe) setTimeframe(queryTimeframe);
  }, []);

  useEffect(() => {
    setSymbolInput(symbol);
  }, [symbol]);

  const saveDrawings = async (drawings) => {
    const response = await authFetch('/api/v5/drawings', {
      method: 'PUT',
      body: JSON.stringify({
        symbol,
        timeframe,
        drawings,
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || 'Failed to save drawings');
    }
  };

  const fetchDrawings = async () => {
    const response = await authFetch(`/api/v5/drawings?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`);
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || 'Failed to load drawings');
    }
    const payload = await response.json();
    return Array.isArray(payload) ? payload : [];
  };

  const addLastCloseLine = async () => {
    if (!state.candles.history.length) return;
    const last = state.candles.history[state.candles.history.length - 1];
    const price = Number(last?.close);
    if (!Number.isFinite(price)) return;

    setDrawingsBusy(true);
    try {
      const existing = await fetchDrawings();
      const next = [
        ...existing,
        {
          id: `${symbol}-${timeframe}-${Date.now()}`,
          type: 'hline',
          price,
          label: `${symbol} ${price.toFixed(2)}`,
        },
      ];
      await saveDrawings(next);
    } finally {
      setDrawingsBusy(false);
    }
  };

  const clearAllLines = async () => {
    setDrawingsBusy(true);
    try {
      await saveDrawings([]);
    } finally {
      setDrawingsBusy(false);
    }
  };

  useEffect(() => {
    setSearchParams({ symbol, timeframe }, { replace: true });
  }, [symbol, timeframe, setSearchParams]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const response = await authFetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`);
        if (!response.ok) throw new Error('quote fetch failed');
        const payload = await response.json();
        const mapped = mapSectorToEtf(payload?.sector);
        if (!active) return;
        setSectorEtfSymbol(mapped);
        if (!mapped) {
          setMarketOverlay((prev) => (prev === 'SECTOR' ? 'none' : prev));
        }
      } catch (_error) {
        if (!active) return;
        setSectorEtfSymbol(null);
        setMarketOverlay((prev) => (prev === 'SECTOR' ? 'none' : prev));
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [symbol]);

  return (
    <div className="h-full min-h-0">
      <div className="grid h-full min-h-[calc(100vh-88px)] grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_240px]">
        <section className="flex min-h-0 flex-col border border-white/10 bg-[var(--bg-surface)]">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
            <input
              value={symbolInput}
              onChange={(event) => setSymbolInput(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  const next = String(symbolInput || '').trim().toUpperCase();
                  if (next) setSymbol(next);
                }
              }}
              className="h-9 w-32 rounded-md border border-white/20 bg-[var(--bg-input)] px-3 text-sm"
              placeholder="Symbol"
            />
            <div className="ml-2 flex flex-wrap items-center gap-1 rounded-md bg-[var(--bg-input)] p-1">
              {TIMEFRAME_BUTTONS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setTimeframe(item.value)}
                  className={`rounded px-3 py-1 text-xs font-semibold ${timeframe === item.value ? 'bg-blue-600 text-white' : 'text-[var(--text-secondary)] hover:bg-white/5'}`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1 rounded-md bg-[var(--bg-input)] p-1">
              {INDICATOR_BUTTONS.map((item) => {
                const disabled = item.key === 'vwap' && timeframe === '1D';
                const active = disabled ? false : Boolean(indicatorState[item.key]);
                return (
                <button
                  key={item.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    setIndicatorState((prev) => ({ ...prev, [item.key]: !prev[item.key] }));
                  }}
                  className={`rounded px-2 py-1 text-xs font-semibold ${active ? 'bg-emerald-600 text-white' : 'text-[var(--text-secondary)] hover:bg-white/5'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  {item.label}
                </button>
                );
              })}
            </div>

            <div className="flex items-center gap-3 rounded-md bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-secondary)]">
              {[{ key: 'SPY', label: 'SPY' }, { key: 'QQQ', label: 'QQQ' }, { key: 'SECTOR', label: 'Sector ETF (auto)' }].map((item) => {
                const disabled = item.key === 'SECTOR' && !sectorEtfSymbol;
                return (
                  <label key={item.key} className={`inline-flex items-center gap-1 ${disabled ? 'opacity-50' : ''}`}>
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={marketOverlay === item.key}
                      onChange={(event) => {
                        if (!event.target.checked) {
                          setMarketOverlay('none');
                          return;
                        }
                        setMarketOverlay(item.key);
                      }}
                    />
                    <span>{item.label}</span>
                  </label>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setPatternMode((prev) => !prev)}
              className={`rounded-md border px-3 py-2 text-xs font-semibold ${patternMode ? 'border-emerald-500/60 bg-emerald-600/20 text-emerald-100' : 'border-white/20 bg-[var(--bg-input)] text-[var(--text-secondary)] hover:bg-white/5'}`}
            >
              Pattern
            </button>

            <button
              type="button"
              disabled={drawingsBusy || !state.candles.history.length}
              onClick={addLastCloseLine}
              className="rounded-md border border-white/20 bg-[var(--bg-input)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)] hover:bg-white/5 disabled:opacity-50"
            >
              Add Line
            </button>

            <button
              type="button"
              disabled={drawingsBusy}
              onClick={clearAllLines}
              className="rounded-md border border-white/20 bg-[var(--bg-input)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)] hover:bg-white/5 disabled:opacity-50"
            >
              Clear Lines
            </button>

            <div className="ml-auto text-xs text-[var(--text-secondary)]">
              {symbol} • {profile.label}
            </div>
          </div>

          <div className="min-h-0 flex-1">
            <ChartContainer>
              <ChartEngine
                symbol={symbol}
                timeframe={timeframe}
                profile={profile}
                candles={state.candles.history}
                lastUpdateTime={state.candles.lastUpdateTime}
                indicators={state.indicators}
                levels={state.levels}
                events={state.events}
                indicatorState={indicatorState}
                marketOverlay={marketOverlay}
                sectorEtfSymbol={sectorEtfSymbol}
                patternMode={patternMode}
                loading={state.loading}
                error={state.error || ''}
              />
            </ChartContainer>
          </div>
        </section>

        <aside className="hidden min-h-0 border border-white/10 bg-[var(--bg-surface)] p-3 xl:block">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Watchlist</div>
          <div className="space-y-1">
            {DEFAULT_WATCHLIST.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setSymbol(item);
                  setSymbolInput(item);
                }}
                className="w-full rounded-md bg-[var(--bg-input)] px-2 py-2 text-left text-xs text-[var(--text-primary)] hover:bg-white/5"
              >
                {item}
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
