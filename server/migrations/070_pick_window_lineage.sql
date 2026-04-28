-- 070: Add pick window lineage columns for cross-window pick tracking

BEGIN;

-- 1. originating_window - which window first picked this symbol
ALTER TABLE beacon_v0_picks
  ADD COLUMN originating_window text;

UPDATE beacon_v0_picks
  SET originating_window = discovered_in_window
  WHERE originating_window IS NULL;

ALTER TABLE beacon_v0_picks
  ALTER COLUMN originating_window SET NOT NULL;

-- 2. confirmed_in_windows - subsequent windows that re-picked
ALTER TABLE beacon_v0_picks
  ADD COLUMN confirmed_in_windows text[] NOT NULL DEFAULT '{}';

-- 3. pick_lineage_id - stable identifier across windows
ALTER TABLE beacon_v0_picks
  ADD COLUMN pick_lineage_id uuid NOT NULL DEFAULT gen_random_uuid();

-- 4. Index for cross-window joins
CREATE INDEX idx_beacon_v0_picks_lineage ON beacon_v0_picks (pick_lineage_id);

-- 5. Verify backfill
DO $$
DECLARE
  null_count int;
BEGIN
  SELECT COUNT(*) INTO null_count
  FROM beacon_v0_picks
  WHERE originating_window IS NULL OR pick_lineage_id IS NULL;

  IF null_count > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % rows have null lineage data', null_count;
  END IF;
END $$;

COMMIT;