const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

async function ensureOpportunityTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS opportunities_v2 (
      symbol TEXT PRIMARY KEY,
      score NUMERIC,
      change_percent NUMERIC,
      relative_volume NUMERIC,
      gap_percent NUMERIC,
      strategy TEXT,
      volume BIGINT,
      updated_at TIMESTAMPTZ DEFAULT now()
    )`,
    [],
    { timeoutMs: 5000, label: 'engines.opportunityEngine.ensure_table', maxRetries: 0 }
  );
}

function deriveStrategy(row) {
  const gapPercent = Number(row.gap_percent || 0);
  const changePercent = Number(row.change_percent || 0);
  const relativeVolume = Number(row.relative_volume || 0);

  if (gapPercent >= 3 && relativeVolume >= 2) return 'Gap & Go';
  if (changePercent >= 2 && relativeVolume >= 1.5) return 'Momentum';
  if (changePercent <= -2 && relativeVolume >= 2) return 'Fade';
  return 'Watchlist';
}

async function runOpportunityEngine() {
  if (global.systemBlocked) {
    console.warn('[BLOCKED] opportunityEngine skipped — pipeline unhealthy', { reason: global.systemBlockedReason });
    return { inserted: 0, blocked: true };
  }

  const startedAt = Date.now();
  await ensureOpportunityTable();

  const { rows } = await queryWithTimeout(
    `SELECT
      tu.symbol,
      tu.change_percent,
      tu.relative_volume,
      tu.volume,
      COALESCE(m.gap_percent, tu.change_percent, 0) AS gap_percent,
      ((COALESCE(tu.change_percent, 0) * 2)
      + (COALESCE(tu.relative_volume, 0) * 5)
      + (COALESCE(m.gap_percent, tu.change_percent, 0) * 3)) AS score
     FROM tradable_universe tu
     LEFT JOIN market_metrics m ON m.symbol = tu.symbol
     ORDER BY score DESC NULLS LAST
     LIMIT 50`,
    [],
    { timeoutMs: 10000, label: 'engines.opportunityEngine.select', maxRetries: 0 }
  );

  for (const row of rows) {
    await queryWithTimeout(
      `INSERT INTO opportunities_v2 (
        symbol,
        score,
        change_percent,
        relative_volume,
        gap_percent,
        strategy,
        volume,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
      ON CONFLICT (symbol)
      DO UPDATE SET
        score = EXCLUDED.score,
        change_percent = EXCLUDED.change_percent,
        relative_volume = EXCLUDED.relative_volume,
        gap_percent = EXCLUDED.gap_percent,
        strategy = EXCLUDED.strategy,
        volume = EXCLUDED.volume,
        updated_at = now()`,
      [
        row.symbol,
        row.score,
        row.change_percent,
        row.relative_volume,
        row.gap_percent,
        deriveStrategy(row),
        row.volume,
      ],
      { timeoutMs: 5000, label: 'engines.opportunityEngine.upsert', maxRetries: 0 }
    );
  }

  const runtimeMs = Date.now() - startedAt;
  logger.info('Opportunity engine complete', { opportunities: rows.length, runtimeMs });
  return { opportunities: rows.length, runtimeMs };
}

module.exports = {
  runOpportunityEngine,
};
