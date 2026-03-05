const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

async function ensureUniverseTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS tradable_universe (
      symbol TEXT PRIMARY KEY,
      price NUMERIC,
      change_percent NUMERIC,
      gap_percent NUMERIC,
      relative_volume NUMERIC,
      volume BIGINT,
      avg_volume_30d NUMERIC,
      updated_at TIMESTAMPTZ DEFAULT now()
    )`,
    [],
    { timeoutMs: 5000, label: 'engines.universeBuilder.ensure_table', maxRetries: 0 }
  );
  await queryWithTimeout(
    `ALTER TABLE tradable_universe
      ADD COLUMN IF NOT EXISTS gap_percent NUMERIC`,
    [],
    { timeoutMs: 5000, label: 'engines.universeBuilder.ensure_columns', maxRetries: 0 }
  );
}

async function runUniverseBuilder() {
  const startedAt = Date.now();
  await ensureUniverseTable();

  const { rows } = await queryWithTimeout(
    `SELECT
      symbol,
      price,
      change_percent,
      gap_percent,
      relative_volume,
      volume,
      avg_volume_30d,
      updated_at
    FROM market_metrics`,
    [],
    { timeoutMs: 10000, label: 'engines.universeBuilder.select', maxRetries: 0 }
  );

  console.log('Universe builder rows:', rows.length);

  if (!rows.length) {
    logger.info('Universe builder complete', { selected: 0, runtimeMs: Date.now() - startedAt });
    return { selected: 0, runtimeMs: Date.now() - startedAt };
  }

  const symbols = rows.map((row) => row.symbol);
  const prices = rows.map((row) => row.price);
  const changePercents = rows.map((row) => row.change_percent);
  const gapPercents = rows.map((row) => row.gap_percent);
  const relativeVolumes = rows.map((row) => row.relative_volume);
  const volumes = rows.map((row) => row.volume);
  const avgVolumes = rows.map((row) => row.avg_volume_30d);
  const updatedAts = rows.map((row) => row.updated_at || new Date().toISOString());

  await queryWithTimeout(
    `INSERT INTO tradable_universe (
      symbol,
      price,
      change_percent,
      gap_percent,
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
      unnest($5::numeric[]),
      unnest($6::bigint[]),
      unnest($7::numeric[]),
      unnest($8::timestamptz[])
    ON CONFLICT (symbol)
    DO UPDATE SET
      price = EXCLUDED.price,
      change_percent = EXCLUDED.change_percent,
      gap_percent = EXCLUDED.gap_percent,
      relative_volume = EXCLUDED.relative_volume,
      volume = EXCLUDED.volume,
      avg_volume_30d = EXCLUDED.avg_volume_30d,
      updated_at = EXCLUDED.updated_at`,
    [symbols, prices, changePercents, gapPercents, relativeVolumes, volumes, avgVolumes, updatedAts],
    { timeoutMs: 15000, label: 'engines.universeBuilder.upsert', maxRetries: 0 }
  );

  await queryWithTimeout(
    `DELETE FROM tradable_universe tu
     WHERE NOT EXISTS (
       SELECT 1
       FROM market_metrics mm
       WHERE mm.symbol = tu.symbol
     )`,
    [],
    { timeoutMs: 15000, label: 'engines.universeBuilder.mirror_cleanup', maxRetries: 0 }
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
