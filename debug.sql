-- OpenRange Supabase Debug Pack
-- Use this file to quickly verify data presence and freshness.

-- Schema sanity (run first if columns drift)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'market_metrics'
ORDER BY ordinal_position;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'trade_setups'
ORDER BY ordinal_position;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'news_articles'
ORDER BY ordinal_position;

-- MARKET DATA (latest rows)
SELECT symbol, price, updated_at
FROM market_metrics
ORDER BY updated_at DESC
LIMIT 10;

-- TRADE SETUPS (latest signals)
SELECT symbol, setup, grade, score, detected_at
FROM trade_setups
ORDER BY detected_at DESC
LIMIT 10;

-- NEWS FLOW (latest articles)
SELECT headline, created_at
FROM news_articles
ORDER BY created_at DESC
LIMIT 10;

-- DATA HEALTH CHECK
SELECT
  (SELECT COUNT(*) FROM market_metrics) AS market_metrics_count,
  (SELECT COUNT(*) FROM trade_setups) AS trade_setups_count,
  (SELECT COUNT(*) FROM news_articles) AS news_articles_count;

-- Freshness check (minutes since latest)
SELECT
  EXTRACT(EPOCH FROM (NOW() - MAX(updated_at))) / 60.0 AS market_metrics_minutes_stale
FROM market_metrics;

SELECT
  EXTRACT(EPOCH FROM (NOW() - MAX(detected_at))) / 60.0 AS trade_setups_minutes_stale
FROM trade_setups;

SELECT
  EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) / 60.0 AS news_articles_minutes_stale
FROM news_articles;
