-- ============================================================
-- Migration 047: Reset corrupted learning data + extend
--                strategy_learning_metrics for adaptive weighting
-- ============================================================
-- Context: signal_outcomes and trade_outcomes were collected while
-- the data-validation layer was absent (pre-045).  Win rates and
-- strategy metrics computed from that data are unreliable.
-- This migration backs up those tables, wipes them, and extends
-- strategy_learning_metrics so the new learning engine can write
-- adaptive weights and enable/disable strategies.
-- ============================================================

-- Step 1: Backup signal_outcomes before truncation
CREATE TABLE IF NOT EXISTS signal_outcomes_backup_pre047
  AS SELECT * FROM signal_outcomes;

-- Step 2: Backup trade_outcomes before truncation
CREATE TABLE IF NOT EXISTS trade_outcomes_backup_pre047
  AS SELECT * FROM trade_outcomes;

-- Step 3: Reset signal_outcomes (clean slate for new learning pipeline)
TRUNCATE TABLE signal_outcomes;

-- Step 4: Reset trade_outcomes (clean slate)
TRUNCATE TABLE trade_outcomes;

-- Step 5: Reset strategy_learning_metrics (computed from corrupted data)
TRUNCATE TABLE strategy_learning_metrics;

-- Step 6: Add unique index on strategy so the learning engine can upsert
CREATE UNIQUE INDEX IF NOT EXISTS idx_slm_strategy
  ON strategy_learning_metrics(strategy);

-- Step 7: Extend strategy_learning_metrics for adaptive weighting
ALTER TABLE strategy_learning_metrics
  ADD COLUMN IF NOT EXISTS weight           NUMERIC NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS status           TEXT    NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS sample_size      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_evaluated_at TIMESTAMPTZ;
