-- 074: Relax NOT NULL on originating_window for production worker compatibility
--
-- Production beacon-v0-worker (commit 7ce4bd6) does not write
-- originating_window. Migration 070 made it NOT NULL, causing INSERT
-- failures.
--
-- This migration relaxes the constraint to allow inserts without
-- originating_window. When Phase A code is deployed (commits
-- e3be01d through 79bb889), the application will start writing
-- originating_window again, and a future migration can re-add
-- NOT NULL with a backfill.
--
-- Existing data unaffected. discovered_in_window remains unchanged.

BEGIN;

ALTER TABLE beacon_v0_picks
  ALTER COLUMN originating_window DROP NOT NULL;

DO $$
DECLARE
  is_nullable_now text;
BEGIN
  SELECT is_nullable INTO is_nullable_now
  FROM information_schema.columns
  WHERE table_name = 'beacon_v0_picks'
    AND column_name = 'originating_window';

  IF is_nullable_now != 'YES' THEN
    RAISE EXCEPTION 'originating_window is still NOT NULL after migration';
  END IF;
END $$;

COMMIT;