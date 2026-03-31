-- ============================================================
-- Migration 050: Trade lifecycle stage columns
-- ============================================================
-- Adds lifecycle_stage, entry_type, exit_type to strategy_signals,
-- opportunities_v2, and signal_log so every signal records where
-- it sits in the move (EARLY / EXPANSION / EXTENDED / EXHAUSTION)
-- and what entry/exit logic was applied.
--
-- Also backfills entry_price on strategy_signals which was
-- referenced in the Mission-10 INSERT but not added by 049.
-- ============================================================

-- strategy_signals
ALTER TABLE strategy_signals
  ADD COLUMN IF NOT EXISTS entry_price     NUMERIC,
  ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT,
  ADD COLUMN IF NOT EXISTS entry_type      TEXT,
  ADD COLUMN IF NOT EXISTS exit_type       TEXT;

-- opportunities_v2
ALTER TABLE opportunities_v2
  ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT,
  ADD COLUMN IF NOT EXISTS entry_type      TEXT,
  ADD COLUMN IF NOT EXISTS exit_type       TEXT;

-- signal_log (already has stage; add typed entry/exit)
ALTER TABLE signal_log
  ADD COLUMN IF NOT EXISTS entry_type TEXT,
  ADD COLUMN IF NOT EXISTS exit_type  TEXT;
