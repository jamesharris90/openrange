import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authFetch } from '../utils/api';

export type CockpitWatchlistRow = {
  symbol: string;
  price: number | null;
  percent: number | null;
  volume: number | null;
  avgVolume30d: number | null;
  marketCap: number | null;
  timestamp: number | null;
  score: number | null;
};

type BatchQuote = CockpitWatchlistRow;
type ScannerSymbol = {
  symbol: string;
  score: number;
};

const STATIC_STORAGE_KEY = 'cockpit.static.watchlist.v1';
const REFRESH_MS = 3000;
const STATIC_MAX = 16;
const MAX_BATCH_SYMBOLS = 25;

type UseCockpitWatchlistsOptions = {
  visibleStaticSymbols?: string[];
  visibleDynamicSymbols?: string[];
};

function normalizeSymbol(value: string): string {
  return String(value || '').trim().toUpperCase();
}

function dedupeSymbols(symbols: string[]): string[] {
  const unique = new Set<string>();
  symbols.forEach((symbol) => {
    const normalized = normalizeSymbol(symbol);
    if (normalized) unique.add(normalized);
  });
  return Array.from(unique);
}

function parseScannerSymbols(payload: unknown): ScannerSymbol[] {
  const rows = Array.isArray((payload as any)?.data)
    ? (payload as any).data
    : Array.isArray(payload)
      ? payload
      : [];

  const scoreBySymbol = new Map<string, number>();
  rows.forEach((row: any) => {
    const symbol = normalizeSymbol(row?.symbol || '');
    if (!symbol) return;
    const score = Number.isFinite(Number(row?.score))
      ? Number(row.score)
      : Number.isFinite(Number(row?.structureScore))
        ? Number(row.structureScore)
        : Number.isFinite(Number(row?.totalScore))
          ? Number(row.totalScore)
          : Number.isFinite(Number(row?.newsScore))
            ? Number(row.newsScore)
            : Number.isFinite(Number(row?.rvol))
              ? Number(row.rvol)
              : 0;

    const existing = scoreBySymbol.get(symbol);
    if (!Number.isFinite(existing) || score > Number(existing)) {
      scoreBySymbol.set(symbol, score);
    }
  });

  return Array.from(scoreBySymbol.entries())
    .map(([symbol, score]) => ({ symbol, score }))
    .sort((a, b) => b.score - a.score);
}

function parseBatchQuotes(payload: unknown): BatchQuote[] {
  const rows = Array.isArray(payload)
    ? payload
    : (payload as any)?.success === true && (payload as any)?.data && typeof (payload as any).data === 'object'
      ? Object.entries((payload as any).data).map(([symbol, quote]) => ({
          symbol,
          ...(quote || {}),
        }))
      : [];
  return rows
    .map((row: any) => ({
      symbol: normalizeSymbol(row?.symbol || ''),
      price: Number.isFinite(Number(row?.price)) ? Number(row.price) : null,
      percent:
        Number.isFinite(Number(row?.percent))
          ? Number(row.percent)
          : Number.isFinite(Number(row?.changePercentage))
            ? Number(row.changePercentage)
            : Number.isFinite(Number(row?.changesPercentage))
              ? Number(row.changesPercentage)
              : null,
      volume: Number.isFinite(Number(row?.volume)) ? Number(row.volume) : null,
      avgVolume30d: Number.isFinite(Number(row?.avgVolume30d)) ? Number(row.avgVolume30d) : null,
      marketCap: Number.isFinite(Number(row?.marketCap)) ? Number(row.marketCap) : null,
      timestamp: Number.isFinite(Number(row?.timestamp)) ? Number(row.timestamp) : null,
      score: null,
    }))
    .filter((row) => row.symbol.length > 0);
}

export function useCockpitWatchlists(options?: UseCockpitWatchlistsOptions) {
  const [staticSymbols, setStaticSymbols] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STATIC_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return dedupeSymbols(Array.isArray(parsed) ? parsed : []).slice(0, STATIC_MAX);
    } catch {
      return [];
    }
  });

  const [scannerSymbols, setScannerSymbols] = useState<ScannerSymbol[]>([]);
  const [quoteBySymbol, setQuoteBySymbol] = useState<Record<string, BatchQuote>>({});

  const staticSymbolsRef = useRef<string[]>(staticSymbols);
  const visibleStaticSymbolsRef = useRef<string[]>([]);
  const visibleDynamicSymbolsRef = useRef<string[]>([]);

  useEffect(() => {
    staticSymbolsRef.current = staticSymbols;
    localStorage.setItem(STATIC_STORAGE_KEY, JSON.stringify(staticSymbols.slice(0, STATIC_MAX)));
  }, [staticSymbols]);

  useEffect(() => {
    visibleStaticSymbolsRef.current = dedupeSymbols(options?.visibleStaticSymbols || []);
  }, [options?.visibleStaticSymbols]);

  useEffect(() => {
    visibleDynamicSymbolsRef.current = dedupeSymbols(options?.visibleDynamicSymbols || []);
  }, [options?.visibleDynamicSymbols]);

  const runRefresh = useCallback(async () => {
    let latestScannerSymbols: ScannerSymbol[] = [];
    try {
      const scannerResp = await authFetch('/api/v3/screener/technical?limit=40&bucket=common');
      if (scannerResp.ok) {
        const scannerPayload = await scannerResp.json();
        latestScannerSymbols = parseScannerSymbols(scannerPayload);
        setScannerSymbols(latestScannerSymbols);
      }
    } catch {
      latestScannerSymbols = [];
    }

    const allSymbols = dedupeSymbols([
      ...visibleStaticSymbolsRef.current,
      ...visibleDynamicSymbolsRef.current,
    ]).slice(0, MAX_BATCH_SYMBOLS);
    if (!allSymbols.length) {
      return;
    }

    try {
      const params = new URLSearchParams({ symbols: allSymbols.join(',') });
      const batchResp = await authFetch(`/api/quotes-batch?${params.toString()}`);
      if (!batchResp.ok) return;
      const batchPayload = await batchResp.json();
      const quotes = parseBatchQuotes(batchPayload);
      const nextMap: Record<string, BatchQuote> = {};
      quotes.forEach((row) => {
        nextMap[row.symbol] = row;
      });
      setQuoteBySymbol(nextMap);
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    let active = true;

    const tick = async () => {
      if (!active) return;
      await runRefresh();
    };

    tick();
    const intervalId = window.setInterval(tick, REFRESH_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [runRefresh]);

  const addStaticSymbol = useCallback((symbol: string) => {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) return false;

    const currentStatic = staticSymbolsRef.current;
    if (currentStatic.includes(normalized)) return false;
    if (currentStatic.length >= STATIC_MAX) return false;

    setStaticSymbols((previous) => [normalized, ...previous].slice(0, STATIC_MAX));
    setScannerSymbols((previous) => previous.filter((row) => row.symbol !== normalized));
    return true;
  }, []);

  const removeStaticSymbol = useCallback((symbol: string) => {
    const normalized = normalizeSymbol(symbol);
    setStaticSymbols((previous) => previous.filter((item) => item !== normalized));
  }, []);

  const promoteDynamicSymbol = useCallback((symbol: string) => {
    addStaticSymbol(symbol);
  }, [addStaticSymbol]);

  const staticRows = useMemo<CockpitWatchlistRow[]>(() => {
    return staticSymbols.map((symbol) => quoteBySymbol[symbol] || {
      symbol,
      price: null,
      percent: null,
      volume: null,
      avgVolume30d: null,
      marketCap: null,
      timestamp: null,
      score: null,
    });
  }, [quoteBySymbol, staticSymbols]);

  const dynamicRows = useMemo<CockpitWatchlistRow[]>(() => {
    const staticSet = new Set(staticSymbols);
    return scannerSymbols
      .filter((row) => !staticSet.has(row.symbol))
      .map((row) => {
        const quote = quoteBySymbol[row.symbol];
        if (quote) {
          return {
            ...quote,
            score: row.score,
          };
        }
        return {
          symbol: row.symbol,
          price: null,
          percent: null,
          volume: null,
          avgVolume30d: null,
          marketCap: null,
          timestamp: null,
          score: row.score,
        };
      });
  }, [quoteBySymbol, scannerSymbols, staticSymbols]);

  const staticCount = staticSymbols.length;
  const staticAtCap = staticCount >= STATIC_MAX;

  return {
    staticRows,
    dynamicRows,
    addStaticSymbol,
    removeStaticSymbol,
    promoteDynamicSymbol,
    staticCount,
    staticMax: STATIC_MAX,
    staticAtCap,
  };
}
