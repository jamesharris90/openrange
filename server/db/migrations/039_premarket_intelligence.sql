-- Migration 039: Premarket Intelligence Layer
-- Adds computed intelligence columns to premarket_watchlist

ALTER TABLE premarket_watchlist
  ADD COLUMN IF NOT EXISTS premarket_trend         TEXT,
  ADD COLUMN IF NOT EXISTS premarket_range_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS premarket_gap_confidence TEXT,
  ADD COLUMN IF NOT EXISTS premarket_signal_type   TEXT,
  ADD COLUMN IF NOT EXISTS premarket_valid         BOOLEAN DEFAULT false;

COMMENT ON COLUMN premarket_watchlist.premarket_trend         IS 'UP / DOWN / RANGE — derived from pm_last vs pm_open + higher highs / lower lows';
COMMENT ON COLUMN premarket_watchlist.premarket_range_percent IS '(pm_high - pm_low) / pm_low * 100';
COMMENT ON COLUMN premarket_watchlist.premarket_gap_confidence IS 'HIGH / MEDIUM / LOW — confidence in gap signal quality';
COMMENT ON COLUMN premarket_watchlist.premarket_signal_type   IS 'GAP_AND_GO / GAP_FADE / RANGE_BUILD / UNDEFINED';
COMMENT ON COLUMN premarket_watchlist.premarket_valid         IS 'TRUE if gap_confidence != LOW AND premarket_volume > 100000 AND range > 1';
