-- 037_premarket_trust.sql
-- Phase 3: add last_calculated_at to lock score to engine cycle
-- Phase 6: ensure company_profiles has description column

ALTER TABLE premarket_watchlist
  ADD COLUMN IF NOT EXISTS last_calculated_at TIMESTAMPTZ;

-- Backfill existing rows so the column is never null
UPDATE premarket_watchlist
SET last_calculated_at = updated_at
WHERE last_calculated_at IS NULL;

-- description column for company context (FMP /profile returns it as 'description')
ALTER TABLE company_profiles
  ADD COLUMN IF NOT EXISTS description TEXT;

CREATE INDEX IF NOT EXISTS idx_premarket_watchlist_last_calc
  ON premarket_watchlist (last_calculated_at DESC);
