import { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch } from '../utils/api';
import type { Candle } from '../context/symbol/types';

export type QuotePayload = {
  symbol: string;
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  avgVolume: number | null;
  rvol: number | null;
  gapPercent: number | null;
  float: number | null;
  spread: number | null;
  expectedMove?: {
    amount: number | null;
    percent: number | null;
  } | null;
};

export type ScreenerRow = {
  symbol: string;
  price: number | null;
  changePercent: number | null;
  rvol: number | null;
  volume: number | null;
  marketCap: number | null;
};

export type NewsRow = {
  symbol: string;
  headline: string;
  summary: string;
  source: string;
  url: string | null;
  publishedAt: string | null;
  newsScore: number | null;
};

export type EarningsRow = {
  symbol: string;
  date: string | null;
  time: string | null;
  epsEstimate: number | null;
  epsActual: number | null;
};

export type CockpitMetadata = {
  ticker: string;
  timeframe: string;
  rvol: number | null;
  atrPercent: number | null;
  expectedMove: number | null;
  moveCompletedPercent: number | null;
  intelligenceClassification: string;
  newsScore: number;
  correlationToQQQ: number | null;
};

function toNum(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function classify(quote: QuotePayload | null, atrPercent: number | null): string {
  const rvol = toNum(quote?.rvol);
  const gap = toNum(quote?.gapPercent);
  const atr = toNum(atrPercent);
  if (Number.isFinite(rvol) && Number.isFinite(gap) && Number.isFinite(atr) && rvol > 2 && Math.abs(gap) > 2 && atr > 2) {
    return 'Expansion';
  }
  if (Number.isFinite(rvol) && rvol > 1.2) return 'Continuation';
  return 'Neutral';
}

export function useCockpitData(ticker: string, timeframe: string, candles: Candle[], atrPercent: number | null) {
  const [quote, setQuote] = useState<QuotePayload | null>(null);
  const [screenerRows, setScreenerRows] = useState<ScreenerRow[]>([]);
  const [newsRows, setNewsRows] = useState<NewsRow[]>([]);
  const [earningsRows, setEarningsRows] = useState<EarningsRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  const fetchQuote = useCallback(async () => {
    const response = await authFetch(`/api/quote?symbol=${encodeURIComponent(ticker)}`);
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    setQuote(payload);
  }, [ticker]);

  const fetchEarnings = useCallback(async () => {
    const response = await authFetch(`/api/earnings?symbol=${encodeURIComponent(ticker)}&limit=15`);
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    setEarningsRows(Array.isArray(payload) ? payload : []);
  }, [ticker]);

  const fetchScreener = useCallback(async () => {
    const response = await authFetch('/api/v3/screener/technical?limit=10&bucket=common');
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    const compact: ScreenerRow[] = rows.slice(0, 10).map((row: Record<string, unknown>) => ({
      symbol: String(row.symbol || ''),
      price: toNum(row.price),
      changePercent: toNum(row.changePercent ?? row.changesPercentage),
      rvol: toNum(row.rvol ?? row.relativeVolume),
      volume: toNum(row.volume),
      marketCap: toNum(row.marketCap),
    }));
    setScreenerRows(compact);
  }, []);

  const fetchNews = useCallback(async () => {
    const scopeSymbols = Array.from(new Set([ticker, ...screenerRows.map((row) => row.symbol).filter(Boolean)])).slice(0, 15);
    const query = new URLSearchParams({
      provider: 'fmp',
      symbols: scopeSymbols.join(','),
      limit: '40',
    });
    const response = await authFetch(`/api/news?${query.toString()}`);
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    setNewsRows(Array.isArray(payload) ? payload : []);
  }, [ticker, screenerRows]);

  useEffect(() => {
    let active = true;
    const init = async () => {
      setLoading(true);
      setError('');
      try {
        await Promise.all([fetchQuote(), fetchEarnings(), fetchScreener()]);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load cockpit data');
      } finally {
        if (active) setLoading(false);
      }
    };
    init();
    return () => {
      active = false;
    };
  }, [fetchQuote, fetchEarnings, fetchScreener]);

  useEffect(() => {
    fetchNews().catch(() => undefined);
  }, [fetchNews]);

  useEffect(() => {
    const quoteInterval = window.setInterval(() => {
      fetchQuote().catch(() => undefined);
    }, 2000);

    const screenerInterval = window.setInterval(() => {
      fetchScreener().catch(() => undefined);
    }, 30000);

    const newsInterval = window.setInterval(() => {
      fetchNews().catch(() => undefined);
    }, 30000);

    return () => {
      window.clearInterval(quoteInterval);
      window.clearInterval(screenerInterval);
      window.clearInterval(newsInterval);
    };
  }, [fetchQuote, fetchScreener, fetchNews]);

  const context = useMemo(() => {
    const latest = candles.length ? candles[candles.length - 1] : null;
    const prior = candles.length > 1 ? candles[candles.length - 2] : null;
    const latestVolume = toNum(latest?.volume);
    const priorVolume = toNum(prior?.volume);
    const volumeDelta = Number.isFinite(latestVolume) && Number.isFinite(priorVolume) ? latestVolume - priorVolume : null;

    const expectedMoveAmount = toNum(quote?.expectedMove?.amount);
    const distanceFromExpected = Number.isFinite(expectedMoveAmount) && Number.isFinite(latest?.close)
      ? Math.abs((latest.close as number) - (quote?.price ?? latest.close))
      : null;

    const moveCompletedPercent = Number.isFinite(distanceFromExpected) && Number.isFinite(expectedMoveAmount) && expectedMoveAmount > 0
      ? (distanceFromExpected / expectedMoveAmount) * 100
      : null;

    const vwapDistancePercent = null;
    const newsScoreValues = newsRows.map((row) => toNum(row.newsScore)).filter((value): value is number => Number.isFinite(value));
    const newsScore = newsScoreValues.length ? Math.round(newsScoreValues.reduce((sum, value) => sum + value, 0) / newsScoreValues.length) : 0;

    const metadata: CockpitMetadata = {
      ticker,
      timeframe,
      rvol: toNum(quote?.rvol),
      atrPercent,
      expectedMove: expectedMoveAmount,
      moveCompletedPercent,
      intelligenceClassification: classify(quote, atrPercent),
      newsScore,
      correlationToQQQ: null,
    };

    return {
      volumeDelta,
      rvolDelta: null,
      vwapDistancePercent,
      expectedMoveVsPrice: expectedMoveAmount,
      intelligenceClassification: metadata.intelligenceClassification,
      newsScore,
      metadata,
    };
  }, [candles, quote, atrPercent, newsRows, ticker, timeframe]);

  return {
    quote,
    screenerRows,
    newsRows,
    earningsRows,
    loading,
    error,
    context,
    refetch: {
      fetchQuote,
      fetchScreener,
      fetchNews,
      fetchEarnings,
    },
  };
}
