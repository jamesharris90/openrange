-- Migration 024: Precomputed 5-day baseline cache for MCP narrative engine
-- Populated every 30 minutes by baselineEngine.js
-- Replaces the heavy daily_ohlc GROUP BY aggregation inside the batch fetch

CREATE TABLE IF NOT EXISTS symbol_baselines (
  symbol     TEXT        PRIMARY KEY,
  avg_move   NUMERIC,
  avg_rvol   NUMERIC,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_symbol_baselines_updated_at
  ON symbol_baselines (updated_at DESC NULLS LAST);
