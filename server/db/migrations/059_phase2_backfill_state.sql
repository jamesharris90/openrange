CREATE TABLE IF NOT EXISTS phase2_backfill_state (
  state_key TEXT PRIMARY KEY,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phase2_backfill_state_updated_at
  ON phase2_backfill_state(updated_at DESC);