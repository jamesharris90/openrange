const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

async function ensureSectorMomentumTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS sector_momentum (
      sector TEXT PRIMARY KEY,
      momentum_score NUMERIC,
      avg_gap NUMERIC,
      avg_rvol NUMERIC,
      top_symbol TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'engines.sector_momentum.ensure_table', maxRetries: 0 }
  );
}

async function runSectorMomentumEngine() {
  const startedAt = Date.now();
  try {
    await ensureSectorMomentumTable();

    const { rows } = await queryWithTimeout(
    `WITH catalyst_scores AS (
       SELECT
         symbol,
         MAX(COALESCE(impact_score, 0)) AS catalyst_score
       FROM news_catalysts
       WHERE published_at > NOW() - interval '48 hours'
       GROUP BY symbol
     ),
     sector_base AS (
       SELECT
         COALESCE(q.sector, 'Unknown') AS sector,
         m.symbol,
         COALESCE(m.relative_volume, 0) AS relative_volume,
         COALESCE(m.gap_percent, 0) AS gap_percent,
         COALESCE(c.catalyst_score, 0) AS catalyst_score,
         (COALESCE(m.relative_volume, 0) * COALESCE(m.gap_percent, 0) * GREATEST(COALESCE(c.catalyst_score, 0), 0.1)) AS momentum_component
       FROM market_metrics m
       LEFT JOIN market_quotes q ON q.symbol = m.symbol
       LEFT JOIN catalyst_scores c ON c.symbol = m.symbol
       WHERE m.symbol IS NOT NULL
         AND m.symbol <> ''
     ),
     sector_rank AS (
       SELECT
         sector,
         AVG(momentum_component) AS momentum_score,
         AVG(gap_percent) AS avg_gap,
         AVG(relative_volume) AS avg_rvol
       FROM sector_base
       GROUP BY sector
     ),
     top_symbol AS (
       SELECT DISTINCT ON (sector)
         sector,
         symbol AS top_symbol
       FROM sector_base
       ORDER BY sector, momentum_component DESC NULLS LAST
     )
     SELECT
       sr.sector,
       sr.momentum_score,
       sr.avg_gap,
       sr.avg_rvol,
       ts.top_symbol
     FROM sector_rank sr
     LEFT JOIN top_symbol ts ON ts.sector = sr.sector
     ORDER BY sr.momentum_score DESC NULLS LAST`,
    [],
    { timeoutMs: 12000, label: 'engines.sector_momentum.compute', maxRetries: 0 }
  );

    let updated = 0;
    for (const row of rows) {
    await queryWithTimeout(
      `INSERT INTO sector_momentum (
         sector,
         momentum_score,
         avg_gap,
         avg_rvol,
         top_symbol,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (sector)
       DO UPDATE SET
         momentum_score = EXCLUDED.momentum_score,
         avg_gap = EXCLUDED.avg_gap,
         avg_rvol = EXCLUDED.avg_rvol,
         top_symbol = EXCLUDED.top_symbol,
         updated_at = NOW()`,
      [
        row.sector,
        row.momentum_score,
        row.avg_gap,
        row.avg_rvol,
        row.top_symbol,
      ],
      { timeoutMs: 7000, label: 'engines.sector_momentum.upsert', maxRetries: 0 }
    );
    updated += 1;
  }

    const runtimeMs = Date.now() - startedAt;
    const result = { updated, runtimeMs };
    logger.info('[SECTOR_MOMENTUM] run complete', result);
    return result;
  } catch (error) {
    const runtimeMs = Date.now() - startedAt;
    logger.error('[SECTOR_MOMENTUM] run failed', { error: error.message, runtimeMs });
    return { updated: 0, runtimeMs, error: error.message };
  }
}

module.exports = {
  runSectorMomentumEngine,
  ensureSectorMomentumTable,
};
