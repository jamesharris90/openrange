-- Migration 023: Add narrative fields to opportunity_stream
-- These columns store the output of mcpNarrativeEngine (real-data version)

ALTER TABLE opportunity_stream
  ADD COLUMN IF NOT EXISTS why         TEXT,
  ADD COLUMN IF NOT EXISTS tradeability TEXT,
  ADD COLUMN IF NOT EXISTS plan         TEXT,
  ADD COLUMN IF NOT EXISTS confidence   INT,
  ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_opportunity_stream_updated_at
  ON opportunity_stream (updated_at DESC NULLS LAST);
