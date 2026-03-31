-- ============================================================
-- Migration 051: Market context columns
-- ============================================================
-- Adds VWAP relation, volume trend, market structure, and time
-- context to strategy_signals and opportunities_v2 so every
-- execution plan record includes its market environment.
-- ============================================================

-- strategy_signals
ALTER TABLE strategy_signals
  ADD COLUMN IF NOT EXISTS vwap_relation    TEXT,
  ADD COLUMN IF NOT EXISTS volume_trend     TEXT,
  ADD COLUMN IF NOT EXISTS market_structure TEXT,
  ADD COLUMN IF NOT EXISTS time_context     TEXT;

-- opportunities_v2
ALTER TABLE opportunities_v2
  ADD COLUMN IF NOT EXISTS vwap_relation    TEXT,
  ADD COLUMN IF NOT EXISTS volume_trend     TEXT,
  ADD COLUMN IF NOT EXISTS market_structure TEXT,
  ADD COLUMN IF NOT EXISTS time_context     TEXT;
