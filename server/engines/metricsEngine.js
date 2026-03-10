const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

async function runMetricsEngine() {
  const startedAt = Date.now();

  await queryWithTimeout(
    `ALTER TABLE market_metrics
      ADD COLUMN IF NOT EXISTS price NUMERIC,
      ADD COLUMN IF NOT EXISTS change_percent NUMERIC,
      ADD COLUMN IF NOT EXISTS gap_percent NUMERIC,
      ADD COLUMN IF NOT EXISTS relative_volume NUMERIC,
      ADD COLUMN IF NOT EXISTS volume BIGINT,
      ADD COLUMN IF NOT EXISTS avg_volume_30d NUMERIC,
      ADD COLUMN IF NOT EXISTS float_shares NUMERIC,
      ADD COLUMN IF NOT EXISTS atr_percent NUMERIC,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()`,
    [],
    { timeoutMs: 5000, label: 'engines.metricsEngine.ensure_columns', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE INDEX IF NOT EXISTS idx_daily_ohlc_symbol_date_desc
       ON daily_ohlc (symbol, date DESC)`,
    [],
    { timeoutMs: 5000, label: 'engines.metricsEngine.ensure_index_ohlc', maxRetries: 0 }
  );

  const { rows } = await queryWithTimeout(
    `SELECT
       mq.symbol,
       mq.price,
      mq.volume,
      mq.market_cap,
       avg30.avg_volume_30d,
       CASE
         WHEN pc.previous_close IS NOT NULL
              AND pc.previous_close <> 0
              AND mq.price IS NOT NULL
           THEN ((mq.price - pc.previous_close) / pc.previous_close) * 100
         ELSE mq.change_percent
       END AS change_percent,
       CASE
         WHEN pc.previous_close IS NOT NULL
              AND pc.previous_close <> 0
              AND t.open_price IS NOT NULL
           THEN ((t.open_price - pc.previous_close) / pc.previous_close) * 100
         ELSE mq.change_percent
       END AS gap_percent,
       CASE
         WHEN avg30.avg_volume_30d IS NOT NULL
              AND avg30.avg_volume_30d <> 0
              AND mq.volume IS NOT NULL
           THEN mq.volume::numeric / avg30.avg_volume_30d
         ELSE NULL
       END AS relative_volume,
       CASE
         WHEN COALESCE(mq.market_cap, 0) > 0 AND COALESCE(mq.price, 0) > 0
           THEN mq.market_cap / mq.price
         ELSE NULL
       END AS float_shares,
       CASE
         WHEN COALESCE(mq.price, 0) > 0
              AND COALESCE(t.high_price, 0) > 0
              AND COALESCE(t.low_price, 0) > 0
           THEN ((t.high_price - t.low_price) / mq.price) * 100
         ELSE NULL
       END AS atr_percent
     FROM market_quotes mq
     LEFT JOIN LATERAL (
       SELECT d.close AS previous_close
       FROM daily_ohlc d
       WHERE d.symbol = mq.symbol
         AND d.date < CURRENT_DATE
       ORDER BY d.date DESC
       LIMIT 1
     ) pc ON TRUE
     LEFT JOIN LATERAL (
       SELECT
         d.open AS open_price,
         d.high AS high_price,
         d.low AS low_price
       FROM daily_ohlc d
       WHERE d.symbol = mq.symbol
         AND d.date = CURRENT_DATE
       ORDER BY d.date DESC
       LIMIT 1
     ) t ON TRUE
     LEFT JOIN LATERAL (
       SELECT AVG(v.volume::numeric) AS avg_volume_30d
       FROM (
         SELECT d.volume
         FROM daily_ohlc d
         WHERE d.symbol = mq.symbol
           AND d.date < CURRENT_DATE
           AND d.volume IS NOT NULL
         ORDER BY d.date DESC
         LIMIT 30
       ) v
     ) avg30 ON TRUE`,
    [],
    { timeoutMs: 30000, label: 'engines.metricsEngine.select', maxRetries: 0 }
  );

  if (!rows.length) {
    return {
      symbolsRead: 0,
      upserted: 0,
      runtimeMs: Date.now() - startedAt,
    };
  }

  const symbols = rows.map((row) => row.symbol);
  const prices = rows.map((row) => row.price);
  const changePercents = rows.map((row) => row.change_percent);
  const gapPercents = rows.map((row) => row.gap_percent);
  const relativeVolumes = rows.map((row) => row.relative_volume);
  const volumes = rows.map((row) => row.volume);
  const avgVolumes = rows.map((row) => row.avg_volume_30d);
  const floatShares = rows.map((row) => row.float_shares);
  const atrPercents = rows.map((row) => row.atr_percent);

  await queryWithTimeout(
    `INSERT INTO market_metrics (
        symbol,
        price,
        change_percent,
        gap_percent,
        relative_volume,
        volume,
        avg_volume_30d,
        float_shares,
        atr_percent,
        updated_at
      )
      SELECT *
      FROM (
        SELECT
          unnest($1::text[]) AS symbol,
          unnest($2::numeric[]) AS price,
          unnest($3::numeric[]) AS change_percent,
          unnest($4::numeric[]) AS gap_percent,
          unnest($5::numeric[]) AS relative_volume,
          unnest($6::bigint[]) AS volume,
          unnest($7::numeric[]) AS avg_volume_30d,
            unnest($8::numeric[]) AS float_shares,
            unnest($9::numeric[]) AS atr_percent,
          now() AS updated_at
      ) incoming
      ON CONFLICT(symbol)
      DO UPDATE SET
        price = EXCLUDED.price,
        change_percent = EXCLUDED.change_percent,
        gap_percent = EXCLUDED.gap_percent,
        relative_volume = EXCLUDED.relative_volume,
        volume = EXCLUDED.volume,
        avg_volume_30d = EXCLUDED.avg_volume_30d,
        float_shares = COALESCE(EXCLUDED.float_shares, market_metrics.float_shares),
        atr_percent = COALESCE(EXCLUDED.atr_percent, market_metrics.atr_percent),
        updated_at = now()`,
      [symbols, prices, changePercents, gapPercents, relativeVolumes, volumes, avgVolumes, floatShares, atrPercents],
    { timeoutMs: 15000, label: 'engines.metricsEngine.batch.1', maxRetries: 0 }
  );

  const upserted = rows.length;

  const runtimeMs = Date.now() - startedAt;
  logger.info('Metrics engine complete', {
    symbolsRead: rows.length,
    upserted,
    runtimeMs,
  });

  return {
    symbolsRead: rows.length,
    upserted,
    runtimeMs,
  };
}

module.exports = {
  runMetricsEngine,
};
