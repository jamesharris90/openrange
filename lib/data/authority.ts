export const MARKET_QUOTES_TABLE = "market_quotes" as const;
export const INTRADAY_TABLE = "intraday_1m" as const;
export const OPPORTUNITIES_TABLE = "trade_setups" as const;
export const SIGNALS_TABLE = "strategy_signals" as const;

export const NON_AUTHORITATIVE_TABLES = [
  "opportunities",
  "opportunity_stream",
  "trade_opportunities",
] as const;
