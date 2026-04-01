SELECT
  NULLIF(BTRIM(symbol), '') AS symbol,
  headline,
  source,
  published_at
FROM latest_news_cache
ORDER BY published_at DESC
LIMIT 50;