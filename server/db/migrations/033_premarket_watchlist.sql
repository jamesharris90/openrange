-- Premarket watchlist: deterministic scoring engine output
-- score = (gap_abs*3) + (rvol*5) + (vol_ratio*2) + (news_count*2) + (earnings_flag*3), normalised 0–100

CREATE TABLE IF NOT EXISTS premarket_watchlist (
  symbol          TEXT PRIMARY KEY,
  price           NUMERIC,
  change_percent  NUMERIC,
  gap_percent     NUMERIC,
  relative_volume NUMERIC,
  volume_ratio    NUMERIC,
  news_count      INTEGER NOT NULL DEFAULT 0,
  earnings_flag   INTEGER NOT NULL DEFAULT 0,
  score           NUMERIC NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_premarket_watchlist_score ON premarket_watchlist (score DESC);
