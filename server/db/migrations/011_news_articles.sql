-- Migration 011: News articles (scored FMP news for News Scanner page)
-- and unique constraint on earnings_events for safe upserts

-- ─────────────────────────────────────────────────────────
-- news_articles
-- Populated by newsEngineV3.js refreshNewsForSymbols()
-- Read by /api/news/v3 (NewsScannerV2 page)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS news_articles (
  id            TEXT         PRIMARY KEY,
  headline      TEXT         NOT NULL,
  symbols       TEXT[]       NOT NULL DEFAULT '{}',
  source        TEXT,
  url           TEXT,
  published_at  TIMESTAMPTZ,
  summary       TEXT,
  catalyst_type TEXT,
  news_score    NUMERIC      NOT NULL DEFAULT 0,
  score_breakdown JSONB      NOT NULL DEFAULT '{}'::jsonb,
  raw_payload   JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_articles_published_at
  ON news_articles (published_at DESC);

CREATE INDEX IF NOT EXISTS idx_news_articles_news_score
  ON news_articles (news_score DESC);

-- GIN index for array containment: WHERE symbols && $1::text[]
CREATE INDEX IF NOT EXISTS idx_news_articles_symbols
  ON news_articles USING GIN (symbols);

CREATE INDEX IF NOT EXISTS idx_news_articles_catalyst
  ON news_articles (catalyst_type);

-- ─────────────────────────────────────────────────────────
-- Add unique constraint to earnings_events so upserts work
-- (idempotent: DO NOTHING if constraint already exists)
-- ─────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'earnings_events_symbol_report_date_key'
      AND conrelid = 'earnings_events'::regclass
  ) THEN
    ALTER TABLE earnings_events
      ADD CONSTRAINT earnings_events_symbol_report_date_key
      UNIQUE (symbol, report_date);
  END IF;
END$$;
