-- 046_confidence_column.sql
-- Adds confidence score to signal tables so it persists alongside the signal.

ALTER TABLE strategy_signals
  ADD COLUMN IF NOT EXISTS confidence NUMERIC;

ALTER TABLE opportunities_v2
  ADD COLUMN IF NOT EXISTS confidence NUMERIC;

CREATE INDEX IF NOT EXISTS idx_strategy_signals_confidence
  ON strategy_signals (confidence DESC NULLS LAST);
