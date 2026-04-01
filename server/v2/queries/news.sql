SELECT
  combined.symbol,
  combined.headline,
  combined.source,
  combined.published_at
FROM (
  SELECT
    NULLIF(BTRIM(na.symbol), '') AS symbol,
    na.headline,
    na.source,
    na.published_at::timestamptz AS published_at
  FROM news_articles na
  WHERE na.published_at >= NOW() - INTERVAL '72 hours'
    AND na.headline IS NOT NULL
    AND BTRIM(na.headline) <> ''

  UNION ALL

  SELECT
    NULLIF(BTRIM(UPPER(inw.symbol)), '') AS symbol,
    inw.headline,
    inw.source,
    inw.published_at
  FROM intel_news inw
  WHERE inw.published_at >= NOW() - INTERVAL '72 hours'
    AND inw.headline IS NOT NULL
    AND BTRIM(inw.headline) <> ''
) AS combined
ORDER BY combined.published_at DESC
LIMIT 50;