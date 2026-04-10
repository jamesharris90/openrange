-- Migration 026: Symbol coverage tracking table
-- Populated by symbolCoverageEngine.js on first access + periodic checks

CREATE TABLE IF NOT EXISTS symbol_coverage (
  symbol       TEXT        PRIMARY KEY,
  intraday_ok  BOOLEAN     NOT NULL DEFAULT false,
  daily_ok     BOOLEAN     NOT NULL DEFAULT false,
  earnings_ok  BOOLEAN     NOT NULL DEFAULT false,
  news_ok      BOOLEAN     NOT NULL DEFAULT false,
  status       TEXT        NOT NULL DEFAULT 'UNKNOWN'
                           CHECK (status IN ('COMPLETE','PARTIAL','FAILED','UNKNOWN')),
  last_checked TIMESTAMPTZ,
  backfill_at  TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_symbol_coverage_status
  ON symbol_coverage (status, updated_at DESC);
