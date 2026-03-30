-- Migration 042: Live Simulation + Performance Validation + Learning Loop
-- Adds evaluated_at, setup_type to signal_log and creates performance summary table

ALTER TABLE signal_log
  ADD COLUMN IF NOT EXISTS setup_type    TEXT,
  ADD COLUMN IF NOT EXISTS evaluated_at  TIMESTAMPTZ;

-- Guaranteed evaluation index — the evaluation engine queries this constantly
CREATE INDEX IF NOT EXISTS idx_signal_log_eval_ts
  ON signal_log (evaluated, timestamp);

-- Performance aggregation table (Phase 6)
CREATE TABLE IF NOT EXISTS signal_performance_summary (
  id                    SERIAL PRIMARY KEY,
  period_label          TEXT NOT NULL,          -- e.g. 'today', '7d', 'all'
  setup_type            TEXT,
  execution_rating      TEXT,
  session_phase         TEXT,
  signal_type           TEXT,
  total_signals         INT     DEFAULT 0,
  win_count             INT     DEFAULT 0,
  loss_count            INT     DEFAULT 0,
  neutral_count         INT     DEFAULT 0,
  error_count           INT     DEFAULT 0,
  win_rate              NUMERIC,
  avg_return            NUMERIC,
  avg_drawdown          NUMERIC,
  confidence_adjustment INT     DEFAULT 0,
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (period_label, setup_type, execution_rating, session_phase, signal_type)
);

CREATE INDEX IF NOT EXISTS idx_sps_period ON signal_performance_summary (period_label, updated_at DESC);
