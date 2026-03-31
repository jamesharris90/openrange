-- 045_validation_metrics.sql
-- Persistent snapshots of validation run stats over time.
-- Replaces reliance on in-memory counters so stats survive restarts.

CREATE TABLE IF NOT EXISTS validation_metrics (
  id              SERIAL      PRIMARY KEY,
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_checked   INT         NOT NULL DEFAULT 0,
  total_rejected  INT         NOT NULL DEFAULT 0,
  rejection_rate  FLOAT       NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_vm_timestamp ON validation_metrics (timestamp DESC);

-- Extend data_validation_log with provider cross-check detail columns
ALTER TABLE data_validation_log
  ADD COLUMN IF NOT EXISTS provider        TEXT    DEFAULT 'fmp',
  ADD COLUMN IF NOT EXISTS local_price     NUMERIC,
  ADD COLUMN IF NOT EXISTS external_price  NUMERIC,
  ADD COLUMN IF NOT EXISTS diff_percent    NUMERIC;

-- Backfill local_price from existing price column
UPDATE data_validation_log
   SET local_price = price
 WHERE local_price IS NULL AND price IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dvl_provider ON data_validation_log (provider);
