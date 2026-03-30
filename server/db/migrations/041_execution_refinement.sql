-- Migration 041: Execution Refinement Layer
-- Adds confirmation, timing, breakout strength, and rating fields

ALTER TABLE premarket_watchlist
  ADD COLUMN IF NOT EXISTS entry_confirmed    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS breakout_strength  NUMERIC,
  ADD COLUMN IF NOT EXISTS session_phase      TEXT,
  ADD COLUMN IF NOT EXISTS execution_rating   TEXT,
  ADD COLUMN IF NOT EXISTS execution_notes    TEXT;

ALTER TABLE signal_log
  ADD COLUMN IF NOT EXISTS entry_confirmed   BOOLEAN,
  ADD COLUMN IF NOT EXISTS breakout_strength NUMERIC,
  ADD COLUMN IF NOT EXISTS execution_rating  TEXT;

COMMENT ON COLUMN premarket_watchlist.session_phase     IS 'PREMARKET / OPEN / MIDDAY / CLOSE / AFTERHOURS';
COMMENT ON COLUMN premarket_watchlist.execution_rating  IS 'ELITE / GOOD / WATCH / AVOID';
COMMENT ON COLUMN premarket_watchlist.entry_confirmed   IS 'TRUE when price closes above PM high with volume + no rejection wick';
COMMENT ON COLUMN premarket_watchlist.breakout_strength IS '0-5 scale: current_volume / avg_volume_last_10_candles, capped at 5';
