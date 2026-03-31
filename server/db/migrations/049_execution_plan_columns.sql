-- ============================================================
-- Migration 049: Add execution plan columns
-- ============================================================
-- Adds confidence (mission 7) plus full execution plan output
-- (entry, stop, target, sizing, quality, narratives) to both
-- strategy_signals and opportunities_v2.
-- ============================================================

-- strategy_signals
ALTER TABLE strategy_signals
  ADD COLUMN IF NOT EXISTS confidence          NUMERIC,
  ADD COLUMN IF NOT EXISTS stop_loss           NUMERIC,
  ADD COLUMN IF NOT EXISTS target_price        NUMERIC,
  ADD COLUMN IF NOT EXISTS position_size       NUMERIC,
  ADD COLUMN IF NOT EXISTS risk_reward         NUMERIC,
  ADD COLUMN IF NOT EXISTS trade_quality_score NUMERIC,
  ADD COLUMN IF NOT EXISTS execution_ready     BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS why_moving          TEXT,
  ADD COLUMN IF NOT EXISTS why_tradeable       TEXT,
  ADD COLUMN IF NOT EXISTS how_to_trade        TEXT;

-- opportunities_v2
ALTER TABLE opportunities_v2
  ADD COLUMN IF NOT EXISTS confidence          NUMERIC,
  ADD COLUMN IF NOT EXISTS entry_price         NUMERIC,
  ADD COLUMN IF NOT EXISTS stop_loss           NUMERIC,
  ADD COLUMN IF NOT EXISTS target_price        NUMERIC,
  ADD COLUMN IF NOT EXISTS position_size       NUMERIC,
  ADD COLUMN IF NOT EXISTS risk_reward         NUMERIC,
  ADD COLUMN IF NOT EXISTS trade_quality_score NUMERIC,
  ADD COLUMN IF NOT EXISTS execution_ready     BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS why_moving          TEXT,
  ADD COLUMN IF NOT EXISTS why_tradeable       TEXT,
  ADD COLUMN IF NOT EXISTS how_to_trade        TEXT;
