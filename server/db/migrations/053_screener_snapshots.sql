-- ============================================================
-- Migration 053: Screener snapshots
-- ============================================================
-- Stores the final v2 screener/opportunities payload as a single
-- JSON snapshot so request handlers only read the latest batch.
-- ============================================================

CREATE TABLE IF NOT EXISTS screener_snapshots (
  id BIGSERIAL PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_screener_snapshots_created_at
  ON screener_snapshots (created_at DESC);