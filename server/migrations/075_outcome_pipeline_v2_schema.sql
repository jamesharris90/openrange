-- 075: Outcome pipeline v2 schema additions
--
-- Implements spec at /tmp/outcome_pipeline_spec_v2.md sections B2-B7.
-- Adds per-pick due times, explicit outcome status, operational
-- timestamp, and per-checkpoint session length metadata.
--
-- Existing outcome_t{1-4}_* columns and outcome_complete are preserved
-- unchanged. New worker (Implementation 2) will use the new columns;
-- old worker continues writing the legacy columns until replaced.
--
-- Existing rows are reclassified into outcome_status based on whether
-- their existing outcome_complete flag matches the actual checkpoint
-- data. The known-corrupted rows (outcome_complete=true with missing
-- checkpoint captures) are explicitly marked 'corrupted' so analytics
-- can exclude them.

BEGIN;

-- Due-time columns
ALTER TABLE beacon_v0_picks
  ADD COLUMN outcome_t1_due_at TIMESTAMPTZ,
  ADD COLUMN outcome_t2_due_at TIMESTAMPTZ,
  ADD COLUMN outcome_t3_due_at TIMESTAMPTZ,
  ADD COLUMN outcome_t4_due_at TIMESTAMPTZ;

-- Status column with constraint
ALTER TABLE beacon_v0_picks
  ADD COLUMN outcome_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (outcome_status IN ('pending', 'partial', 'complete', 'stale', 'errored', 'corrupted'));

-- Operational timestamp
ALTER TABLE beacon_v0_picks
  ADD COLUMN outcome_last_attempted_at TIMESTAMPTZ;

-- Per-checkpoint session-length metadata
ALTER TABLE beacon_v0_picks
  ADD COLUMN outcome_t1_session_minutes INTEGER,
  ADD COLUMN outcome_t2_session_minutes INTEGER,
  ADD COLUMN outcome_t3_session_minutes INTEGER,
  ADD COLUMN outcome_t4_session_minutes INTEGER;

-- Backfill outcome_status from existing data
-- All four captured: complete
UPDATE beacon_v0_picks
SET outcome_status = 'complete'
WHERE outcome_complete = true
  AND outcome_t1_captured_at IS NOT NULL
  AND outcome_t2_captured_at IS NOT NULL
  AND outcome_t3_captured_at IS NOT NULL
  AND outcome_t4_captured_at IS NOT NULL;

-- outcome_complete=true but at least one capture missing: corrupted
UPDATE beacon_v0_picks
SET outcome_status = 'corrupted'
WHERE outcome_complete = true
  AND (
    outcome_t1_captured_at IS NULL
    OR outcome_t2_captured_at IS NULL
    OR outcome_t3_captured_at IS NULL
    OR outcome_t4_captured_at IS NULL
  );

-- outcome_complete=false with at least one capture: partial
UPDATE beacon_v0_picks
SET outcome_status = 'partial'
WHERE outcome_complete = false
  AND (
    outcome_t1_captured_at IS NOT NULL
    OR outcome_t2_captured_at IS NOT NULL
    OR outcome_t3_captured_at IS NOT NULL
    OR outcome_t4_captured_at IS NOT NULL
  );

-- Default 'pending' from column default already covers
-- outcome_complete=false with all NULL

-- Indexes
CREATE INDEX idx_beacon_v0_picks_outcome_status
  ON beacon_v0_picks (outcome_status);

CREATE INDEX idx_beacon_v0_picks_outcome_status_t1_due
  ON beacon_v0_picks (outcome_status, outcome_t1_due_at)
  WHERE outcome_status IN ('pending', 'partial', 'stale');

-- Verification block
DO $$
DECLARE
  total_rows INTEGER;
  corrupted_rows INTEGER;
  pending_rows INTEGER;
  complete_rows INTEGER;
  partial_rows INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_rows FROM beacon_v0_picks;
  SELECT COUNT(*) INTO corrupted_rows FROM beacon_v0_picks WHERE outcome_status = 'corrupted';
  SELECT COUNT(*) INTO pending_rows FROM beacon_v0_picks WHERE outcome_status = 'pending';
  SELECT COUNT(*) INTO complete_rows FROM beacon_v0_picks WHERE outcome_status = 'complete';
  SELECT COUNT(*) INTO partial_rows FROM beacon_v0_picks WHERE outcome_status = 'partial';

  RAISE NOTICE 'Migration 075 verification: total=%, corrupted=%, pending=%, complete=%, partial=%',
    total_rows, corrupted_rows, pending_rows, complete_rows, partial_rows;

  IF corrupted_rows < 600 THEN
    RAISE EXCEPTION 'Expected at least 600 corrupted rows from prior diagnostic, found %', corrupted_rows;
  END IF;

  IF (corrupted_rows + pending_rows + complete_rows + partial_rows) != total_rows THEN
    RAISE EXCEPTION 'Status backfill incomplete: sum % != total %',
      (corrupted_rows + pending_rows + complete_rows + partial_rows), total_rows;
  END IF;
END $$;

COMMIT;