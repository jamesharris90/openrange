CREATE TABLE IF NOT EXISTS data_coverage (
  symbol TEXT PRIMARY KEY,
  has_news BOOLEAN NOT NULL DEFAULT FALSE,
  has_earnings BOOLEAN NOT NULL DEFAULT FALSE,
  has_technicals BOOLEAN NOT NULL DEFAULT FALSE,
  news_count INTEGER NOT NULL DEFAULT 0,
  earnings_count INTEGER NOT NULL DEFAULT 0,
  last_news_at TIMESTAMPTZ,
  last_earnings_at TIMESTAMPTZ,
  coverage_score INTEGER NOT NULL DEFAULT 0,
  last_checked TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_coverage_score
  ON data_coverage (coverage_score ASC, symbol ASC);

CREATE INDEX IF NOT EXISTS idx_data_coverage_checked
  ON data_coverage (last_checked DESC);