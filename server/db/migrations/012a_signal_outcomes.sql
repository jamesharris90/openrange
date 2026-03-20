-- ============================================================
-- Migration 012a: Ensure signal_outcomes baseline for Phase D view
-- ============================================================

CREATE TABLE IF NOT EXISTS signal_outcomes (
  id BIGSERIAL PRIMARY KEY,
  signal_id BIGINT,
  outcome TEXT,
  pnl_pct NUMERIC(8,4),
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE signal_outcomes
  ADD COLUMN IF NOT EXISTS signal_id BIGINT,
  ADD COLUMN IF NOT EXISTS outcome TEXT,
  ADD COLUMN IF NOT EXISTS pnl_pct NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_signal_id
  ON signal_outcomes(signal_id);
