-- 044_data_validation_log.sql
-- Stores records of market data rows rejected by the validation engine.
-- Used for monitoring data quality and computing rejection rates.

CREATE TABLE IF NOT EXISTS data_validation_log (
  id               BIGSERIAL PRIMARY KEY,
  symbol           TEXT          NOT NULL,
  issue            TEXT          NOT NULL,
  price            NUMERIC,
  change_percent   NUMERIC,
  relative_volume  NUMERIC,
  engine           TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dvl_created_at ON data_validation_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dvl_symbol     ON data_validation_log (symbol);
CREATE INDEX IF NOT EXISTS idx_dvl_issue      ON data_validation_log (issue);

-- Retention: auto-purge rows older than 7 days so the table stays small
-- (vacuum runs this via pg_cron or a periodic DELETE from the app layer)
