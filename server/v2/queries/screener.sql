WITH latest_quotes AS (
  SELECT DISTINCT ON (mq.symbol)
    mq.symbol,
    mq.price,
    mq.change_percent,
    mq.volume,
    mq.relative_volume,
    mq.sector,
    mq.updated_at
  FROM market_quotes mq
  WHERE COALESCE(mq.price, 0) > 0
    AND COALESCE(mq.volume, 0) > 0
  ORDER BY mq.symbol, mq.updated_at DESC NULLS LAST
),
latest_metrics AS (
  SELECT DISTINCT ON (mm.symbol)
    mm.symbol,
    mm.price,
    mm.change_percent,
    mm.volume,
    mm.gap_percent,
    mm.relative_volume,
    mm.updated_at,
    mm.last_updated
  FROM market_metrics mm
  ORDER BY mm.symbol, COALESCE(mm.updated_at, mm.last_updated::timestamptz) DESC NULLS LAST
),
latest_stocks_in_play AS (
  SELECT DISTINCT ON (sip.symbol)
    sip.symbol,
    sip.gap_percent,
    sip.rvol,
    sip.detected_at
  FROM stocks_in_play sip
  ORDER BY sip.symbol, sip.detected_at DESC NULLS LAST
)
SELECT
  q.symbol,
  COALESCE(q.price, m.price) AS price,
  COALESCE(q.change_percent, m.change_percent) AS change_percent,
  COALESCE(q.volume, m.volume) AS volume,
  COALESCE(q.relative_volume, sip.rvol, m.relative_volume, NULL) AS rvol,
  COALESCE(sip.gap_percent, m.gap_percent, NULL) AS gap_percent,
  COALESCE(q.sector, tu.sector, NULL) AS sector,
  COALESCE(q.updated_at, m.updated_at, m.last_updated::timestamptz, sip.detected_at, NULL) AS updated_at
FROM latest_quotes q
LEFT JOIN latest_metrics m ON m.symbol = q.symbol
LEFT JOIN latest_stocks_in_play sip ON sip.symbol = q.symbol
LEFT JOIN ticker_universe tu ON tu.symbol = q.symbol
WHERE COALESCE(q.price, m.price) > 0
  AND COALESCE(q.volume, m.volume) > 0
ORDER BY
  COALESCE(q.relative_volume, sip.rvol, m.relative_volume) DESC NULLS LAST,
  COALESCE(q.volume, m.volume) DESC,
  q.symbol ASC
LIMIT 100;