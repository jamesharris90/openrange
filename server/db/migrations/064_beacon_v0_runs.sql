-- Beacon v0 run tracking
-- Used to prevent overlapping runs and observe worker health

CREATE TABLE IF NOT EXISTS beacon_v0_runs (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  universe_size INTEGER,
  picks_generated INTEGER,
  duration_seconds INTEGER,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_beacon_v0_runs_status ON beacon_v0_runs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_beacon_v0_runs_started ON beacon_v0_runs(started_at DESC);

COMMENT ON TABLE beacon_v0_runs IS 'Run lifecycle for Beacon v0 worker. Used to prevent overlapping runs.';