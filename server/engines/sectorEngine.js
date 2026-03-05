const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

async function ensureSectorTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS sector_heatmap (
      sector TEXT PRIMARY KEY,
      avg_change NUMERIC,
      total_volume BIGINT,
      stocks INTEGER,
      leaders JSONB,
      updated_at TIMESTAMPTZ DEFAULT now()
    )`,
    [],
    { timeoutMs: 5000, label: 'engines.sectorEngine.ensure_table', maxRetries: 0 }
  );
}

async function runSectorEngine() {
  const startedAt = Date.now();
  await ensureSectorTable();

  const { rows } = await queryWithTimeout(
    `WITH base AS (
      SELECT
        COALESCE(q.sector, 'Unknown') AS sector,
        m.symbol,
        COALESCE(m.change_percent, q.change_percent, 0) AS change_percent,
        COALESCE(m.volume, q.volume, 0) AS volume
      FROM market_metrics m
      LEFT JOIN market_quotes q ON q.symbol = m.symbol
    ),
    ranked AS (
      SELECT
        sector,
        symbol,
        change_percent,
        volume,
        ROW_NUMBER() OVER (PARTITION BY sector ORDER BY change_percent DESC NULLS LAST) AS rank_in_sector
      FROM base
    )
    SELECT
      sector,
      AVG(change_percent)::numeric AS avg_change,
      SUM(volume)::bigint AS total_volume,
      COUNT(symbol)::int AS stocks,
      COALESCE(
        jsonb_agg(
          jsonb_build_object('symbol', symbol, 'change_percent', change_percent)
          ORDER BY change_percent DESC
        ) FILTER (WHERE rank_in_sector <= 2),
        '[]'::jsonb
      ) AS leaders
    FROM ranked
    GROUP BY sector
    ORDER BY avg_change DESC`,
    [],
    { timeoutMs: 10000, label: 'engines.sectorEngine.select', maxRetries: 0 }
  );

  for (const row of rows) {
    await queryWithTimeout(
      `INSERT INTO sector_heatmap (sector, avg_change, total_volume, stocks, leaders, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, now())
       ON CONFLICT (sector)
       DO UPDATE SET
         avg_change = EXCLUDED.avg_change,
         total_volume = EXCLUDED.total_volume,
         stocks = EXCLUDED.stocks,
         leaders = EXCLUDED.leaders,
         updated_at = now()`,
      [row.sector, row.avg_change, row.total_volume, row.stocks, JSON.stringify(row.leaders || [])],
      { timeoutMs: 5000, label: 'engines.sectorEngine.upsert', maxRetries: 0 }
    );
  }

  const runtimeMs = Date.now() - startedAt;
  logger.info('Sector engine complete', { sectors: rows.length, runtimeMs });
  return { sectors: rows.length, runtimeMs };
}

module.exports = {
  runSectorEngine,
};
