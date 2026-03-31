const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { validateAndEnrich } = require('./dataValidationEngine');
const { computeConfidence } = require('./confidenceEngine');
const { computeExecutionPlan } = require('./executionEngine');

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
      COALESCE(m.atr, 0)                            AS atr,
      COALESCE(m.vwap, 0)                           AS vwap,
      COALESCE(m.previous_high, 0)                  AS previous_high,
      COALESCE(tu.price, m.price, 0)                AS price,
      m.updated_at,
      pc.previous_close,
      ((COALESCE(tu.change_percent, 0) * 2)
      + (COALESCE(tu.relative_volume, 0) * 5)
      + (COALESCE(m.gap_percent, tu.change_percent, 0) * 3)) AS score
     FROM tradable_universe tu
     LEFT JOIN market_metrics m ON m.symbol = tu.symbol
     LEFT JOIN LATERAL (
       SELECT d.close AS previous_close
       FROM daily_ohlc d
       WHERE d.symbol = tu.symbol AND d.date < CURRENT_DATE
       ORDER BY d.date DESC LIMIT 1
     ) pc ON TRUE
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

    let currentRegimeTrend = null;
    try {
      const { getCurrentRegime } = require('../services/marketRegimeEngine');
      currentRegimeTrend = getCurrentRegime()?.trend ?? null;
    } catch { /* regime not loaded */ }

    let marketContext = null;
    try {
      const { computeMarketContext } = require('./marketContextEngine');
      marketContext = await computeMarketContext(row.symbol, {
        price: Number(row.price || 0),
        vwap:  Number(row.vwap  || 0),
      });
    } catch { /* proceed without context */ }

    const execPlan = computeExecutionPlan({
      price:          Number(row.price           || 0),
      atr:            Number(row.atr             || 0),
      volume:         Number(row.volume          || 0),
      relativeVolume: Number(row.relative_volume || 0),
      changePercent:  Number(row.change_percent  || 0),
      gapPercent:     Number(row.gap_percent     || 0),
      confidence,
      strategy,
      previousHigh:   Number(row.previous_high  || 0),
      vwap:           Number(row.vwap            || 0),
      previousClose:  Number(row.previous_close  || 0),
      regime:         currentRegimeTrend,
      marketContext,
    });

    await queryWithTimeout(
      `INSERT INTO opportunities_v2 (
        symbol, score, change_percent, relative_volume, gap_percent,
        strategy, volume, confidence,
        entry_price, stop_loss, target_price, position_size,
        risk_reward, trade_quality_score, execution_ready,
        why_moving, why_tradeable, how_to_trade,
        lifecycle_stage, entry_type, exit_type,
        vwap_relation, volume_trend, market_structure, time_context,
        updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,now())
      ON CONFLICT (symbol)
      DO UPDATE SET
        score = EXCLUDED.score,
        change_percent = EXCLUDED.change_percent,
        relative_volume = EXCLUDED.relative_volume,
        gap_percent = EXCLUDED.gap_percent,
        strategy = EXCLUDED.strategy,
        volume = EXCLUDED.volume,
        confidence = EXCLUDED.confidence,
        entry_price = EXCLUDED.entry_price,
        stop_loss = EXCLUDED.stop_loss,
        target_price = EXCLUDED.target_price,
        position_size = EXCLUDED.position_size,
        risk_reward = EXCLUDED.risk_reward,
        trade_quality_score = EXCLUDED.trade_quality_score,
        execution_ready = EXCLUDED.execution_ready,
        why_moving = EXCLUDED.why_moving,
        why_tradeable = EXCLUDED.why_tradeable,
        how_to_trade = EXCLUDED.how_to_trade,
        lifecycle_stage = EXCLUDED.lifecycle_stage,
        entry_type = EXCLUDED.entry_type,
        exit_type = EXCLUDED.exit_type,
        vwap_relation = EXCLUDED.vwap_relation,
        volume_trend = EXCLUDED.volume_trend,
        market_structure = EXCLUDED.market_structure,
        time_context = EXCLUDED.time_context,
        updated_at = now()`,
      [
        row.symbol, row.score, row.change_percent, row.relative_volume,
        row.gap_percent, strategy, row.volume, confidence,
        execPlan.entry_price, execPlan.stop_loss, execPlan.target_price,
        execPlan.position_size, execPlan.risk_reward,
        execPlan.trade_quality_score, execPlan.execution_ready,
        execPlan.why_moving, execPlan.why_tradeable, execPlan.how_to_trade,
        execPlan.lifecycle_stage, execPlan.entry_type, execPlan.exit_type,
        execPlan.vwap_relation, execPlan.volume_trend,
        execPlan.market_structure, execPlan.time_context,
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
