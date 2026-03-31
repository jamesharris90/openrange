const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { validateAndEnrich } = require('./dataValidationEngine');
const { computeConfidence } = require('./confidenceEngine');

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
      COALESCE(m.avg_volume_30d, 0)                 AS avg_volume_30d,
      m.updated_at,
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

  let skippedValidation = 0;
  for (const row of rows) {
    // Data validation — reject bad data before writing to opportunities
    const validated = await validateAndEnrich(row, 'opportunityEngine');
    if (!validated.valid) {
      logger.warn(`[DATA REJECTED] ${row.symbol} reason=${validated.issues.join(',')}`);
      skippedValidation++;
      continue;
    }

    const strategy = deriveStrategy(row);

    // Skip disabled strategies + regime-specific filtering (Phase 2/3)
    try {
      const { getDisabledStrategies, getRegimeWinRate } = require('./learningEngine');
      if (strategy && getDisabledStrategies().has(strategy)) { skippedValidation++; continue; }

      if (strategy) {
        const { getCurrentRegime } = require('../services/marketRegimeEngine');
        const regime = getCurrentRegime();
        if (regime?.trend) {
          const regimeWr = getRegimeWinRate(strategy, regime.trend);
          if (regimeWr !== null && regimeWr < 0.30) { skippedValidation++; continue; }
        }
      }
    } catch { /* learningEngine or regimeEngine not yet loaded */ }

    const confidenceResult = await computeConfidence({
      setup_type:        strategy,
      validation_issues: validated.issues || [],
    });
    const confidence = confidenceResult.value;

    await queryWithTimeout(
      `INSERT INTO opportunities_v2 (
        symbol,
        score,
        change_percent,
        relative_volume,
        gap_percent,
        strategy,
        volume,
        confidence,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
      ON CONFLICT (symbol)
      DO UPDATE SET
        score = EXCLUDED.score,
        change_percent = EXCLUDED.change_percent,
        relative_volume = EXCLUDED.relative_volume,
        gap_percent = EXCLUDED.gap_percent,
        strategy = EXCLUDED.strategy,
        volume = EXCLUDED.volume,
        confidence = EXCLUDED.confidence,
        updated_at = now()`,
      [
        row.symbol,
        row.score,
        row.change_percent,
        row.relative_volume,
        row.gap_percent,
        strategy,
        row.volume,
        confidence,
      ],
      { timeoutMs: 5000, label: 'engines.opportunityEngine.upsert', maxRetries: 0 }
    );
  }

  const runtimeMs = Date.now() - startedAt;
  logger.info('Opportunity engine complete', { opportunities: rows.length - skippedValidation, skippedValidation, runtimeMs });
  return { opportunities: rows.length - skippedValidation, skippedValidation, runtimeMs };
}

module.exports = {
  runOpportunityEngine,
};
