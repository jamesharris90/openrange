CREATE TABLE IF NOT EXISTS premarket_picks (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generator TEXT NOT NULL DEFAULT 'premarket_catalyst_v1',

  score NUMERIC(5,2) NOT NULL,
  label TEXT NOT NULL CHECK (label IN ('A', 'B', 'C')),
  structure_type TEXT,
  trade_state TEXT,

  catalyst_score NUMERIC(5,2),
  gap_score NUMERIC(5,2),
  volume_score NUMERIC(5,2),
  structure_score NUMERIC(5,2),
  regime_score NUMERIC(5,2),

  catalyst_type TEXT,
  catalyst_summary TEXT,
  catalyst_timestamp TIMESTAMPTZ,
  catalyst_source TEXT,

  pick_price NUMERIC(12,4),
  previous_close NUMERIC(12,4),
  gap_percent NUMERIC(8,4),
  premarket_volume BIGINT,
  premarket_volume_baseline BIGINT,
  rvol NUMERIC(8,4),
  premarket_high NUMERIC(12,4),
  premarket_low NUMERIC(12,4),
  premarket_vwap NUMERIC(12,4),
  above_vwap BOOLEAN,
  near_high BOOLEAN,

  market_cap BIGINT,
  float_shares BIGINT,
  sector TEXT,
  sector_rank INTEGER,
  market_regime TEXT,
  vix_level TEXT,

  risk_flags JSONB DEFAULT '[]'::jsonb,
  why JSONB DEFAULT '[]'::jsonb,

  stop_idea NUMERIC(12,4),
  first_target NUMERIC(12,4),
  invalidation TEXT,

  outcome_status TEXT DEFAULT 'pending' CHECK (outcome_status IN
    ('pending', 'partial', 'complete', 'stale', 'errored', 'corrupted')),
  outcome_complete BOOLEAN DEFAULT false,
  outcome_t1_due_at TIMESTAMPTZ,
  outcome_t2_due_at TIMESTAMPTZ,
  outcome_t3_due_at TIMESTAMPTZ,
  outcome_t4_due_at TIMESTAMPTZ,
  outcome_t1_captured_at TIMESTAMPTZ,
  outcome_t2_captured_at TIMESTAMPTZ,
  outcome_t3_captured_at TIMESTAMPTZ,
  outcome_t4_captured_at TIMESTAMPTZ,
  outcome_t1_price NUMERIC(12,4),
  outcome_t2_price NUMERIC(12,4),
  outcome_t3_price NUMERIC(12,4),
  outcome_t4_price NUMERIC(12,4),
  outcome_t1_pct_change NUMERIC(10,4),
  outcome_t2_pct_change NUMERIC(10,4),
  outcome_t3_pct_change NUMERIC(10,4),
  outcome_t4_pct_change NUMERIC(10,4),
  outcome_t1_session_minutes NUMERIC(8,2),
  outcome_t2_session_minutes NUMERIC(8,2),
  outcome_t3_session_minutes NUMERIC(8,2),
  outcome_t4_session_minutes NUMERIC(8,2),
  outcome_last_attempted_at TIMESTAMPTZ,

  CONSTRAINT premarket_picks_unique UNIQUE (symbol, generated_at, generator)
);

CREATE INDEX IF NOT EXISTS premarket_picks_generated_idx
  ON premarket_picks (generated_at DESC);

CREATE INDEX IF NOT EXISTS premarket_picks_label_score_idx
  ON premarket_picks (label, score DESC, generated_at DESC);

CREATE INDEX IF NOT EXISTS premarket_picks_symbol_idx
  ON premarket_picks (symbol, generated_at DESC);

CREATE INDEX IF NOT EXISTS premarket_picks_outcome_due_idx
  ON premarket_picks (outcome_status, outcome_t1_due_at)
  WHERE outcome_status IN ('pending', 'partial', 'stale');
