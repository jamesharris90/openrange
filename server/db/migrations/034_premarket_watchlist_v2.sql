-- 034_premarket_watchlist_v2.sql
-- Upgrade premarket_watchlist with V2 engine columns:
--   stage, news_age_minutes, decay_factor, rank_percentile

ALTER TABLE premarket_watchlist
  ADD COLUMN IF NOT EXISTS stage            TEXT,
  ADD COLUMN IF NOT EXISTS news_age_minutes NUMERIC,
  ADD COLUMN IF NOT EXISTS decay_factor     NUMERIC NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS rank_percentile  NUMERIC;

CREATE INDEX IF NOT EXISTS idx_premarket_watchlist_stage
  ON premarket_watchlist (stage);
