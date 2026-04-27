-- G2b: outcome capture columns for Beacon v0 picks.
-- Stores four checkpoint outcomes directly on beacon_v0_picks.

ALTER TABLE beacon_v0_picks
  ADD COLUMN IF NOT EXISTS outcome_t1_price numeric,
  ADD COLUMN IF NOT EXISTS outcome_t1_pct_change numeric,
  ADD COLUMN IF NOT EXISTS outcome_t1_volume_ratio numeric,
  ADD COLUMN IF NOT EXISTS outcome_t1_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_t2_price numeric,
  ADD COLUMN IF NOT EXISTS outcome_t2_pct_change numeric,
  ADD COLUMN IF NOT EXISTS outcome_t2_volume_ratio numeric,
  ADD COLUMN IF NOT EXISTS outcome_t2_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_t3_price numeric,
  ADD COLUMN IF NOT EXISTS outcome_t3_pct_change numeric,
  ADD COLUMN IF NOT EXISTS outcome_t3_volume_ratio numeric,
  ADD COLUMN IF NOT EXISTS outcome_t3_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_t4_price numeric,
  ADD COLUMN IF NOT EXISTS outcome_t4_pct_change numeric,
  ADD COLUMN IF NOT EXISTS outcome_t4_volume_ratio numeric,
  ADD COLUMN IF NOT EXISTS outcome_t4_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_complete boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_beacon_v0_picks_outcome_pending
  ON beacon_v0_picks (outcome_complete, created_at)
  WHERE outcome_complete = false;

UPDATE beacon_v0_picks
SET outcome_complete = true
WHERE baseline_source = 'unavailable'
  AND outcome_complete = false;
