import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Camera, RotateCcw } from 'lucide-react';
import ChartEngine from '../components/chartEngine/ChartEngine';
import ChartContainer from '../components/layout/ChartContainer';
import { getProfileForTimeframe, normalizeTimeframe } from '../components/chartEngine/indicatorRegistry';
import { useSymbolData } from '../context/symbol/useSymbolData';
import { useSymbol } from '../context/SymbolContext';
import { authFetch } from '../utils/api';
import ButtonSecondary from '../components/ui/ButtonSecondary';
import ButtonGhost from '../components/ui/ButtonGhost';
import SetupIntelligencePanel from '../components/charts/SetupIntelligencePanel';
import ChartSignalsNewsPanel from '../components/charts/ChartSignalsNewsPanel';
import OpportunityStream from '../components/opportunities/OpportunityStream';
import BeaconSignalInline from '../components/beacon/BeaconSignalInline';
import BeaconOverlayStatusChip from '../components/beacon/BeaconOverlayStatusChip';
import useBeaconSignalMap from '../hooks/beacon/useBeaconSignalMap';
import useBeaconOverlayVisibility from '../hooks/beacon/useBeaconOverlayVisibility';

const DEFAULT_WATCHLIST = ['SPY', 'QQQ', 'AMD', 'AMZN'];
const TIMEFRAME_BUTTONS = [
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '1H', label: '1h' },
  { value: '1D', label: '1D' },
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

const OVERLAY_BUTTONS = [
  { key: 'ema9', label: 'EMA 9' },
  { key: 'ema20', label: 'EMA 20' },
  { key: 'ema50', label: 'EMA 50' },
  { key: 'vwap', label: 'VWAP' },
  { key: 'openingRange', label: 'Opening Range' },
  { key: 'previousClose', label: 'Previous Close' },
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
  const { selectedSymbol, setSelectedSymbol } = useSymbol();

  const initialSymbol = String(searchParams.get('symbol') || selectedSymbol || 'SPY').toUpperCase();
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
  const [drawTool, setDrawTool] = useState('hline');
  const [sectorEtfSymbol, setSectorEtfSymbol] = useState(null);
  const [overlayState, setOverlayState] = useState({
    openingRange: true,
    previousClose: true,
  });
  const [showDrawTools, setShowDrawTools] = useState(true);
  const [showIndicatorTools, setShowIndicatorTools] = useState(true);
  const symbol = state.symbol || initialSymbol;
  const timeframe = state.timeframe || initialTimeframe;
  const { showBeaconSignals, toggleBeaconSignals } = useBeaconOverlayVisibility('charts', true);
  const visibleSymbols = useMemo(() => [symbol], [symbol]);
  const { getSignal } = useBeaconSignalMap({
    symbols: visibleSymbols,
    enabled: showBeaconSignals,
  });
  const activeBeaconSignal = showBeaconSignals ? getSignal(symbol) : null;
  const activeBeaconSymbolCount = showBeaconSignals && activeBeaconSignal ? 1 : 0;

  const profile = useMemo(() => getProfileForTimeframe(timeframe), [timeframe]);

  const levelsForChart = useMemo(() => {
    const source = state.levels || {};
    const next = { ...source };
    if (!overlayState.openingRange) {
      delete next.orHigh;
      delete next.orLow;
      delete next.orStartTime;
      delete next.orEndTime;
    }
    if (!overlayState.previousClose) {
      delete next.pdh;
      delete next.pdl;
    }
    return next;
  }, [state.levels, overlayState]);

  useEffect(() => {
    const querySymbol = String(searchParams.get('symbol') || '').toUpperCase();
    const queryTimeframe = normalizeTimeframe(String(searchParams.get('timeframe') || ''));
    if (querySymbol && querySymbol !== symbol) {
      setSelectedSymbol(querySymbol);
      setSymbol(querySymbol);
    }
    if (queryTimeframe && queryTimeframe !== timeframe) setTimeframe(queryTimeframe);
  }, []);

  useEffect(() => {
    const global = String(selectedSymbol || '').toUpperCase();
    if (global && global !== symbol) setSymbol(global);
  }, [selectedSymbol, symbol, setSymbol]);

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
          type: drawTool,
          price,
          label: `${drawTool.toUpperCase()} ${symbol} ${price.toFixed(2)}`,
        },
      ];
      await saveDrawings(next);
    } finally {
      setDrawingsBusy(false);
    }
  };

  const detectTrend = async () => {
    setDrawingsBusy(true);
    try {
      const response = await authFetch(`/api/chart/trend/${encodeURIComponent(symbol)}`);
      if (!response.ok) throw new Error('Failed to detect trend');
      const payload = await response.json();

      const supports = Array.isArray(payload?.support) ? payload.support : [];
      const resistances = Array.isArray(payload?.resistance) ? payload.resistance : [];

      const existing = await fetchDrawings();
      const next = [...existing];

      if (supports.length >= 2) {
        const start = Number(supports[0]);
        const end = Number(supports[supports.length - 1]);
        if (Number.isFinite(start) && Number.isFinite(end)) {
          next.push({
            id: `${symbol}-${timeframe}-trendline-support-${Date.now()}`,
            type: 'trendline',
            price: end,
            label: `Trendline S ${start.toFixed(2)} -> ${end.toFixed(2)}`,
          });
        }
      }

      if (resistances.length >= 2) {
        const start = Number(resistances[0]);
        const end = Number(resistances[resistances.length - 1]);
        if (Number.isFinite(start) && Number.isFinite(end)) {
          next.push({
            id: `${symbol}-${timeframe}-trendline-resistance-${Date.now()}`,
            type: 'trendline',
            price: end,
            label: `Trendline R ${start.toFixed(2)} -> ${end.toFixed(2)}`,
          });
        }
      }

      supports.forEach((price, index) => {
        next.push({
          id: `${symbol}-${timeframe}-support-${index}-${Date.now()}`,
          type: 'hline',
          price: Number(price),
          label: `Support ${Number(price).toFixed(2)}`,
        });
      });

      resistances.forEach((price, index) => {
        next.push({
          id: `${symbol}-${timeframe}-resistance-${index}-${Date.now()}`,
          type: 'hline',
          price: Number(price),
          label: `Resistance ${Number(price).toFixed(2)}`,
        });
      });

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

  const resetWorkspace = async () => {
    setIndicatorState({
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
    setOverlayState({ openingRange: true, previousClose: true });
    setPatternMode(false);
    setMarketOverlay('none');
    await clearAllLines();
  };

  const screenshotChart = () => {
    const target = document.querySelector('[data-chart-workspace="main"] canvas');
    if (!(target instanceof HTMLCanvasElement)) return;
    const link = document.createElement('a');
    link.href = target.toDataURL('image/png');
    link.download = `${symbol}-${timeframe}-chart.png`;
    link.click();
  };

  useEffect(() => {
    setSearchParams({ symbol, timeframe }, { replace: true });
    setSelectedSymbol(symbol);
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
    <div className="h-full min-h-0 space-y-2">
      <div className="grid h-full min-h-[calc(100vh-88px)] grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_330px]">
        <section className="flex min-h-0 flex-col border border-white/10 bg-[var(--bg-surface)]" data-chart-workspace="main">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
            <input
              value={symbolInput}
              onChange={(event) => setSymbolInput(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  const next = String(symbolInput || '').trim().toUpperCase();
                  if (next) {
                    setSelectedSymbol(next);
                    setSymbol(next);
                  }
                }
              }}
              className="h-9 w-32 rounded-md border border-white/20 bg-[var(--bg-input)] px-3 text-sm"
              placeholder="Symbol"
            />

            <ButtonSecondary
              onClick={() => {
                const next = String(symbolInput || '').trim().toUpperCase();
                if (next) {
                  setSelectedSymbol(next);
                  setSymbol(next);
                }
              }}
              className="px-3 py-2 text-xs"
            >
              Load
            </ButtonSecondary>

            <div className="ml-2 flex flex-wrap items-center gap-1 rounded-md bg-[var(--bg-input)] p-1">
              {TIMEFRAME_BUTTONS?.map((item) => (
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

            <ButtonGhost onClick={() => setShowDrawTools((prev) => !prev)} className="px-2 py-1 text-xs">
              Draw
            </ButtonGhost>
            <ButtonGhost onClick={() => setShowIndicatorTools((prev) => !prev)} className="px-2 py-1 text-xs">
              Indicators
            </ButtonGhost>
            <ButtonGhost onClick={resetWorkspace} className="px-2 py-1 text-xs inline-flex items-center gap-1">
              <RotateCcw size={12} /> Reset
            </ButtonGhost>
            <ButtonGhost onClick={screenshotChart} className="px-2 py-1 text-xs inline-flex items-center gap-1">
              <Camera size={12} /> Screenshot
            </ButtonGhost>

            {showIndicatorTools ? (
            <div className="flex flex-wrap items-center gap-1 rounded-md bg-[var(--bg-input)] p-1">
              {INDICATOR_BUTTONS?.map((item) => {
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
            ) : null}

            <div className="flex flex-wrap items-center gap-1 rounded-md border border-white/20 bg-[var(--bg-input)] p-1 text-xs">
              {OVERLAY_BUTTONS?.map((item) => {
                const active = item.key in indicatorState
                  ? Boolean(indicatorState[item.key])
                  : Boolean(overlayState[item.key]);
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      if (item.key in indicatorState) {
                        setIndicatorState((prev) => ({ ...prev, [item.key]: !prev[item.key] }));
                        return;
                      }
                      setOverlayState((prev) => ({ ...prev, [item.key]: !prev[item.key] }));
                    }}
                    className={`rounded px-2 py-1 ${active ? 'bg-blue-600 text-white' : 'text-[var(--text-secondary)] hover:bg-white/5'}`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-3 rounded-md bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-secondary)]">
              {[{ key: 'SPY', label: 'SPY' }, { key: 'QQQ', label: 'QQQ' }, { key: 'SECTOR', label: 'Sector ETF (auto)' }]?.map((item) => {
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

            <ButtonSecondary
              onClick={() => setPatternMode((prev) => !prev)}
              className={`px-3 py-2 text-xs ${patternMode ? '!border-emerald-500/60 !bg-emerald-600/20 !text-emerald-100' : ''}`}
            >
              Pattern
            </ButtonSecondary>

            <ButtonSecondary
              disabled={drawingsBusy || !state.candles.history.length}
              onClick={addLastCloseLine}
              className="px-3 py-2 text-xs disabled:opacity-50"
            >
              Add Drawing
            </ButtonSecondary>

            {showDrawTools ? (
            <div className="flex items-center gap-2 rounded-md border border-white/20 bg-[var(--bg-input)] px-2 py-1 text-xs">
              <button type="button" onClick={() => setDrawTool('trendline')} className={`rounded px-2 py-1 ${drawTool === 'trendline' ? 'bg-blue-600 text-white' : 'text-[var(--text-secondary)]'}`}>Trendline</button>
              <button type="button" onClick={() => setDrawTool('hline')} className={`rounded px-2 py-1 ${drawTool === 'hline' ? 'bg-blue-600 text-white' : 'text-[var(--text-secondary)]'}`}>Horizontal Line</button>
              <button type="button" onClick={() => setDrawTool('rectangle')} className={`rounded px-2 py-1 ${drawTool === 'rectangle' ? 'bg-blue-600 text-white' : 'text-[var(--text-secondary)]'}`}>Rectangle</button>
              <button type="button" onClick={() => setDrawTool('fib')} className={`rounded px-2 py-1 ${drawTool === 'fib' ? 'bg-blue-600 text-white' : 'text-[var(--text-secondary)]'}`}>Fib Retracement</button>
            </div>
            ) : null}

            <ButtonSecondary
              disabled={drawingsBusy}
              onClick={detectTrend}
              className="px-3 py-2 text-xs !border-emerald-500/40 !bg-emerald-600/20 !text-emerald-100 disabled:opacity-50"
            >
              Detect Trend
            </ButtonSecondary>

            <ButtonGhost
              disabled={drawingsBusy}
              onClick={clearAllLines}
              className="px-3 py-2 text-xs disabled:opacity-50"
            >
              Clear Drawings
            </ButtonGhost>

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
                levels={levelsForChart}
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

        <aside className="min-h-0 space-y-2 border border-white/10 bg-[var(--bg-surface)] p-3">
          <SetupIntelligencePanel
            symbol={symbol}
            levels={state.levels}
            indicators={state.indicators}
            candles={state.candles.history}
          />

          <button
            type="button"
            onClick={toggleBeaconSignals}
            className="w-full rounded border border-white/10 bg-[var(--bg-input)] px-3 py-2 text-left text-xs font-semibold text-[var(--text-primary)]"
          >
            {showBeaconSignals ? 'Hide Beacon Signals' : 'Show Beacon Signals'}
          </button>

          <BeaconOverlayStatusChip isEnabled={showBeaconSignals} activeSymbols={activeBeaconSymbolCount} />

          {showBeaconSignals ? (
            <BeaconSignalInline signal={activeBeaconSignal} title={`Beacon Overlay • ${symbol}`} />
          ) : null}

          <div className="rounded border border-white/10 p-2">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Quick Switch</div>
            <div className="space-y-1">
              {DEFAULT_WATCHLIST?.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    setSelectedSymbol(item);
                    setSymbol(item);
                    setSymbolInput(item);
                  }}
                  className="w-full rounded-md bg-[var(--bg-input)] px-2 py-2 text-left text-xs text-[var(--text-primary)] hover:bg-white/5"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded border border-white/10 p-2">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Opportunities</div>
            <OpportunityStream limit={6} compact />
          </div>
        </aside>
      </div>

      <ChartSignalsNewsPanel symbol={symbol} />
    </div>
  );
}
