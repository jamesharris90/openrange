'use strict';

/**
 * Execution Engine
 *
 * Runs every 10 minutes AFTER premarketIntelligenceEngine.
 * Converts premarket intelligence into concrete, testable trade plans:
 *   entry_price, stop_price, target_price, risk/reward, position sizing
 *
 * STRICT RULES:
 *   - NO AI-generated numbers
 *   - ALL levels derived from real data (premarket candles + ATR from market_metrics)
 *   - DO NOT overwrite existing valid execution plans unless data has been refreshed
 *   - Degrade cleanly if any critical field is missing
 *
 * Execution types:
 *   BREAKOUT  — GAP_AND_GO: entry above PM high, stop at PM low
 *   FADE      — GAP_FADE:   entry at PM low, stop at PM high
 *   RANGE     — RANGE_BUILD: entry at PM high breakout, stop at range midpoint
 *   NONE      — no valid setup
 *
 * Validity gate (execution_valid = TRUE only if ALL pass):
 *   - premarket_valid = TRUE
 *   - risk_percent <= 5
 *   - risk_reward_ratio >= 1.5
 *   - gap_confidence != 'LOW'
 *
 * Position sizing (Phase 7):
 *   max_risk_per_trade = £10
 *   position_size_shares = max_risk / |entry - stop|
 *   position_size_value  = position_size_shares * entry_price
 */

const { queryWithTimeout } = require('../db/pg');

const ENGINE_LABEL        = '[EXECUTION]';
const MAX_RISK_GBP        = 10;
const INTER_SYMBOL_DELAY  = 150;

// ── Fetch all watchlist rows with required intelligence fields ───────────────

async function fetchWatchlistSymbols() {
  const { rows } = await queryWithTimeout(
    `SELECT
       pw.symbol,
       pw.premarket_signal_type,
       pw.premarket_valid,
       pw.premarket_gap_confidence,
       mm.atr,
       COALESCE(mq.price, pw.price)  AS current_price
     FROM premarket_watchlist pw
     LEFT JOIN market_metrics  mm ON mm.symbol = pw.symbol
     LEFT JOIN market_quotes   mq ON mq.symbol = pw.symbol AND mq.price > 0
     WHERE pw.premarket_signal_type IS NOT NULL
       AND pw.premarket_signal_type != 'UNDEFINED'
       AND pw.premarket_valid = TRUE
     ORDER BY pw.score DESC`,
    [],
    { timeoutMs: 15_000, label: 'exec.watchlist_symbols' }
  );
  return rows;
}

// ── Fetch PM high/low for a symbol from intraday_1m ─────────────────────────

async function fetchPremarketLevels(symbol) {
  const { rows } = await queryWithTimeout(
    `SELECT
       MAX(high)  AS pm_high,
       MIN(low)   AS pm_low,
       MIN(open) FILTER (WHERE "timestamp" = (
         SELECT MIN("timestamp") FROM intraday_1m
         WHERE symbol = $1 AND session = 'PREMARKET'
           AND "timestamp" >= NOW() - INTERVAL '2 days' AND close > 0
       ))         AS pm_open
     FROM intraday_1m
     WHERE symbol = $1
       AND session = 'PREMARKET'
       AND "timestamp" >= NOW() - INTERVAL '2 days'
       AND close > 0`,
    [symbol],
    { timeoutMs: 10_000, label: `exec.pm_levels.${symbol}`, maxRetries: 0 }
  );
  return rows[0] ?? null;
}

// ── Compute ATR from last 14 daily candles if market_metrics ATR is missing ──

async function computeAtr(symbol) {
  const { rows } = await queryWithTimeout(
    `SELECT high, low, close
     FROM daily_ohlc
     WHERE symbol = $1 AND close > 0
     ORDER BY date DESC
     LIMIT 15`,
    [symbol],
    { timeoutMs: 10_000, label: `exec.atr.${symbol}`, maxRetries: 0 }
  );

  if (!rows || rows.length < 2) return null;

  // True Range for each bar: MAX(high-low, |high-prev_close|, |low-prev_close|)
  const trValues = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const cur  = rows[i];
    const prev = rows[i + 1];
    const hl   = Number(cur.high)  - Number(cur.low);
    const hpc  = Math.abs(Number(cur.high)  - Number(prev.close));
    const lpc  = Math.abs(Number(cur.low)   - Number(prev.close));
    trValues.push(Math.max(hl, hpc, lpc));
  }

  // Simple 14-period ATR (Wilder's uses EMA but simple avg is deterministic + stable)
  const last14 = trValues.slice(0, 14);
  return last14.reduce((s, v) => s + v, 0) / last14.length;
}

// ── Build execution plan for one symbol ──────────────────────────────────────

async function buildPlan(row) {
  const { symbol, premarket_signal_type, premarket_valid, premarket_gap_confidence } = row;

  // Fetch PM levels
  const levels = await fetchPremarketLevels(symbol);
  if (!levels) return { symbol, skipped: true, reason: 'no_pm_levels' };

  const pmHigh = Number(levels.pm_high);
  const pmLow  = Number(levels.pm_low);

  if (!Number.isFinite(pmHigh) || !Number.isFinite(pmLow) || pmLow <= 0 || pmHigh <= pmLow) {
    return { symbol, skipped: true, reason: 'invalid_pm_levels' };
  }

  // Resolve ATR: prefer market_metrics, fallback to computed
  let atr = Number(row.atr);
  if (!Number.isFinite(atr) || atr <= 0) {
    atr = await computeAtr(symbol);
  }
  if (!atr || !Number.isFinite(atr) || atr <= 0) {
    return { symbol, skipped: true, reason: 'no_atr' };
  }

  const currentPrice = Number(row.current_price);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return { symbol, skipped: true, reason: 'no_current_price' };
  }

  // ── Entry / Stop / Target by signal type ──────────────────────────────────
  let entryPrice, stopPrice, targetPrice, executionType;

  switch (premarket_signal_type) {
    case 'GAP_AND_GO':
      entryPrice    = pmHigh;
      stopPrice     = entryPrice - atr;
      targetPrice   = entryPrice + (atr * 2);
      executionType = 'BREAKOUT';
      break;

    case 'GAP_FADE':
      entryPrice    = pmLow;
      stopPrice     = entryPrice + atr;
      targetPrice   = entryPrice - (atr * 2);
      executionType = 'FADE';
      break;

    case 'RANGE_BUILD': {
      entryPrice    = pmHigh;
      stopPrice     = entryPrice - atr;
      targetPrice   = entryPrice + (atr * 2);
      executionType = 'RANGE';
      break;
    }

    default:
      return {
        symbol,
        skipped:        false,
        execution_type: 'NONE',
        execution_valid: false,
        entry_price:    null,
        stop_price:     null,
        target_price:   null,
        risk_percent:   null,
        reward_percent: null,
        risk_reward_ratio: null,
        position_size_shares: null,
        position_size_value:  null,
      };
  }

  // Round all prices to 4dp for cleanliness
  entryPrice  = Math.round(entryPrice  * 10000) / 10000;
  stopPrice   = Math.round(stopPrice   * 10000) / 10000;
  targetPrice = Math.round(targetPrice * 10000) / 10000;

  // ── Risk / Reward ──────────────────────────────────────────────────────────
  const riskAbs    = Math.abs(entryPrice - stopPrice);
  const rewardAbs  = Math.abs(targetPrice - entryPrice);

  if (riskAbs <= 0) {
    return { symbol, skipped: true, reason: 'zero_risk_range' };
  }

  const riskPercent   = (riskAbs   / entryPrice) * 100;
  const rewardPercent = (rewardAbs / entryPrice) * 100;
  const rrRatio       = rewardPercent / riskPercent;

  // ── Validity gate ──────────────────────────────────────────────────────────
  const executionValid =
    premarket_valid === true &&
    riskPercent <= 5 &&
    rrRatio >= 1.5 &&
    premarket_gap_confidence !== 'LOW';

  // ── Position sizing ────────────────────────────────────────────────────────
  const positionSizeShares = MAX_RISK_GBP / riskAbs;
  const positionSizeValue  = positionSizeShares * entryPrice;

  return {
    symbol,
    skipped:              false,
    execution_type:       executionType,
    execution_valid:      executionValid,
    entry_price:          entryPrice,
    stop_price:           stopPrice,
    target_price:         targetPrice,
    risk_percent:         Math.round(riskPercent   * 100) / 100,
    reward_percent:       Math.round(rewardPercent * 100) / 100,
    risk_reward_ratio:    Math.round(rrRatio        * 100) / 100,
    position_size_shares: Math.round(positionSizeShares * 100) / 100,
    position_size_value:  Math.round(positionSizeValue  * 100) / 100,
    pm_high:              pmHigh,
    pm_low:               pmLow,
    atr,
  };
}

// ── Write plan back to premarket_watchlist ───────────────────────────────────

async function writePlan(plan) {
  await queryWithTimeout(
    `UPDATE premarket_watchlist SET
       entry_price           = $2,
       stop_price            = $3,
       target_price          = $4,
       risk_percent          = $5,
       reward_percent        = $6,
       risk_reward_ratio     = $7,
       execution_valid       = $8,
       execution_type        = $9,
       position_size_shares  = $10,
       position_size_value   = $11,
       updated_at            = NOW()
     WHERE symbol = $1`,
    [
      plan.symbol,
      plan.entry_price,
      plan.stop_price,
      plan.target_price,
      plan.risk_percent,
      plan.reward_percent,
      plan.risk_reward_ratio,
      plan.execution_valid,
      plan.execution_type,
      plan.position_size_shares,
      plan.position_size_value,
    ],
    {
      timeoutMs:  10_000,
      label:      `exec.write.${plan.symbol}`,
      maxRetries: 0,
      poolType:   'write',
    }
  );
}

// ── Phase 9: write to signal_log if execution_valid ───────────────────────────

async function logSignal(plan) {
  if (!plan.execution_valid) return;

  await queryWithTimeout(
    `INSERT INTO signal_log
       (symbol, score, stage, entry_price, expected_move,
        stop_price, target_price, risk_reward_ratio, setup_type)
     SELECT $1, pw.score, pw.stage, $2, $3, $4, $5, $6,
            COALESCE(pw.premarket_signal_type, 'GAP_AND_GO')
     FROM premarket_watchlist pw
     WHERE pw.symbol = $1
       AND NOT EXISTS (
         SELECT 1 FROM signal_log sl
         WHERE sl.symbol = $1
           AND sl.timestamp > NOW() - INTERVAL '2 hours'
       )`,
    [
      plan.symbol,
      plan.entry_price,
      plan.reward_percent,   // expected_move = reward% (directional distance)
      plan.stop_price,
      plan.target_price,
      plan.risk_reward_ratio,
    ],
    {
      timeoutMs:  10_000,
      label:      `exec.signal_log.${plan.symbol}`,
      maxRetries: 0,
      poolType:   'write',
    }
  );
}

// ── Main run ─────────────────────────────────────────────────────────────────

async function runExecutionEngine() {
  const t0 = Date.now();
  console.log(`${ENGINE_LABEL} starting`);

  // Also mark symbols with no valid signal as execution_valid=false / type=NONE
  // (cleanup from prior runs where signal_type may have changed)
  try {
    await queryWithTimeout(
      `UPDATE premarket_watchlist
       SET execution_valid = false, execution_type = 'NONE', updated_at = NOW()
       WHERE (premarket_signal_type IS NULL
              OR premarket_signal_type = 'UNDEFINED'
              OR premarket_valid = FALSE)
         AND (execution_type IS NULL OR execution_type != 'NONE')`,
      [],
      { timeoutMs: 10_000, label: 'exec.cleanup', poolType: 'write' }
    );
  } catch (_) { /* non-fatal */ }

  let candidates;
  try {
    candidates = await fetchWatchlistSymbols();
  } catch (err) {
    console.error(`${ENGINE_LABEL} failed to load candidates:`, err.message);
    return { ok: false, error: err.message };
  }

  if (!candidates || candidates.length === 0) {
    console.warn(`${ENGINE_LABEL} no candidates (no symbols with valid premarket signal)`);
    return { ok: true, processed: 0 };
  }

  console.log(`${ENGINE_LABEL} building plans for ${candidates.length} symbols`);

  const plans    = [];
  let written    = 0;
  let skipped    = 0;
  let validCount = 0;
  const typeDist = {};

  for (const row of candidates) {
    try {
      const plan = await buildPlan(row);
      plans.push(plan);

      if (plan.skipped) {
        skipped++;
        console.log(`${ENGINE_LABEL} ${row.symbol} skipped: ${plan.reason}`);
      } else {
        await writePlan(plan);
        await logSignal(plan);
        written++;

        if (plan.execution_valid) validCount++;
        const t = plan.execution_type || 'NONE';
        typeDist[t] = (typeDist[t] || 0) + 1;

        console.log(
          `${ENGINE_LABEL} ${row.symbol}` +
          ` type=${plan.execution_type} valid=${plan.execution_valid}` +
          ` entry=${plan.entry_price?.toFixed(2)} stop=${plan.stop_price?.toFixed(2)}` +
          ` target=${plan.target_price?.toFixed(2)} rr=${plan.risk_reward_ratio?.toFixed(2)}`
        );
      }
    } catch (err) {
      console.error(`${ENGINE_LABEL} ${row.symbol} error: ${err.message}`);
      skipped++;
    }

    if (INTER_SYMBOL_DELAY > 0) {
      await new Promise(r => setTimeout(r, INTER_SYMBOL_DELAY));
    }
  }

  const validPlans = plans.filter(p => !p.skipped && p.execution_valid);
  const avgRR = validPlans.length
    ? validPlans.reduce((s, p) => s + (p.risk_reward_ratio || 0), 0) / validPlans.length
    : 0;
  const bestPlan = validPlans.sort((a, b) => (b.risk_reward_ratio || 0) - (a.risk_reward_ratio || 0))[0];

  const ms = Date.now() - t0;
  console.log(
    `${ENGINE_LABEL} done — written=${written} valid=${validCount} skipped=${skipped}` +
    ` types=${JSON.stringify(typeDist)} avg_rr=${avgRR.toFixed(2)} ${ms}ms`
  );

  return {
    ok:               true,
    processed:        candidates.length,
    written,
    valid_setups:     validCount,
    invalid_setups:   written - validCount,
    skipped,
    type_distribution: typeDist,
    avg_risk_reward:  Math.round(avgRR * 100) / 100,
    highest_rr_symbol: bestPlan?.symbol ?? null,
    highest_rr:       bestPlan?.risk_reward_ratio ?? null,
    duration_ms:      ms,
    plans,
  };
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;

function startExecutionScheduler(intervalMs = 10 * 60 * 1000) {
  if (_timer) return;

  runExecutionEngine().catch(err =>
    console.error(`${ENGINE_LABEL} startup run failed:`, err.message)
  );

  _timer = setInterval(() => {
    runExecutionEngine().catch(err =>
      console.error(`${ENGINE_LABEL} scheduled run failed:`, err.message)
    );
  }, intervalMs);

  console.log(`${ENGINE_LABEL} scheduler started (interval=${intervalMs / 60000}min)`);
}

function stopExecutionScheduler() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    console.log(`${ENGINE_LABEL} scheduler stopped`);
  }
}

module.exports = {
  runExecutionEngine,
  startExecutionScheduler,
  stopExecutionScheduler,
};
