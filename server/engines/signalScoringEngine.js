const { queryWithTimeout } = require('../db/pg');
const { runLiquiditySurgeEngine, computeLiquiditySurge } = require('./liquiditySurgeEngine');
const { runFloatRotationEngine } = require('./floatRotationEngine');
const { runSignalConfirmationEngine } = require('./signalConfirmationEngine');
const { generateSignalStrengthNarrative, generateSignalScoreExplanation } = require('../services/mcpClient');

const DEFAULT_CALIBRATION_WEIGHTS = {
  gap_percent: 1,
  rvol: 1,
  float_rotation: 1,
  liquidity_surge: 1,
  catalyst_score: 1,
  sector_score: 1,
  confirmation_score: 1,
};

let calibrationCache = {
  ts: 0,
  weights: DEFAULT_CALIBRATION_WEIGHTS,
};

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function confidenceFromScore(score) {
  if (score > 120) return 'A+';
  if (score > 100) return 'A';
  if (score > 85) return 'B';
  if (score > 70) return 'C';
  return 'D';
}

function evaluateLiquidityQuality(row = {}) {
  const price = toNumber(row.price);
  const relativeVolume = toNumber(row.relative_volume);
  const volume = toNumber(row.volume);
  const avgVolume30d = toNumber(row.avg_volume_30d);
  const floatShares = toNumber(row.float_shares);

  const intradayDollarVolume = price * volume;
  const avgDollarVolume = price * avgVolume30d;

  const checks = {
    min_price: price >= 1,
    min_relative_volume: relativeVolume >= 1.25,
    min_intraday_dollar_volume: intradayDollarVolume >= 1000000,
    min_avg_dollar_volume: avgDollarVolume >= 3000000,
    valid_float_shares: floatShares <= 0 || floatShares >= 1000000,
  };

  const passed = Object.values(checks).every(Boolean);

  return {
    passed,
    checks,
    price: Number(price.toFixed(4)),
    relative_volume: Number(relativeVolume.toFixed(4)),
    intraday_dollar_volume: Number(intradayDollarVolume.toFixed(2)),
    avg_dollar_volume: Number(avgDollarVolume.toFixed(2)),
    float_shares: Number(floatShares.toFixed(0)),
  };
}

async function ensureTradeSignalsScoringColumns() {
  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS confidence TEXT',
    [],
    { timeoutMs: 7000, label: 'signal_scoring.ensure_confidence', maxRetries: 0 }
  );

  await queryWithTimeout(
    "ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb",
    [],
    { timeoutMs: 7000, label: 'signal_scoring.ensure_breakdown', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS narrative TEXT',
    [],
    { timeoutMs: 7000, label: 'signal_scoring.ensure_narrative', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS float_rotation NUMERIC',
    [],
    { timeoutMs: 7000, label: 'signal_scoring.ensure_float_rotation', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS liquidity_surge NUMERIC',
    [],
    { timeoutMs: 7000, label: 'signal_scoring.ensure_liquidity_surge', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS catalyst_score NUMERIC',
    [],
    { timeoutMs: 7000, label: 'signal_scoring.ensure_catalyst_score', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS sector_score NUMERIC',
    [],
    { timeoutMs: 7000, label: 'signal_scoring.ensure_sector_score', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS confirmation_score NUMERIC',
    [],
    { timeoutMs: 7000, label: 'signal_scoring.ensure_confirmation_score', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS signal_explanation TEXT',
    [],
    { timeoutMs: 7000, label: 'signal_scoring.ensure_signal_explanation', maxRetries: 0 }
  );
}

async function getSignalCalibrationWeights() {
  const now = Date.now();
  if (now - calibrationCache.ts < 5 * 60 * 1000) {
    return calibrationCache.weights;
  }

  try {
    await queryWithTimeout(
      `CREATE TABLE IF NOT EXISTS signal_weight_calibration (
        component TEXT PRIMARY KEY,
        weight NUMERIC NOT NULL,
        success_rate NUMERIC NOT NULL,
        avg_move NUMERIC NOT NULL,
        signals_analyzed INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      [],
      { timeoutMs: 7000, label: 'signal_scoring.ensure_weight_calibration', maxRetries: 0 }
    );

    const { rows } = await queryWithTimeout(
      `SELECT component, weight
       FROM signal_weight_calibration`,
      [],
      { timeoutMs: 5000, label: 'signal_scoring.load_calibration_weights', maxRetries: 0 }
    );

    const loaded = { ...DEFAULT_CALIBRATION_WEIGHTS };
    for (const row of rows) {
      const component = String(row.component || '').trim();
      if (!Object.prototype.hasOwnProperty.call(loaded, component)) {
        continue;
      }
      loaded[component] = toNumber(row.weight, 1);
    }

    calibrationCache = {
      ts: now,
      weights: loaded,
    };

    return loaded;
  } catch (_) {
    calibrationCache = {
      ts: now,
      weights: DEFAULT_CALIBRATION_WEIGHTS,
    };
    return DEFAULT_CALIBRATION_WEIGHTS;
  }
}

async function getOrderFlowBoost(symbol) {
  const normalized = String(symbol || '').toUpperCase().trim();
  if (!normalized) return { order_flow_score: 0, pressure_level: null, pressure_score: 0 };

  const { rows } = await queryWithTimeout(
    `SELECT pressure_level, pressure_score
     FROM order_flow_signals
     WHERE symbol = $1
     ORDER BY detected_at DESC NULLS LAST
     LIMIT 1`,
    [normalized],
    { timeoutMs: 5000, label: 'signal_scoring.order_flow_boost', maxRetries: 0 }
  );

  const pressureLevel = String(rows[0]?.pressure_level || '').toUpperCase();
  const boost = pressureLevel === 'STRONG' ? 20 : 0;
  return {
    order_flow_score: boost,
    pressure_level: pressureLevel || null,
    pressure_score: toNumber(rows[0]?.pressure_score),
  };
}

async function getSectorMomentumBoost(sector) {
  const normalized = String(sector || '').trim();
  if (!normalized) return { sector_momentum_score: 0, momentum_score: 0 };

  const { rows } = await queryWithTimeout(
    `SELECT momentum_score
     FROM sector_momentum
     WHERE sector = $1
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 1`,
    [normalized],
    { timeoutMs: 5000, label: 'signal_scoring.sector_momentum_boost', maxRetries: 0 }
  );

  const momentum = toNumber(rows[0]?.momentum_score);
  return {
    sector_momentum_score: momentum > 12 ? 15 : 0,
    momentum_score: momentum,
  };
}

async function scoreSignal(row = {}, extras = {}) {
  if (!extras.skipEnsure) {
    await ensureTradeSignalsScoringColumns();
  }

  const gapPercent = toNumber(row.gap_percent);
  const relativeVolume = toNumber(row.relative_volume);
  const catalystImpact = toNumber(row.catalyst_impact_8h);
  const sectorStrength = toNumber(row.sector_strength);
  const liquidityQuality = evaluateLiquidityQuality(row);
  const weights = await getSignalCalibrationWeights();

  if (!liquidityQuality.passed) {
    return null;
  }

  const gapScore = Math.min(35, Math.max(0, Math.abs(gapPercent) * 5));
  const rvolScore = Math.min(28, Math.max(0, relativeVolume * 7));

  const floatRotation = runFloatRotationEngine(row);
  const liquiditySurge = extras.fastMode ? computeLiquiditySurge(row) : await runLiquiditySurgeEngine(row);

  let orderFlowBoost;
  if (extras.orderFlowBoost) {
    orderFlowBoost = extras.orderFlowBoost;
  } else if (extras.fastMode) {
    orderFlowBoost = {
      order_flow_score: String(row.order_flow_level || '').toUpperCase() === 'STRONG' ? 20 : 0,
      pressure_level: String(row.order_flow_level || '').toUpperCase() || null,
      pressure_score: toNumber(row.order_flow_pressure),
    };
  } else {
    orderFlowBoost = await getOrderFlowBoost(row.symbol);
  }

  let sectorMomentumBoost;
  if (extras.sectorMomentumBoost) {
    sectorMomentumBoost = extras.sectorMomentumBoost;
  } else if (extras.fastMode) {
    const momentum = toNumber(row.sector_momentum_score);
    sectorMomentumBoost = {
      sector_momentum_score: momentum > 12 ? 15 : 0,
      momentum_score: momentum,
    };
  } else {
    sectorMomentumBoost = await getSectorMomentumBoost(row.sector);
  }
  const confirmation = runSignalConfirmationEngine(row);

  const catalystScore = Math.min(18, Math.max(0, catalystImpact * 2));
  const sectorScore = sectorStrength > 0 ? Math.min(9, sectorStrength * 3) : 0;

  const weightedCoreScore = (gapScore * toNumber(weights.gap_percent, 1))
    + (rvolScore * toNumber(weights.rvol, 1))
    + (toNumber(floatRotation.score_contribution) * toNumber(weights.float_rotation, 1))
    + (toNumber(liquiditySurge.score_contribution) * toNumber(weights.liquidity_surge, 1))
    + (catalystScore * toNumber(weights.catalyst_score, 1))
    + (sectorScore * toNumber(weights.sector_score, 1))
    + (toNumber(confirmation.confirmation_score) * toNumber(weights.confirmation_score, 1));

  const totalScore = weightedCoreScore
    + toNumber(orderFlowBoost.order_flow_score)
    + toNumber(sectorMomentumBoost.sector_momentum_score);

  const scoreBreakdown = {
    gap_score: Number(gapScore.toFixed(2)),
    rvol_score: Number(rvolScore.toFixed(2)),
    float_rotation_score: Number(toNumber(floatRotation.score_contribution).toFixed(2)),
    liquidity_surge_score: Number(toNumber(liquiditySurge.score_contribution).toFixed(2)),
    catalyst_score: Number(catalystScore.toFixed(2)),
    sector_score: Number(sectorScore.toFixed(2)),
    confirmation_score: Number(toNumber(confirmation.confirmation_score).toFixed(2)),
    order_flow_score: Number(toNumber(orderFlowBoost.order_flow_score).toFixed(2)),
    sector_momentum_score: Number(toNumber(sectorMomentumBoost.sector_momentum_score).toFixed(2)),
    calibration_weights: weights,
    liquidity_quality: liquidityQuality,
    total_score: Number(totalScore.toFixed(2)),
  };

  const confidence = confidenceFromScore(totalScore);

  const symbol = String(row.symbol || '').toUpperCase();
  const strategy = extras.strategy || row.strategy || 'Setup';
  const shouldUseMcp = !extras.skipMcp && (!extras.fastMode || totalScore >= 85);

  const fallbackNarrative = `${symbol} ${strategy}: score strength is supported by momentum, liquidity, and confirmation factors.`;
  const fallbackExplanation = `${symbol}: elevated score reflects gap/volume structure, catalyst context, and sector/order-flow alignment. Monitor continuation quality and VWAP behavior.`;

  const narrative = shouldUseMcp
    ? await generateSignalStrengthNarrative({
      symbol,
      strategy,
      score_breakdown: scoreBreakdown,
      catalyst_headline: row.catalyst_headline || null,
      catalyst_type: row.catalyst_type || null,
      sector: row.sector || null,
    })
    : fallbackNarrative;

  const signalExplanation = shouldUseMcp
    ? await generateSignalScoreExplanation({
      symbol,
      strategy,
      score_breakdown: scoreBreakdown,
      catalyst_headline: row.catalyst_headline || null,
      catalyst_type: row.catalyst_type || null,
      sector: row.sector || null,
      momentum_score: sectorMomentumBoost.momentum_score,
      order_flow_pressure: orderFlowBoost.pressure_score,
      order_flow_level: orderFlowBoost.pressure_level,
    })
    : fallbackExplanation;

  return {
    total_score: totalScore,
    confidence,
    score_breakdown: scoreBreakdown,
    narrative,
    signal_explanation: signalExplanation,
  };
}

module.exports = {
  scoreSignal,
  ensureTradeSignalsScoringColumns,
  confidenceFromScore,
  getSignalCalibrationWeights,
};
