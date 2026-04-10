-- 022_options_intelligence.sql
-- Additive-only: adds options/IV columns to market_metrics.
-- Safe to run multiple times (IF NOT EXISTS).

ALTER TABLE market_metrics
  ADD COLUMN IF NOT EXISTS implied_volatility     NUMERIC,
  ADD COLUMN IF NOT EXISTS expected_move_percent  NUMERIC,
  ADD COLUMN IF NOT EXISTS put_call_ratio         NUMERIC,
  ADD COLUMN IF NOT EXISTS options_updated_at     TIMESTAMPTZ;

-- Index for fast staleness checks
CREATE INDEX IF NOT EXISTS idx_market_metrics_options_updated_at
  ON market_metrics (options_updated_at DESC NULLS LAST);
