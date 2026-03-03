-- Migration 010: Market data storage
-- daily_ohlc: 2-year daily OHLCV for ~5,000 symbols (~2.6M rows)
-- intraday_1m: 30-day 1-minute OHLCV for ~5,000 symbols (~60M rows)
-- news_events: rolling 30-day news store
-- ingestion_state: checkpoint table for fullMarketIngestion.ts

-- ─────────────────────────────────────────────────────────
-- Daily OHLCV
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_ohlc (
  symbol  TEXT         NOT NULL,
  date    DATE         NOT NULL,
  open    NUMERIC(12,4),
  high    NUMERIC(12,4),
  low     NUMERIC(12,4),
  close   NUMERIC(12,4),
  volume  BIGINT,
  PRIMARY KEY (symbol, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_ohlc_symbol_date
  ON daily_ohlc (symbol, date DESC);

-- ─────────────────────────────────────────────────────────
-- Intraday 1-minute bars
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intraday_1m (
  symbol      TEXT         NOT NULL,
  "timestamp" TIMESTAMPTZ  NOT NULL,
  open        NUMERIC(12,4),
  high        NUMERIC(12,4),
  low         NUMERIC(12,4),
  close       NUMERIC(12,4),
  volume      BIGINT,
  PRIMARY KEY (symbol, "timestamp")
);

CREATE INDEX IF NOT EXISTS idx_intraday_1m_symbol_ts
  ON intraday_1m (symbol, "timestamp" DESC);

-- ─────────────────────────────────────────────────────────
-- News events (rolling store, 30-day retention)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS news_events (
  id           BIGSERIAL    PRIMARY KEY,
  symbol       TEXT         NOT NULL,
  published_at TIMESTAMPTZ  NOT NULL,
  headline     TEXT         NOT NULL,
  source       TEXT,
  url          TEXT,
  UNIQUE (symbol, published_at, headline)
);

CREATE INDEX IF NOT EXISTS idx_news_events_symbol_pub
  ON news_events (symbol, published_at DESC);

-- ─────────────────────────────────────────────────────────
-- Ingestion checkpoint (used by fullMarketIngestion.ts)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ingestion_state (
  id                INTEGER      PRIMARY KEY DEFAULT 1,
  phase             TEXT         NOT NULL DEFAULT 'idle',
  last_symbol_index INTEGER      NOT NULL DEFAULT 0,
  status            TEXT         NOT NULL DEFAULT 'idle',
  last_updated      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
