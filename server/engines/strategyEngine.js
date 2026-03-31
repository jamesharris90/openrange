const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { validateAndEnrich } = require('./dataValidationEngine');
const { computeConfidence } = require('./confidenceEngine');

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function scoreSignal(changePercent, relativeVolume, gapPercent) {
  return (changePercent * 2) + (relativeVolume * 5) + (gapPercent * 3);
}

function classifyScore(score) {
  if (score > 120) return 'Class A';
  if (score > 80) return 'Class B';
  if (score > 50) return 'Class C';
  return null;
}

function probabilityFromScore(score) {
  const probability = 50 + (score * 0.4);
  return Math.min(99, Math.max(50, Number(probability.toFixed(2))));
}

function determineStrategy(row) {
  const price = toNumber(row.price);
  const previousClose = toNumber(row.previous_close);
  const changePercent = toNumber(row.change_percent);
  const gapPercent = toNumber(row.gap_percent);
  const relativeVolume = toNumber(row.relative_volume);

  if (changePercent > 6 && relativeVolume > 2) {
    return 'Day 2 Continuation';
  }

  if (relativeVolume > 3 && gapPercent > 4) {
    return 'Short Squeeze';
  }

  if (relativeVolume > 2 && changePercent > 3) {
    return 'ORB Breakout';
  }

  if (gapPercent > 5 && relativeVolume > 2 && previousClose > 0 && price > previousClose) {
    return 'Gap & Go';
  }

  if (changePercent > 2 && relativeVolume > 1.5) {
    return 'VWAP Reclaim';
  }

  return null;
}

async function ensureStrategySignalsTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS strategy_signals (
      symbol TEXT PRIMARY KEY,
      strategy TEXT,
      class TEXT,
      score NUMERIC,
      probability NUMERIC,
      change_percent NUMERIC,
      gap_percent NUMERIC,
      relative_volume NUMERIC,
      volume BIGINT,
      updated_at TIMESTAMPTZ DEFAULT now()
    )`,
    [],
    { timeoutMs: 5000, label: 'engines.strategy.ensure_table', maxRetries: 0 }
  );

  // Clean legacy duplicate/null symbols before enforcing ON CONFLICT uniqueness.
  await queryWithTimeout(
    `DELETE FROM strategy_signals
     WHERE symbol IS NULL OR btrim(symbol) = ''`,
    [],
    { timeoutMs: 5000, label: 'engines.strategy.cleanup_null_symbols', maxRetries: 0 }
  );

  await queryWithTimeout(
    `DELETE FROM strategy_signals t
     USING (
       SELECT ctid,
              ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY updated_at DESC NULLS LAST, ctid DESC) AS rn
       FROM strategy_signals
       WHERE symbol IS NOT NULL AND btrim(symbol) <> ''
     ) d
     WHERE t.ctid = d.ctid
       AND d.rn > 1`,
    [],
    { timeoutMs: 7000, label: 'engines.strategy.dedupe_symbols', maxRetries: 0 }
  );

  try {
    await queryWithTimeout(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_strategy_signals_symbol_unique ON strategy_signals(symbol)',
      [],
      { timeoutMs: 5000, label: 'engines.strategy.ensure_symbol_unique_idx', maxRetries: 0 }
    );
  } catch (error) {
    logger.warn('Unable to enforce strategy_signals symbol uniqueness', { error: error.message });
  }
}

async function ensureTradeSetupsTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS trade_setups (
      symbol TEXT PRIMARY KEY,
      setup_type TEXT,
      score NUMERIC,
      detected_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )`,
    [],
    { timeoutMs: 5000, label: 'engines.strategy.ensure_trade_setups_table', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE trade_setups
       ADD COLUMN IF NOT EXISTS setup_type TEXT,
       ADD COLUMN IF NOT EXISTS score NUMERIC,
       ADD COLUMN IF NOT EXISTS detected_at TIMESTAMPTZ DEFAULT now(),
       ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()`,
    [],
    { timeoutMs: 5000, label: 'engines.strategy.ensure_trade_setups_columns', maxRetries: 0 }
  );

  await queryWithTimeout(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_trade_setups_symbol_unique ON trade_setups(symbol)',
    [],
    { timeoutMs: 5000, label: 'engines.strategy.ensure_trade_setups_unique_idx', maxRetries: 0 }
  );
}

async function runStrategyEngine() {
  if (global.systemBlocked) {
    console.warn('[BLOCKED] strategyEngine skipped — pipeline unhealthy', { reason: global.systemBlockedReason });
    return { inserted: 0, blocked: true };
  }

  const startedAt = Date.now();
  try {
    await ensureStrategySignalsTable();
    await ensureTradeSetupsTable();

    const { rows } = await queryWithTimeout(
    `SELECT
      tu.symbol,
      COALESCE(tu.price, m.price) AS price,
      COALESCE(tu.change_percent, m.change_percent, 0) AS change_percent,
      COALESCE(m.gap_percent, 0) AS gap_percent,
      COALESCE(tu.relative_volume, m.relative_volume, 0) AS relative_volume,
      COALESCE(tu.volume, m.volume, 0) AS volume,
      COALESCE(m.avg_volume_30d, 0) AS avg_volume_30d,
      m.updated_at,
      pc.previous_close
    FROM tradable_universe tu
    LEFT JOIN market_metrics m ON m.symbol = tu.symbol
    LEFT JOIN LATERAL (
      SELECT d.close AS previous_close
      FROM daily_ohlc d
      WHERE d.symbol = tu.symbol
        AND d.date < CURRENT_DATE
      ORDER BY d.date DESC
      LIMIT 1
    ) pc ON TRUE`,
    [],
    { timeoutMs: 15000, label: 'engines.strategy.select', maxRetries: 0 }
  );

    let classified = 0;

    for (const row of rows) {
    const strategy = determineStrategy(row);
    if (!strategy) continue;

    // Skip disabled strategies + regime-specific filtering (Phase 2/3)
    try {
      const { getDisabledStrategies, getRegimeWinRate } = require('./learningEngine');
      if (getDisabledStrategies().has(strategy)) continue;

      const { getCurrentRegime } = require('../services/marketRegimeEngine');
      const regime = getCurrentRegime();
      if (regime?.trend) {
        const regimeWr = getRegimeWinRate(strategy, regime.trend);
        if (regimeWr !== null && regimeWr < 0.30) continue;
      }
    } catch { /* learningEngine or regimeEngine not yet loaded */ }

    // Data validation — cross-check with FMP before scoring
    const validated = await validateAndEnrich(row, 'strategyEngine');
    if (!validated.valid) {
      logger.warn(`[DATA REJECTED] ${row.symbol} reason=${validated.issues.join(',')}`);
      continue;
    }

    const changePercent = toNumber(row.change_percent);
    const gapPercent = toNumber(row.gap_percent);
    const relativeVolume = toNumber(row.relative_volume);
    const volume = toNumber(row.volume);
    const score = scoreSignal(changePercent, relativeVolume, gapPercent);
    const className = classifyScore(score);

    if (!className) continue;

    const confidenceResult = await computeConfidence({
      setup_type:        strategy,
      validation_issues: [],
    });
    const confidence = confidenceResult.value;

      await queryWithTimeout(
      `INSERT INTO strategy_signals (
        symbol,
        strategy,
        class,
        score,
        probability,
        change_percent,
        gap_percent,
        relative_volume,
        volume,
        confidence,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
      ON CONFLICT (symbol)
      DO UPDATE SET
        strategy = EXCLUDED.strategy,
        class = EXCLUDED.class,
        score = EXCLUDED.score,
        probability = EXCLUDED.probability,
        change_percent = EXCLUDED.change_percent,
        gap_percent = EXCLUDED.gap_percent,
        relative_volume = EXCLUDED.relative_volume,
        volume = EXCLUDED.volume,
        confidence = EXCLUDED.confidence,
        updated_at = now()`,
      [
        row.symbol,
        strategy,
        className,
        score,
        probabilityFromScore(score),
        changePercent,
        gapPercent,
        relativeVolume,
        volume,
        confidence,
      ],
      { timeoutMs: 5000, label: 'engines.strategy.upsert', maxRetries: 0 }
    );

      await queryWithTimeout(
      `INSERT INTO trade_setups (
        symbol,
        setup_type,
        score,
        detected_at,
        updated_at
      ) VALUES ($1, $2, $3, now(), now())
      ON CONFLICT (symbol)
      DO UPDATE SET
        setup_type = EXCLUDED.setup_type,
        score = EXCLUDED.score,
        detected_at = now(),
        updated_at = now()`,
      [
        row.symbol,
        strategy,
        score,
      ],
      { timeoutMs: 5000, label: 'engines.strategy.trade_setups_upsert', maxRetries: 0 }
    );

      classified += 1;
    }

    const runtimeMs = Date.now() - startedAt;
    logger.info('Strategy engine complete', {
      universeSymbols: rows.length,
      classified,
      runtimeMs,
    });
    console.log('[ENGINE]', {
      setupsGenerated: classified,
      timestamp: new Date(),
    });
    console.log('[SIGNALS GENERATED]', {
      count: classified,
      latest: new Date().toISOString(),
    });

    return {
      universeSymbols: rows.length,
      classified,
      runtimeMs,
    };
  } catch (error) {
    const runtimeMs = Date.now() - startedAt;
    logger.error('Strategy engine failed', { error: error.message, runtimeMs });
    return {
      universeSymbols: 0,
      classified: 0,
      runtimeMs,
      error: error.message,
    };
  }
}

module.exports = {
  runStrategyEngine,
  ensureStrategySignalsTable,
};
