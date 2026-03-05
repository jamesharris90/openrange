CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS market_quotes (
  symbol TEXT PRIMARY KEY,
  price NUMERIC,
  change_percent NUMERIC,
  volume BIGINT,
  market_cap BIGINT,
  sector TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_ohlc (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT,
  open NUMERIC,
  high NUMERIC,
  low NUMERIC,
  close NUMERIC,
  volume BIGINT,
  date DATE
);

CREATE TABLE IF NOT EXISTS intraday_ohlc (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT,
  timeframe TEXT,
  open NUMERIC,
  high NUMERIC,
  low NUMERIC,
  close NUMERIC,
  volume BIGINT,
  timestamp TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS market_metrics (
  symbol TEXT PRIMARY KEY,
  price NUMERIC,
  change_percent NUMERIC,
  gap_percent NUMERIC,
  relative_volume NUMERIC,
  volume BIGINT,
  avg_volume_30d NUMERIC,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE market_metrics ADD COLUMN IF NOT EXISTS price NUMERIC;
ALTER TABLE market_metrics ADD COLUMN IF NOT EXISTS change_percent NUMERIC;
ALTER TABLE market_metrics ADD COLUMN IF NOT EXISTS gap_percent NUMERIC;
ALTER TABLE market_metrics ADD COLUMN IF NOT EXISTS relative_volume NUMERIC;
ALTER TABLE market_metrics ADD COLUMN IF NOT EXISTS volume BIGINT;
ALTER TABLE market_metrics ADD COLUMN IF NOT EXISTS avg_volume_30d NUMERIC;
ALTER TABLE market_metrics ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_market_quotes_updated_at ON market_quotes (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_ohlc_symbol_date ON daily_ohlc (symbol, date DESC);
CREATE INDEX IF NOT EXISTS idx_intraday_ohlc_symbol_timestamp ON intraday_ohlc (symbol, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_market_metrics_updated_at ON market_metrics (updated_at DESC);
