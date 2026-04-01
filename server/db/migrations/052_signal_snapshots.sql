-- ============================================================
-- Migration 052: Signal snapshots table
-- ============================================================
-- All signal engines write to this table. The UI reads ONLY
-- from the latest snapshot batch. Engines NEVER feed the UI
-- directly. Each snapshot batch has a consistent created_at
-- so the UI shows one coherent dataset per cycle.
-- ============================================================

CREATE TABLE IF NOT EXISTS signal_snapshots (
  id                   SERIAL PRIMARY KEY,
  batch_id             TEXT        NOT NULL,      -- shared UUID per snapshot run
  symbol               TEXT        NOT NULL,
  score                NUMERIC,
  confidence           NUMERIC,
  confidence_breakdown JSONB,
  data_completeness    NUMERIC,                   -- 0.0–1.0
  lifecycle_stage      TEXT,
  entry_type           TEXT,
  exit_type            TEXT,
  strategy             TEXT,
  entry_price          NUMERIC,
  stop_loss            NUMERIC,
  target_price         NUMERIC,
  risk_reward          NUMERIC,
  position_size        NUMERIC,
  trade_quality_score  NUMERIC,
  execution_ready      BOOLEAN      DEFAULT FALSE,
  rejection_reason     TEXT,
  why_moving           TEXT,
  why_tradeable        TEXT,
  how_to_trade         TEXT,
  catalyst_type        TEXT,                      -- NULL = no confirmed catalyst
  expected_move        NUMERIC,
  vwap_relation        TEXT,
  volume_trend         TEXT,
  market_structure     TEXT,
  time_context         TEXT,
  source_table         TEXT,                      -- 'strategy_signals' | 'opportunities_v2'
  created_at           TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_batch     ON signal_snapshots (batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_symbol    ON signal_snapshots (symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_created   ON signal_snapshots (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_exec      ON signal_snapshots (execution_ready, created_at DESC)
  WHERE execution_ready = TRUE;
