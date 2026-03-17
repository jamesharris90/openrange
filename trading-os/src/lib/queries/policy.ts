export const QUERY_POLICY = {
  fast: {
    staleTime: 1000 * 5,
    refetchInterval: 1000 * 10,
  },
  medium: {
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 30,
  },
  slow: {
    staleTime: 1000 * 60 * 5,
    refetchInterval: false as const,
  },
};

export const queryKeys = {
  marketQuotes: (symbols: string[]) => ["fast", "marketQuotes", symbols] as const,
  chart: (ticker: string, timeframe: string) => ["fast", "chart", ticker, timeframe] as const,
  opportunityStream: ["medium", "opportunityStream"] as const,
  stocksInPlay: (filters: unknown) => ["medium", "stocksInPlay", filters] as const,
  catalysts: ["medium", "catalysts"] as const,
  alerts: ["medium", "alerts"] as const,
  earnings: ["slow", "earnings"] as const,
  research: (ticker: string) => ["slow", "research", ticker] as const,
  adminHealth: ["slow", "adminHealth"] as const,
};
