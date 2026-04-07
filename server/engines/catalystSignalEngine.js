const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { logSignalsForBacktest } = require('../services/backtestLogger');
const {
  SIGNAL_THRESHOLDS,
  SIGNAL_SCORING_WEIGHTS,
  SIGNAL_TYPES,
  clamp,
} = require('../config/catalystEngineConfig');
const { promoteSignalIntoUniverse } = require('./catalystDetectionEngine');

function pickSignalType(row) {
  const sentiment = Number(row.sentiment_score || 0);
  if (sentiment > 0.05) return SIGNAL_TYPES.bullish;
  if (sentiment < -0.05) return SIGNAL_TYPES.bearish;
  return SIGNAL_TYPES.watchlist;
}

function trendToScore(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'bullish') return 1;
  if (normalized === 'bearish') return 0;
  return 0.5;
}

function freshnessToScore(minutes) {
  const maxMinutes = Number(SIGNAL_THRESHOLDS.freshness_threshold_minutes || 180);
  const value = Number(minutes || 0);
  if (!Number.isFinite(value) || value < 0) return 0;
  return clamp(1 - (value / maxMinutes), 0, 1);
}

function floatToScore(floatSize) {
  const value = Number(floatSize || 0);
  if (!Number.isFinite(value) || value <= 0) return 0.5;
  return clamp(1 - (Math.log10(value + 1) / 10), 0, 1);
}

function providerToScore(providerCount) {
  const minProvider = Number(SIGNAL_THRESHOLDS.provider_threshold || 1);
  const scale = Math.max(2, minProvider + 3);
  return clamp(Number(providerCount || 0) / scale, 0, 1);
}

function sentimentToScore(sentimentScore) {
  return clamp((Number(sentimentScore || 0) + 1) / 2, 0, 1);
}

function shortInterestToScore(shortInterest) {
  return clamp(Number(shortInterest || 0) / 35, 0, 1);
}

function computeEffectiveConfidence(row) {
  const baseline = 0.12;
  const provider = providerToScore(row.provider_count);
  const freshness = freshnessToScore(row.freshness_minutes);
  const sentiment = sentimentToScore(row.sentiment_score);
  const sector = trendToScore(row.sector_trend);
  const market = trendToScore(row.market_trend);
  const shortInterest = shortInterestToScore(row.short_interest);
  const floatScore = floatToScore(row.float_size);
  const raw = clamp(Number(row.confidence_score || 0), 0, 1);

  return clamp(
    baseline
    + (raw * 0.2)
    + (provider * 0.2)
    + (freshness * 0.2)
    + (sentiment * 0.15)
    + (((sector + market) / 2) * 0.1)
    + (shortInterest * 0.1)
    + (floatScore * 0.05),
    0,
    1
  );
}

function isEligible(row) {
  const confidenceFloor = Number(SIGNAL_THRESHOLDS.confidence_threshold || 0.35);
  const freshnessCeiling = Number(SIGNAL_THRESHOLDS.freshness_threshold_minutes || 180);
  const providerFloor = Number(SIGNAL_THRESHOLDS.provider_threshold || 1);
  const effectiveConfidence = computeEffectiveConfidence(row);

  return effectiveConfidence > confidenceFloor
    && Number(row.freshness_minutes || 0) < freshnessCeiling
    && Number(row.provider_count || 0) >= providerFloor;
}

function computeSignalScore(row) {
  const effectiveConfidence = computeEffectiveConfidence(row);
  const score =
    (providerToScore(row.provider_count) * SIGNAL_SCORING_WEIGHTS.provider_count) +
    (freshnessToScore(row.freshness_minutes) * SIGNAL_SCORING_WEIGHTS.freshness) +
    (sentimentToScore(row.sentiment_score) * SIGNAL_SCORING_WEIGHTS.sentiment) +
    (floatToScore(row.float_size) * SIGNAL_SCORING_WEIGHTS.float_size) +
    (shortInterestToScore(row.short_interest) * SIGNAL_SCORING_WEIGHTS.short_interest) +
    (trendToScore(row.sector_trend) * SIGNAL_SCORING_WEIGHTS.sector_trend) +
    (trendToScore(row.market_trend) * SIGNAL_SCORING_WEIGHTS.market_trend) +
    (effectiveConfidence * SIGNAL_SCORING_WEIGHTS.confidence);

  return Number(score.toFixed(4));
}

async function fetchEligibleRows(limit = 500) {
  const { rows } = await queryWithTimeout(
    `SELECT
       ci.news_id,
       ci.symbol,
       ci.confidence_score,
       ci.freshness_minutes,
       ci.provider_count,
       ci.sentiment_score,
       ci.float_size,
       ci.short_interest,
       ci.sector_trend,
       ci.market_trend
     FROM catalyst_intelligence ci
     WHERE NOT EXISTS (
         SELECT 1 FROM catalyst_signals cs WHERE cs.news_id = ci.news_id
       )
     ORDER BY ci.created_at DESC
     LIMIT $1`,
    [limit],
    { timeoutMs: 10000, label: 'catalyst_signal.fetch_eligible', maxRetries: 1 }
  );

  return rows;
}

async function insertSignal(row) {
  const { rows } = await queryWithTimeout(
    `INSERT INTO catalyst_signals (
       symbol,
       news_id,
       signal_type,
       signal_score,
       created_at
     ) VALUES ($1, $2, $3, $4, NOW())
     RETURNING id`,
    [row.symbol, row.news_id, row.signal_type, row.signal_score],
    { timeoutMs: 7000, label: 'catalyst_signal.insert', maxRetries: 0 }
  );

  await promoteSignalIntoUniverse(row.symbol);

  return rows?.[0]?.id || null;
}

async function hasRecentSignalForSymbol(symbol) {
  const { rows } = await queryWithTimeout(
    `SELECT id
     FROM catalyst_signals
     WHERE symbol = $1
       AND created_at > NOW() - INTERVAL '15 minutes'
     LIMIT 1`,
    [symbol],
    { timeoutMs: 5000, label: 'catalyst_signal.cooldown_lookup', maxRetries: 0 }
  );

  return Boolean(rows?.[0]?.id);
}

async function hasSignalForNewsSymbol(newsId, symbol) {
  const { rows } = await queryWithTimeout(
    `SELECT id
     FROM catalyst_signals
     WHERE news_id = $1
       AND symbol = $2
     LIMIT 1`,
    [newsId, symbol],
    { timeoutMs: 5000, label: 'catalyst_signal.news_symbol_lookup', maxRetries: 0 }
  );

  return Boolean(rows?.[0]?.id);
}

async function runCatalystSignalEngine() {
  try {
    const rows = await fetchEligibleRows();
    const eligibleRows = rows.filter(isEligible);
    const providerFloor = Number(SIGNAL_THRESHOLDS.provider_threshold || 1);
    const fallbackRows = eligibleRows.length === 0
      ? rows
        .filter((row) => Number(row.provider_count || 0) >= providerFloor)
        .sort((a, b) => computeSignalScore(b) - computeSignalScore(a))
        .slice(0, Math.min(25, rows.length))
      : [];
    const rowsToInsert = eligibleRows.length > 0 ? eligibleRows : fallbackRows;

    let inserted = 0;
    let duplicateSignalSkipped = 0;
    let signalsAttempted = 0;
    const insertedSignals = [];
    const attemptedBySymbol = new Map();

    for (const row of rowsToInsert) {
      const symbol = String(row.symbol || '').toUpperCase();
      if (!symbol) continue;

      signalsAttempted += 1;
      const symbolAttempts = (attemptedBySymbol.get(symbol) || 0) + 1;
      attemptedBySymbol.set(symbol, symbolAttempts);

      if (symbolAttempts > 20) {
        logger.warn('[CATALYST_SIGNAL] signal_flood_detected', {
          symbol,
          attempts: symbolAttempts,
        });
      }

      const duplicateByNewsAndSymbol = await hasSignalForNewsSymbol(row.news_id, symbol);
      if (duplicateByNewsAndSymbol) {
        duplicateSignalSkipped += 1;
        logger.info('[CATALYST_SIGNAL] duplicate_signal_skipped', {
          symbol,
          news_id: row.news_id,
          reason: 'news_symbol_dedupe',
        });
        continue;
      }

      const duplicateByCooldown = await hasRecentSignalForSymbol(symbol);
      if (duplicateByCooldown) {
        duplicateSignalSkipped += 1;
        logger.info('[CATALYST_SIGNAL] duplicate_signal_skipped', {
          symbol,
          news_id: row.news_id,
          reason: 'symbol_cooldown_15m',
        });
        continue;
      }

      const payload = {
        symbol,
        news_id: row.news_id,
        signal_type: pickSignalType(row),
        signal_score: computeSignalScore(row),
      };

      await insertSignal(payload);
      insertedSignals.push(payload);
      inserted += 1;
    }

    const backtestLogging = await logSignalsForBacktest(insertedSignals);

    const result = {
      scanned: rows.length,
      eligible: eligibleRows.length,
      fallback_selected: fallbackRows.length,
      fallback_used: eligibleRows.length === 0 && fallbackRows.length > 0,
      inserted,
      signals_attempted: signalsAttempted,
      signals_inserted: inserted,
      duplicate_signal_skipped: duplicateSignalSkipped,
      backtest_logged: Number(backtestLogging?.inserted || 0),
      thresholds: SIGNAL_THRESHOLDS,
    };
    logger.info('[CATALYST_SIGNAL] completed', result);
    return result;
  } catch (error) {
    logger.error('[CATALYST_SIGNAL] failed', { error: error.message });
    throw error;
  }
}

module.exports = {
  runCatalystSignalEngine,
};
