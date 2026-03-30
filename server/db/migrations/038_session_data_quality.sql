-- 038_session_data_quality.sql
-- Phase 1: add data_quality_score to intraday_1m
-- Phase 3: premarket_metrics view (session-filtered aggregates)
-- Note: session column already exists from migration 015

ALTER TABLE intraday_1m
  ADD COLUMN IF NOT EXISTS data_quality_score INT;

-- Composite index on (symbol, session) for fast premarket/afterhours queries
CREATE INDEX IF NOT EXISTS idx_intraday_session
  ON intraday_1m (symbol, session);

-- Premarket metrics view: last 2 days to capture current + prior premarket
CREATE OR REPLACE VIEW premarket_metrics AS
SELECT
  symbol,
  MAX(close)  FILTER (WHERE session = 'PREMARKET') AS premarket_price,
  SUM(volume) FILTER (WHERE session = 'PREMARKET') AS premarket_volume,
  MIN("timestamp") FILTER (WHERE session = 'PREMARKET') AS premarket_open_ts,
  MAX("timestamp") FILTER (WHERE session = 'PREMARKET') AS premarket_close_ts,
  COUNT(*)    FILTER (WHERE session = 'PREMARKET') AS premarket_candles,
  ROUND(
    AVG(data_quality_score) FILTER (WHERE session = 'PREMARKET')
  )::int                                             AS premarket_quality_avg,
  COUNT(*)    FILTER (WHERE session = 'AFTERHOURS')  AS afterhours_candles
FROM intraday_1m
WHERE "timestamp" >= NOW() - INTERVAL '2 days'
GROUP BY symbol;
