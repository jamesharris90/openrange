-- 069: Add discovered_in_window to beacon_v0_picks for G2c windowed discovery

BEGIN;

-- 1. Add column with default for backfill
ALTER TABLE beacon_v0_picks
  ADD COLUMN discovered_in_window text NOT NULL DEFAULT 'nightly';

-- 2. Verify all existing rows are 'nightly' (they should be, due to default)
DO $$
DECLARE
  non_nightly_count int;
BEGIN
  SELECT COUNT(*) INTO non_nightly_count
  FROM beacon_v0_picks
  WHERE discovered_in_window != 'nightly';

  IF non_nightly_count > 0 THEN
    RAISE EXCEPTION 'Found % non-nightly rows after backfill', non_nightly_count;
  END IF;
END $$;

-- 3. Add CHECK constraint for allowed values
ALTER TABLE beacon_v0_picks
  ADD CONSTRAINT beacon_v0_picks_discovered_in_window_check
  CHECK (discovered_in_window IN ('nightly', 'premarket', 'open', 'power_hour', 'post_market'));

-- 4. Add index for window-filtered queries
CREATE INDEX idx_beacon_v0_picks_window_created
  ON beacon_v0_picks (discovered_in_window, created_at DESC);

COMMIT;
