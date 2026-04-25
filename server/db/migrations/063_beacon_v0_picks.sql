-- Beacon v0 picks table
-- Stores picks computed by server/beacon-v0/ orchestrator
-- Separate from beacon_rankings (used by legacy beacon-nightly-worker)

CREATE TABLE IF NOT EXISTS beacon_v0_picks (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  pattern TEXT NOT NULL,
  confidence TEXT NOT NULL,
  reasoning TEXT,
  signals_aligned TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  run_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_beacon_v0_picks_run ON beacon_v0_picks(run_id);
CREATE INDEX IF NOT EXISTS idx_beacon_v0_picks_created ON beacon_v0_picks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_beacon_v0_picks_symbol ON beacon_v0_picks(symbol);

COMMENT ON TABLE beacon_v0_picks IS 'Picks from Beacon v0 orchestrator. See server/beacon-v0/.';