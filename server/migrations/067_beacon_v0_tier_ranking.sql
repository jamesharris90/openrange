-- G2a: Beacon v0 tier ranking columns
-- Adds nullable ranking metadata for newly generated picks only. No backfill.

ALTER TABLE beacon_v0_picks
  ADD COLUMN IF NOT EXISTS top_catalyst_tier integer NULL,
  ADD COLUMN IF NOT EXISTS top_catalyst_reasons text[] NULL,
  ADD COLUMN IF NOT EXISTS top_catalyst_rank integer NULL,
  ADD COLUMN IF NOT EXISTS top_catalyst_computed_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_beacon_v0_picks_top_catalyst_tier_rank
  ON beacon_v0_picks (top_catalyst_tier, top_catalyst_rank);
