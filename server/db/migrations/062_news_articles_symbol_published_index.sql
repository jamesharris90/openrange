-- Migration: Composite index on news_articles(symbol, published_at) for Beacon backtester
-- Applied: 2026-04-24
--
-- Issue: server/backtester/engine.js queries news_articles with
--   WHERE symbol = $1 ORDER BY published_at ASC
--
-- Without this composite index, Postgres used idx_news_articles_symbol + separate Sort.
-- Under concurrent load from nightly Beacon backtest (~1,200 symbols), the Sort step
-- caused occasional 12s timeouts per symbol, failing the nightly run.
--
-- Applied via: CREATE INDEX CONCURRENTLY IF NOT EXISTS
--   idx_news_articles_symbol_published ON news_articles (symbol, published_at ASC)

-- Index was applied to production directly via script on 2026-04-24.
-- This migration file is for schema-of-record only.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_news_articles_symbol_published
  ON news_articles (symbol, published_at ASC);