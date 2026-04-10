-- Migration 016: Rebuild event/news calendars from validated FMP payloads
-- Source evidence: /logs/fmp/*.raw.json and /logs/fmp/step2-schema-derivation.json

CREATE TABLE IF NOT EXISTS earnings_calendar (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  event_date DATE NOT NULL,
  last_updated_date DATE,
  eps_estimate DOUBLE PRECISION,
  eps_actual DOUBLE PRECISION,
  revenue_estimate NUMERIC,
  revenue_actual NUMERIC,
  source TEXT NOT NULL DEFAULT 'fmp',
  raw_json JSONB NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT earnings_calendar_unique_event UNIQUE (symbol, event_date, source)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'earnings_calendar'
      AND c.relkind = 'r'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_earnings_calendar_symbol ON earnings_calendar (symbol);
    CREATE INDEX IF NOT EXISTS idx_earnings_calendar_event_date ON earnings_calendar (event_date DESC);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ipo_calendar (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  event_date DATE NOT NULL,
  company TEXT,
  exchange TEXT,
  actions TEXT,
  price_range TEXT,
  shares BIGINT,
  market_cap NUMERIC,
  source TEXT NOT NULL DEFAULT 'fmp',
  raw_json JSONB NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ipo_calendar_unique_event UNIQUE (symbol, event_date, actions)
);

CREATE INDEX IF NOT EXISTS idx_ipo_calendar_symbol ON ipo_calendar (symbol);
CREATE INDEX IF NOT EXISTS idx_ipo_calendar_event_date ON ipo_calendar (event_date DESC);

CREATE TABLE IF NOT EXISTS stock_splits (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  event_date DATE NOT NULL,
  numerator INTEGER NOT NULL,
  denominator INTEGER NOT NULL,
  split_type TEXT,
  source TEXT NOT NULL DEFAULT 'fmp',
  raw_json JSONB NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT stock_splits_unique_event UNIQUE (symbol, event_date, numerator, denominator)
);

CREATE INDEX IF NOT EXISTS idx_stock_splits_symbol ON stock_splits (symbol);
CREATE INDEX IF NOT EXISTS idx_stock_splits_event_date ON stock_splits (event_date DESC);

-- Existing table in this codebase. Ensure required fields for strict rebuild exist.
ALTER TABLE news_articles
  ADD COLUMN IF NOT EXISTS symbol TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS body_text TEXT,
  ADD COLUMN IF NOT EXISTS publisher TEXT,
  ADD COLUMN IF NOT EXISTS site TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS published_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_news_articles_symbol ON news_articles (symbol);
CREATE INDEX IF NOT EXISTS idx_news_articles_published_date ON news_articles (published_date DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'news_articles_symbol_published_date_title_key'
      AND conrelid = 'news_articles'::regclass
  ) THEN
    ALTER TABLE news_articles
      ADD CONSTRAINT news_articles_symbol_published_date_title_key
      UNIQUE (symbol, published_date, title);
  END IF;
END $$;
