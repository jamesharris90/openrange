-- Migration 040: Execution Layer
-- Adds trade plan fields to premarket_watchlist and execution columns to signal_log

ALTER TABLE premarket_watchlist
  ADD COLUMN IF NOT EXISTS entry_price           NUMERIC,
  ADD COLUMN IF NOT EXISTS stop_price            NUMERIC,
  ADD COLUMN IF NOT EXISTS target_price          NUMERIC,
  ADD COLUMN IF NOT EXISTS risk_percent          NUMERIC,
  ADD COLUMN IF NOT EXISTS reward_percent        NUMERIC,
  ADD COLUMN IF NOT EXISTS risk_reward_ratio     NUMERIC,
  ADD COLUMN IF NOT EXISTS execution_valid       BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS execution_type        TEXT,
  ADD COLUMN IF NOT EXISTS position_size_shares  NUMERIC,
  ADD COLUMN IF NOT EXISTS position_size_value   NUMERIC;

ALTER TABLE signal_log
  ADD COLUMN IF NOT EXISTS stop_price        NUMERIC,
  ADD COLUMN IF NOT EXISTS target_price      NUMERIC,
  ADD COLUMN IF NOT EXISTS risk_reward_ratio NUMERIC;

COMMENT ON COLUMN premarket_watchlist.execution_type IS 'BREAKOUT / FADE / RANGE / NONE';
COMMENT ON COLUMN premarket_watchlist.execution_valid IS 'TRUE if premarket_valid AND risk<=5% AND R:R>=1.5 AND gap_confidence!=LOW';
COMMENT ON COLUMN premarket_watchlist.position_size_shares IS 'Shares based on £10 max risk per trade';
COMMENT ON COLUMN premarket_watchlist.position_size_value IS 'GBP value of position at entry price';
