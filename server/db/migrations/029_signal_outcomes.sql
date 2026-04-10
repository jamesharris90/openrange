-- Migration 029: Signal truth + performance tracking
-- Every narrative signal logged here; delayed evaluation fills outcome columns.

CREATE TABLE IF NOT EXISTS signal_outcomes (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol            TEXT        NOT NULL,
  signal_ts         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  setup_type        TEXT,
  trade_class       TEXT,
  consequence       TEXT,
  catalyst_cluster  TEXT,
  entry_price       NUMERIC,
  expected_move_pct NUMERIC,
  price_after_5m    NUMERIC,
  price_after_15m   NUMERIC,
  price_after_1h    NUMERIC,
  price_after_1d    NUMERIC,
  max_upside_pct    NUMERIC,
  max_drawdown_pct  NUMERIC,
  outcome           TEXT CHECK (outcome IN ('WIN', 'LOSS', 'NEUTRAL')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_symbol    ON signal_outcomes (symbol);
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_signal_ts ON signal_outcomes (signal_ts DESC);
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_outcome   ON signal_outcomes (outcome);
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_setup     ON signal_outcomes (setup_type);
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_pending   ON signal_outcomes (signal_ts)
  WHERE price_after_5m IS NULL;

-- Performance note shown alongside trade decision in UI
ALTER TABLE opportunity_stream
  ADD COLUMN IF NOT EXISTS performance_note TEXT;
