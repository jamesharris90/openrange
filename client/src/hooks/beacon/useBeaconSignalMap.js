import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/apiClient';

function normalizeItem(item, source) {
  const symbol = String(item?.symbol || item?.ticker || '').trim().toUpperCase();
  if (!symbol) return null;

  return {
    ...item,
    symbol,
    source,
    confidence: Number(item?.confidence ?? item?.score ?? item?.pressure_score ?? item?.rank_score ?? 0),
    expected_move: item?.expected_move ?? item?.expectedMove ?? item?.move_percent ?? '--',
    catalyst_summary: item?.catalyst_summary ?? item?.catalyst ?? item?.reason ?? item?.setup ?? 'Active Beacon signal',
    sector_context: item?.sector_context ?? item?.sector ?? item?.industry ?? '--',
    setup: item?.setup ?? item?.strategy ?? source,
  };
}

function toItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function normalizeSymbols(symbols = []) {
  return [...new Set(
    symbols
      .map((symbol) => String(symbol || '').trim().toUpperCase())
      .filter(Boolean),
  )].sort();
}

function chunkSymbols(symbols, chunkSize = 25) {
  const chunks = [];
  for (let i = 0; i < symbols.length; i += chunkSize) {
    chunks.push(symbols.slice(i, i + chunkSize));
  }
  return chunks;
}

function useDebouncedSymbols(symbols, delay) {
  const [debounced, setDebounced] = useState(symbols);

  useEffect(() => {
    if (!delay || delay <= 0) {
      setDebounced(symbols);
      return undefined;
    }
    const timer = setTimeout(() => setDebounced(symbols), delay);
    return () => clearTimeout(timer);
  }, [symbols, delay]);

  return debounced;
}

async function fetchEndpointForSymbols(endpoint, symbols) {
  if (!symbols.length) return [];

  const chunks = chunkSymbols(symbols, 25);
  const chunkResults = await Promise.all(
    chunks.map(async (chunk) => {
      const baseJoin = endpoint.includes('?') ? '&' : '?';
      const symbolsParam = encodeURIComponent(chunk.join(','));
      const bySymbolsPath = `${endpoint}${baseJoin}symbols=${symbolsParam}&limit=${Math.max(25, chunk.length * 4)}`;
      const bySymbolsPayload = await apiClient(bySymbolsPath).catch(() => null);
      const bySymbolsItems = toItems(bySymbolsPayload);
      if (bySymbolsItems.length) return bySymbolsItems;

      // Fallback to per-symbol queries if batch symbol filter is unavailable.
      const bySymbolItems = await Promise.all(
        chunk.map(async (symbol) => {
          const symbolJoin = endpoint.includes('?') ? '&' : '?';
          const bySymbolPath = `${endpoint}${symbolJoin}symbol=${encodeURIComponent(symbol)}&limit=20`;
          const payload = await apiClient(bySymbolPath).catch(() => null);
          return toItems(payload);
        }),
      );

      return bySymbolItems.flat();
    }),
  );

  return chunkResults.flat();
}

export default function useBeaconSignalMap({ symbols = [], enabled = true, debounceMs = 0 } = {}) {
  const normalizedSymbols = useMemo(() => normalizeSymbols(symbols), [symbols]);
  const debouncedSymbols = useDebouncedSymbols(normalizedSymbols, debounceMs);
  const symbolSet = useMemo(() => new Set(debouncedSymbols), [debouncedSymbols]);

  const query = useQuery({
    queryKey: ['beacon-signal-map', debouncedSymbols.join(',')],
    enabled: enabled && debouncedSymbols.length > 0,
    queryFn: async () => {
      const [stream, opportunities, flow, squeezes, orderFlow] = await Promise.all([
        fetchEndpointForSymbols('/opportunity-stream', debouncedSymbols),
        fetchEndpointForSymbols('/opportunities', debouncedSymbols),
        fetchEndpointForSymbols('/intelligence/flow', debouncedSymbols),
        fetchEndpointForSymbols('/intelligence/squeezes', debouncedSymbols),
        fetchEndpointForSymbols('/intelligence/order-flow', debouncedSymbols),
      ]);

      const merged = [
        ...stream.map((item) => normalizeItem(item, 'opportunity-stream')),
        ...opportunities.map((item) => normalizeItem(item, 'opportunities')),
        ...flow.map((item) => normalizeItem(item, 'intelligence-flow')),
        ...squeezes.map((item) => normalizeItem(item, 'intelligence-squeezes')),
        ...orderFlow.map((item) => normalizeItem(item, 'intelligence-order-flow')),
      ]
        .filter(Boolean)
        .filter((item) => symbolSet.has(item.symbol));

      return merged;
    },
    refetchInterval: 30000,
    staleTime: 20000,
    gcTime: 5 * 60 * 1000,
  });

  const signalMap = useMemo(() => {
    const map = new Map();
    for (const item of query.data || []) {
      if (!map.has(item.symbol)) {
        map.set(item.symbol, item);
        continue;
      }
      const existing = map.get(item.symbol);
      if ((item.confidence || 0) > (existing.confidence || 0)) map.set(item.symbol, item);
    }
    return map;
  }, [query.data]);

  function getSignal(symbol) {
    const key = String(symbol || '').trim().toUpperCase();
    if (!key) return null;
    return signalMap.get(key) || null;
  }

  return {
    ...query,
    signalMap,
    getSignal,
    hasSignal: (symbol) => Boolean(getSignal(symbol)),
  };
}
