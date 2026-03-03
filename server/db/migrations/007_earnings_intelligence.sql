BEGIN;

CREATE TABLE IF NOT EXISTS earnings_events (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  report_date DATE NOT NULL,
  report_time TEXT,
  eps_estimate NUMERIC,
  eps_actual NUMERIC,
  rev_estimate NUMERIC,
  rev_actual NUMERIC,
  eps_surprise_pct NUMERIC,
  rev_surprise_pct NUMERIC,
  guidance_direction TEXT,
  market_cap NUMERIC,
  float NUMERIC,
  sector TEXT,
  industry TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_earnings_events_symbol_date
  ON earnings_events (symbol, report_date DESC);

CREATE TABLE IF NOT EXISTS earnings_market_reaction (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  report_date DATE NOT NULL,
  pre_market_gap_pct NUMERIC,
  open_gap_pct NUMERIC,
  high_of_day_pct NUMERIC,
  low_of_day_pct NUMERIC,
  close_pct NUMERIC,
  day2_followthrough_pct NUMERIC,
  volume_vs_avg NUMERIC,
  rvol NUMERIC,
  atr_pct NUMERIC,
  implied_move_pct NUMERIC,
  actual_move_pct NUMERIC,
  move_vs_implied_ratio NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_earnings_reaction_symbol_date
  ON earnings_market_reaction (symbol, report_date DESC);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'earnings_scores'
  ) THEN
    ALTER TABLE earnings_scores
      ADD COLUMN IF NOT EXISTS earnings_expected_move_pct NUMERIC,
      ADD COLUMN IF NOT EXISTS earnings_expected_move_dollar NUMERIC,
      ADD COLUMN IF NOT EXISTS earnings_iv NUMERIC;
  END IF;
END$$;

COMMIT;