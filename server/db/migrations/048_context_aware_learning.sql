-- ============================================================
-- Migration 048: Context-aware learning infrastructure
-- ============================================================
-- Extends signal_outcomes with confidence tracking and
-- validation quality flag.  Creates strategy_regime_metrics
-- for per-regime win rate storage.  Extends
-- strategy_learning_metrics with weighted/adjusted fields.
-- ============================================================

-- Phase 1/4: Extend signal_outcomes with predicted confidence
--            and validation quality flag
ALTER TABLE signal_outcomes
  ADD COLUMN IF NOT EXISTS predicted_confidence   NUMERIC,
  ADD COLUMN IF NOT EXISTS had_validation_issues  BOOLEAN DEFAULT FALSE;

-- Phase 2: Per-regime performance table
-- One row per (strategy, regime).  Unique index allows upsert.
CREATE TABLE IF NOT EXISTS strategy_regime_metrics (
  id                   SERIAL PRIMARY KEY,
  strategy             TEXT        NOT NULL,
  regime               TEXT        NOT NULL,
  raw_wins             INT         NOT NULL DEFAULT 0,
  raw_losses           INT         NOT NULL DEFAULT 0,
  weighted_wins        NUMERIC     NOT NULL DEFAULT 0,
  weighted_losses      NUMERIC     NOT NULL DEFAULT 0,
  raw_win_rate         NUMERIC,
  weighted_win_rate    NUMERIC,
  sample_size          INT         NOT NULL DEFAULT 0,
  last_evaluated_at    TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_srm_strategy_regime
  ON strategy_regime_metrics(strategy, regime);

-- Phase 5/6: Extend strategy_learning_metrics with weighted and
--            adjusted fields
ALTER TABLE strategy_learning_metrics
  ADD COLUMN IF NOT EXISTS weighted_win_rate    NUMERIC,
  ADD COLUMN IF NOT EXISTS recency_adjusted     BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS validation_adjusted  BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS confidence_accuracy  NUMERIC;
