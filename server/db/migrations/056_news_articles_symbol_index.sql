-- Migration 056: Add functional index for news_articles symbol lookups
-- Reason: getDirectNewsCount() uses UPPER(BTRIM(symbol)) which prevents regular index use
-- This functional index enables fast queries for coverage campaign and other features

CREATE INDEX IF NOT EXISTS idx_news_articles_symbol_upper_trim
ON news_articles (UPPER(BTRIM(symbol)));
