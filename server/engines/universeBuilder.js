const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

async function ensureUniverseTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS tradable_universe (
      symbol TEXT PRIMARY KEY,
      price NUMERIC,
      change_percent NUMERIC,
      relative_volume NUMERIC,
      volume BIGINT,
      avg_volume_30d NUMERIC,
      updated_at TIMESTAMPTZ DEFAULT now()
    )`,
    [],
    { timeoutMs: 5000, label: 'engines.universeBuilder.ensure_table', maxRetries: 0 }
  );
}

async function runUniverseBuilder() {
  const startedAt = Date.now();
  await ensureUniverseTable();

  const { rows } = await queryWithTimeout(
    `WITH source_rows AS (
      SELECT
        m.symbol,
        COALESCE(m.price, q.price) AS price,
        COALESCE(m.change_percent, q.change_percent) AS change_percent,
        m.relative_volume,
        COALESCE(m.volume, q.volume) AS volume,
        m.avg_volume_30d,
        q.market_cap,
        COALESCE(
          m.atr_percent,
          CASE WHEN COALESCE(m.price, q.price) > 0 AND m.atr IS NOT NULL THEN (m.atr / COALESCE(m.price, q.price)) * 100 END,
          ABS(m.gap_percent),
          ABS(COALESCE(m.change_percent, q.change_percent))
        ) AS atr_percent
      FROM market_metrics m
      LEFT JOIN market_quotes q ON q.symbol = m.symbol
    )
    SELECT
      symbol,
      price,
      change_percent,
      relative_volume,
      volume,
      avg_volume_30d
    FROM source_rows
    WHERE price > 5
      AND COALESCE(avg_volume_30d, 0) > 1000000
      AND COALESCE(market_cap, 0) > 300000000
      AND COALESCE(atr_percent, 0) > 2
    ORDER BY relative_volume DESC NULLS LAST
    LIMIT 800`,
    [],
    { timeoutMs: 10000, label: 'engines.universeBuilder.select', maxRetries: 0 }
  );

  if (!rows.length) {
    logger.info('Universe builder complete', { selected: 0, runtimeMs: Date.now() - startedAt });
    return { selected: 0, runtimeMs: Date.now() - startedAt };
  }

  const symbols = rows.map((row) => row.symbol);
  const prices = rows.map((row) => row.price);
  const changePercents = rows.map((row) => row.change_percent);
  const relativeVolumes = rows.map((row) => row.relative_volume);
  const volumes = rows.map((row) => row.volume);
  const avgVolumes = rows.map((row) => row.avg_volume_30d);

  await queryWithTimeout(
    `INSERT INTO tradable_universe (
      symbol,
      price,
      change_percent,
      relative_volume,
      volume,
      avg_volume_30d,
      updated_at
    )
    SELECT
      unnest($1::text[]),
      unnest($2::numeric[]),
      unnest($3::numeric[]),
      unnest($4::numeric[]),
      unnest($5::bigint[]),
      unnest($6::numeric[]),
      now()
    ON CONFLICT (symbol)
    DO UPDATE SET
      price = EXCLUDED.price,
      change_percent = EXCLUDED.change_percent,
      relative_volume = EXCLUDED.relative_volume,
      volume = EXCLUDED.volume,
      avg_volume_30d = EXCLUDED.avg_volume_30d,
      updated_at = now()`,
    [symbols, prices, changePercents, relativeVolumes, volumes, avgVolumes],
    { timeoutMs: 15000, label: 'engines.universeBuilder.upsert', maxRetries: 0 }
  );

  const runtimeMs = Date.now() - startedAt;
  logger.info('Universe builder complete', {
    selected: rows.length,
    runtimeMs,
  });

  return {
    selected: rows.length,
    runtimeMs,
  };
}

module.exports = {
  runUniverseBuilder,
};
