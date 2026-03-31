'use strict';

const logger = require('../logger');
const db = require('../db');

// ── Hard minimums — anything below these is noise, not signal ────────────────
const MIN_RELATIVE_VOLUME  = 2.0;
const MIN_VOLUME           = 1_000_000;
const MIN_ABS_CHANGE_PCT   = 5.0;
const MIN_PRICE            = 1.0;

// ── Duplicate suppression window: 2 hours keeps 10–30 signals/day ───────────
const DUPLICATE_WINDOW_MINUTES = 120;

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Cap inputs so a 10,000% short-squeeze can't blow up the score
function cap(value, max) {
  return Math.min(Math.abs(value), max);
}

// Phase 3 scoring formula
// score = (rvol * 5) + (|chg| * 3) + (volume > 5M ? 5 : 0)
// A: > 120  B: > 80  — everything else is discarded
function scoreSignal(relativeVolume, changePercent, volume) {
  const rvol = cap(relativeVolume, 30);
  const chg  = cap(changePercent,  50);
  const volBonus = volume > 5_000_000 ? 5 : 0;
  return (rvol * 5) + (chg * 3) + volBonus;
}

function classifyScore(score) {
  if (score > 120) return 'A';
  if (score > 80)  return 'B';
  return null; // discard C and below
}

// Phase 5 — deterministic strategy name based on tightened criteria
// Priority order: most-specific first
function determineStrategy(row) {
  const price          = toNumber(row.price);
  const changePercent  = toNumber(row.change_percent);
  const gapPercent     = toNumber(row.gap_percent);
  const relativeVolume = toNumber(row.relative_volume);
  const previousClose  = toNumber(row.previous_close);

  if (gapPercent > 10 && relativeVolume > 5 && price > previousClose && previousClose > 0)
    return 'Gap & Go';

  if (relativeVolume > 5 && gapPercent > 5)
    return 'Short Squeeze';

  if (changePercent > 6 && relativeVolume > 3)
    return 'Day 2 Continuation';

  if (gapPercent > 5 && relativeVolume >= 2 && price > previousClose && previousClose > 0)
    return 'Gap & Go';

  if (changePercent > 5 && relativeVolume >= 2)
    return 'ORB Breakout';

  return null; // strict: no fallback for marginal setups
}

async function hasRecentDuplicate(symbol, strategy) {
  const result = await db.query(
    `SELECT 1 FROM strategy_signals
     WHERE symbol = $1 AND strategy = $2
       AND updated_at >= NOW() - INTERVAL '${DUPLICATE_WINDOW_MINUTES} minutes'
     LIMIT 1`,
    [symbol, strategy]
  );
  return result.rows.length > 0;
}

async function runStrategySignalEngine() {
  if (global.systemBlocked) {
    logger.warn('[BLOCKED] strategySignalEngine skipped — pipeline unhealthy', { reason: global.systemBlockedReason });
    return { universeSymbols: 0, inserted: 0, skippedFilter: 0, skippedScore: 0, skippedDuplicate: 0, blocked: true };
  }

  const startedAt = Date.now();
  logger.info('[SIGNAL ENGINE] scanning market metrics...');

  const { rows } = await db.query(
    `SELECT
       tu.symbol,
       COALESCE(tu.price, m.price)                        AS price,
       COALESCE(tu.change_percent, m.change_percent, 0)   AS change_percent,
       COALESCE(m.gap_percent, 0)                         AS gap_percent,
       COALESCE(tu.relative_volume, m.relative_volume, 0) AS relative_volume,
       COALESCE(tu.volume, m.volume, 0)                   AS volume,
       pc.previous_close
     FROM tradable_universe tu
     LEFT JOIN market_metrics m  ON m.symbol = tu.symbol
     LEFT JOIN LATERAL (
       SELECT d.close AS previous_close
       FROM daily_ohlc d
       WHERE d.symbol = tu.symbol AND d.date < CURRENT_DATE
       ORDER BY d.date DESC LIMIT 1
     ) pc ON TRUE`,
    []
  );

  logger.info(`[SIGNAL ENGINE] ${rows.length} symbols loaded`);

  let inserted = 0;
  let skippedFilter = 0;
  let skippedScore = 0;
  let skippedDuplicate = 0;

  for (const row of rows) {
    const price          = toNumber(row.price);
    const changePercent  = toNumber(row.change_percent);
    const relativeVolume = toNumber(row.relative_volume);
    const volume         = toNumber(row.volume);

    // Phase 2 — hard minimums
    if (price < MIN_PRICE)                        { skippedFilter++; continue; }
    if (relativeVolume < MIN_RELATIVE_VOLUME)      { skippedFilter++; continue; }
    if (volume < MIN_VOLUME)                       { skippedFilter++; continue; }
    if (Math.abs(changePercent) < MIN_ABS_CHANGE_PCT) { skippedFilter++; continue; }

    const strategy = determineStrategy(row);
    if (!strategy) { skippedFilter++; continue; }

    // Phase 3 — quality score
    const score     = scoreSignal(relativeVolume, changePercent, volume);
    const className = classifyScore(score);
    if (!className) { skippedScore++; continue; }

    const duplicate = await hasRecentDuplicate(row.symbol, strategy);
    if (duplicate) { skippedDuplicate++; continue; }

    // probability: normalise score to 0–100 band (score of 200 → 0.99)
    const probability = Math.min(score / 200, 0.99);

    try {
      await db.query(
        `INSERT INTO strategy_signals
           (symbol, strategy, class, score, probability,
            change_percent, gap_percent, relative_volume, volume, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
        [
          row.symbol,
          strategy,
          className,
          score,
          probability,
          changePercent,
          toNumber(row.gap_percent),
          relativeVolume,
          volume,
        ]
      );
      logger.info(`[SIGNAL CREATED] ${row.symbol} ${strategy} class=${className} score=${score.toFixed(1)}`);
      inserted++;
    } catch (error) {
      logger.warn('Strategy signal insert skipped', { symbol: row.symbol, strategy, error: error.message });
    }
  }

  const runtimeMs = Date.now() - startedAt;
  logger.info('Strategy signal engine complete', {
    universeSymbols: rows.length,
    inserted,
    skippedFilter,
    skippedScore,
    skippedDuplicate,
    runtimeMs,
  });

  return { universeSymbols: rows.length, inserted, skippedFilter, skippedScore, skippedDuplicate, runtimeMs };
}

module.exports = { runStrategySignalEngine };
