import React, { createContext, useEffect, useMemo, useRef, useState } from 'react';
import { authFetch } from '../../utils/api';
import { normalizeTimeframe } from '../../utils/timeframe';
import type { Candle, Indicators, Levels, SymbolCacheEntry, SymbolDataState } from './types';

const STALE_MS = 30_000;

type SymbolDataContextValue = {
  state: SymbolDataState;
  setSymbol: (next: string) => void;
  setTimeframe: (next: string) => void;
};

const INITIAL_STATE: SymbolDataState = {
  symbol: 'NVDA',
  timeframe: '5m',
  candles: {
    history: [],
    lastUpdateTime: undefined,
  },
  indicators: {},
  levels: {},
  events: [],
  meta: {
    lastFetched: 0,
    source: 'network',
  },
  loading: false,
  error: '',
};

export const SymbolDataContext = createContext<SymbolDataContextValue | null>(null);

// Map frontend timeframe keys to the server's interval strings
function toInterval(tf: string): string {
  if (tf === 'ALL') return '1day';
  if (tf === '1W') return '1week';
  if (tf === '1D') return '1day';
  if (tf === '4H') return '4hour';
  if (tf === '1H') return '1hour';
  if (tf === '15m') return '15min';
  if (tf === '3m') return '3min';
  if (tf === '5m') return '5min';
  return '1min';
}

function asNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asCandles(input: unknown): Candle[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item: any) => ({
      time: Number(item?.time),
      open: Number(item?.open),
      high: Number(item?.high),
      low: Number(item?.low),
      close: Number(item?.close),
      volume: Number(item?.volume ?? 0),
    }))
    .filter((item) => [item.time, item.open, item.high, item.low, item.close].every(Number.isFinite));
}

// Server returns indicators as {time, value}[] — extract just the values (ChartEngine re-aligns by index)
function extractValues(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item: any) => {
      const v = typeof item === 'object' && item !== null ? item.value : item;
      return Number(v);
    })
    .filter(Number.isFinite);
}

function asIndicators(response: any): Indicators {
  const ind = response?.indicators || {};
  return {
    vwap: extractValues(ind.vwap),
    ema9: extractValues(ind.ema9),
    ema10: extractValues(ind.ema10),
    ema20: extractValues(ind.ema20),
    ema50: extractValues(ind.ema50),
    ema200: extractValues(ind.ema200),
    rsi14: extractValues(ind.rsi14),
    macd: extractValues(ind.macd),
    atr14: extractValues(ind.atr),
    volumeMA20: [],
  };
}

function asLevels(response: any): Levels {
  return {
    pdh: asNumber(response?.pdh),
    pdl: asNumber(response?.pdl),
    pmh: asNumber(response?.pmh),
    pml: asNumber(response?.pml),
    orHigh: asNumber(response?.orh),
    orLow: asNumber(response?.orl),
    orStartTime: asNumber(response?.orStartTime),
    orEndTime: asNumber(response?.orEndTime),
  };
}

export function SymbolDataProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SymbolDataState>(INITIAL_STATE);
  const cacheRef = useRef<Map<string, SymbolCacheEntry>>(new Map());
  const activeControllerRef = useRef<AbortController | null>(null);

  const fetchSymbolData = async (symbol: string, timeframe: string, controller: AbortController): Promise<SymbolDataState | null> => {
    const intervalParam = toInterval(timeframe);
    const query = new URLSearchParams({ symbol, interval: intervalParam }).toString();

    let res: Response;
    try {
      res = await authFetch(`/api/v5/chart?${query}`, { signal: controller.signal });
    } catch (error: any) {
      if (error?.name === 'AbortError' || controller.signal.aborted) {
        return null;
      }
      throw error;
    }

    if (!res.ok) {
      const bodyText = await res.text();
      console.error('CHART API ERROR', res.status, bodyText);
      throw new Error(bodyText || `Chart API failed with status ${res.status}`);
    }

    const data = await res.json();
    const now = Date.now();
    const candles = asCandles(data?.candles);

    return {
      symbol,
      timeframe,
      candles: {
        history: candles,
        lastUpdateTime: candles.length ? candles[candles.length - 1].time : undefined,
      },
      indicators: asIndicators(data),
      levels: asLevels(data),
      events: Array.isArray(data?.events)
        ? data.events
        : (data?.events && typeof data.events === 'object')
          ? data.events
          : [],
      meta: {
        lastFetched: now,
        source: 'network',
      },
      loading: false,
      error: '',
    };
  };

  const setSymbol = (next: string) => {
    const normalized = String(next || '').trim().toUpperCase();
    if (!normalized) return;
    setState((prev) => {
      if (normalized === prev.symbol) return prev;
      return { ...prev, symbol: normalized };
    });
  };

  const setTimeframe = (next: string) => {
    const normalized = normalizeTimeframe(String(next || ''));
    if (!normalized) return;
    setState((prev) => {
      if (normalized === prev.timeframe) return prev;
      return { ...prev, timeframe: normalized };
    });
  };

  // Primary fetch: runs on symbol/timeframe change, cancels previous in-flight request
  useEffect(() => {
    const symbol = String(state.symbol || '').trim().toUpperCase();
    const timeframe = normalizeTimeframe(String(state.timeframe || ''));

    if (!symbol) {
      setState((prev) => ({ ...prev, loading: false, error: 'Symbol is required' }));
      return;
    }

    const key = `${symbol}|${timeframe}`;
    const now = Date.now();
    const cachedEntry = cacheRef.current.get(key);

    const previousController = activeControllerRef.current;
    if (previousController && !previousController.signal.aborted) {
      previousController.abort();
    }

    if (cachedEntry && now - cachedEntry.lastFetched < STALE_MS) {
      setState({
        ...cachedEntry.data,
        loading: false,
        error: '',
        meta: {
          ...cachedEntry.data.meta,
          source: 'cache',
        },
      });
      return;
    }

    const controller = new AbortController();
    activeControllerRef.current = controller;

    if (cachedEntry) {
      setState({
        ...cachedEntry.data,
        loading: false,
        error: '',
        meta: {
          ...cachedEntry.data.meta,
          source: 'cache',
        },
      });
    } else {
      setState((prev) => ({ ...prev, symbol, timeframe, loading: true, error: '' }));
    }

    const run = async () => {
      try {
        const nextState = await fetchSymbolData(symbol, timeframe, controller);
        if (!nextState) return;
        if (controller.signal.aborted) return;

        cacheRef.current.set(key, {
          data: nextState,
          lastFetched: nextState.meta.lastFetched,
        });
        setState(nextState);
      } catch (error: any) {
        if (error?.name === 'AbortError') return;
        if (controller.signal.aborted) return;
        console.error('Fetch error', error);
        if (cachedEntry) {
          setState((prev) => ({ ...prev, loading: false }));
          return;
        }
        setState((prev) => ({
          ...prev,
          symbol,
          timeframe,
          loading: false,
          error: error?.message || 'Failed to load symbol data',
        }));
      } finally {
        if (activeControllerRef.current === controller) {
          activeControllerRef.current = null;
        }
      }
    };

    run();

    return () => {
      if (activeControllerRef.current === controller && !controller.signal.aborted) {
        controller.abort();
        activeControllerRef.current = null;
      }
    };
  }, [state.symbol, state.timeframe]);

  const value = useMemo(() => ({
    state,
    setSymbol,
    setTimeframe,
  }), [state]);

  return <SymbolDataContext.Provider value={value}>{children}</SymbolDataContext.Provider>;
}
