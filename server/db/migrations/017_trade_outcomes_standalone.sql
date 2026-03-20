-- ============================================================
-- Migration 017: Standalone backend canonical trade_outcomes schema
-- ============================================================

CREATE TABLE IF NOT EXISTS trade_outcomes (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT,
  strategy TEXT,
  "class" TEXT,
  probability NUMERIC,
  entry_time TIMESTAMPTZ,
  entry_price NUMERIC,
  exit_time TIMESTAMPTZ,
  exit_price NUMERIC,
  max_runup_pct NUMERIC,
  max_drawdown_pct NUMERIC,
  result_pct NUMERIC,
  pnl_pct NUMERIC,
  outcome TEXT,
  opportunity_id BIGINT,
  stop_loss NUMERIC,
  take_profit NUMERIC,
  expected_move_percent NUMERIC,
  actual_max_move_percent NUMERIC,
  time_to_target_minutes INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  evaluated_at TIMESTAMPTZ DEFAULT NOW(),
  data_quality TEXT,
  calibration_eligible BOOLEAN
);

ALTER TABLE trade_outcomes
  ADD COLUMN IF NOT EXISTS symbol TEXT,
  ADD COLUMN IF NOT EXISTS strategy TEXT,
  ADD COLUMN IF NOT EXISTS "class" TEXT,
  ADD COLUMN IF NOT EXISTS probability NUMERIC,
  ADD COLUMN IF NOT EXISTS entry_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS entry_price NUMERIC,
  ADD COLUMN IF NOT EXISTS exit_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exit_price NUMERIC,
  ADD COLUMN IF NOT EXISTS max_runup_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS max_drawdown_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS result_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS pnl_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS outcome TEXT,
  ADD COLUMN IF NOT EXISTS opportunity_id BIGINT,
  ADD COLUMN IF NOT EXISTS stop_loss NUMERIC,
  ADD COLUMN IF NOT EXISTS take_profit NUMERIC,
  ADD COLUMN IF NOT EXISTS expected_move_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS actual_max_move_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS time_to_target_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS data_quality TEXT,
  ADD COLUMN IF NOT EXISTS calibration_eligible BOOLEAN;

CREATE TABLE IF NOT EXISTS strategy_performance (
  signal_type TEXT PRIMARY KEY,
  win_rate NUMERIC NOT NULL DEFAULT 0.5,
  avg_return NUMERIC NOT NULL DEFAULT 0,
  sample_size INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_outcomes_symbol_entry
  ON trade_outcomes(symbol, entry_time DESC);

CREATE INDEX IF NOT EXISTS idx_trade_outcomes_strategy_class
  ON trade_outcomes(strategy, "class");

CREATE INDEX IF NOT EXISTS idx_trade_outcomes_symbol_eval
  ON trade_outcomes(symbol, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_outcomes_opportunity_eval
  ON trade_outcomes(opportunity_id, evaluated_at DESC);

ALTER TABLE signal_outcomes
  ADD COLUMN IF NOT EXISTS pnl_pct NUMERIC;
