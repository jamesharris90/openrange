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
  if (global.systemBlocked) {
    console.warn(`${ENGINE_LABEL} [BLOCKED] skipped — pipeline unhealthy`, { reason: global.systemBlockedReason });
    return { processed: 0, skipped: 0, blocked: true };
  }

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

// ── Signal-level execution plan (pure, synchronous) ──────────────────────────
//
// Used by strategySignalEngine, opportunityEngine, and the
// /api/intelligence/top-opportunity endpoint to attach a complete trade plan
// to every real-time signal.  No DB access — all inputs come from the caller.
//
//   computeExecutionPlan(signal) → {
//     entry_price, stop_loss, target_price,
//     position_size, risk_reward, trade_quality_score,
//     execution_ready, rejection_reason,
//     why_moving, why_tradeable, how_to_trade
//   }

const MIN_RR         = 2.0;
const MIN_CONFIDENCE = 50;
const MIN_VOLUME     = 500_000;
const MIN_ATR_PCT    = 0.01; // ATR must be ≥ 1% of price

function _entry(strategy, price, previousHigh, vwap) {
  if (!price || price <= 0) return 0;
  const p = price;
  switch (strategy) {
    case 'Gap & Go':              return _r4(p * 1.005);
    case 'ORB Breakout':          return previousHigh > 0 && previousHigh >= p * 0.9 ? _r4(previousHigh + 0.05) : _r4(p * 1.01);
    case 'Day 2 Continuation':    return previousHigh > 0 && previousHigh >= p * 0.9 ? _r4(previousHigh + 0.05) : _r4(p * 1.005);
    case 'Short Squeeze':         return _r4(p * 1.002);
    case 'VWAP Reclaim':
    case 'VWAP':                  return vwap > 0 && vwap >= p * 0.9 ? _r4(vwap * 1.001) : _r4(p * 1.002);
    default:                      return _r4(p * 1.005);
  }
}

function _entryLabel(strategy, stage) {
  if (stage === 'EARLY')    return 'early-stage aggressive entry near current price';
  if (stage === 'EXTENDED') return 'pullback entry — wait for minor retracement';
  switch (strategy) {
    case 'Gap & Go':              return 'gap continuation above open';
    case 'ORB Breakout':          return 'break above opening range high';
    case 'Day 2 Continuation':    return 'break above prior day high';
    case 'Short Squeeze':         return 'momentum squeeze continuation';
    case 'VWAP Reclaim':
    case 'VWAP':                  return 'VWAP reclaim and hold';
    default:                      return 'momentum continuation setup';
  }
}

// ── Trade Lifecycle Stage ─────────────────────────────────────────────────────
//
// Classifies where a signal sits in its move so entry/stop/target can be
// adapted to the remaining risk:reward available.
//
//   EARLY      — move not yet confirmed (low chg%, low rvol)
//   EXPANSION  — momentum confirmed with volume (chg 5-20%, rvol ≥ 2)
//   EXTENDED   — very large move, upside limited (chg > 20%)
//   EXHAUSTION — price falling after spike (reversal / avoid long)

function computeLifecycleStage(changePercent, relativeVolume, price, previousClose) {
  // Exhaustion: price falling after a spike
  if (previousClose > 0 && price < previousClose && changePercent < -3)
    return 'EXHAUSTION';
  // Extended: move already very large regardless of direction
  if (Math.abs(changePercent) > 20)
    return 'EXTENDED';
  // Expansion: meaningful move with volume confirmation
  if (Math.abs(changePercent) >= 5 && relativeVolume >= 2)
    return 'EXPANSION';
  // Early: move not yet confirmed
  return 'EARLY';
}

// ── Phase 5: Context-aware stage override ────────────────────────────────────
//
// If market context (volume trend + structure) contradicts the raw stage
// classification, override it to reduce false EXTENDED signals and catch
// fading EXPANSION moves before they become traps.

function computeLifecycleStageWithContext(changePercent, relativeVolume, price, previousClose, context) {
  let stage = computeLifecycleStage(changePercent, relativeVolume, price, previousClose);
  if (!context) return stage;

  const { volume_trend, structure } = context;

  // EXTENDED but volume still expanding and structure still trending → EXPANSION
  if (stage === 'EXTENDED' && volume_trend === 'EXPANDING' && structure === 'TRENDING_UP')
    return 'EXPANSION';

  // EXPANSION but volume fading and structure weakening → EXTENDED
  if (stage === 'EXPANSION' && volume_trend === 'FADING' && structure === 'WEAKENING')
    return 'EXTENDED';

  return stage;
}

// Stage-specific entry price
function _stageEntry(stage, strategy, price, previousHigh, vwap) {
  switch (stage) {
    case 'EARLY':     return _r4(price * 1.002);                              // near current — aggressive
    case 'EXPANSION': return _entry(strategy, price, previousHigh, vwap);    // strategy confirmation
    case 'EXTENDED':  return _r4(price * 0.995);                              // wait for micro-pullback
    case 'EXHAUSTION':return 0;                                               // blocked
    default:          return _entry(strategy, price, previousHigh, vwap);
  }
}

// Stage-specific stop loss
function _stageStop(stage, entry, effectiveAtr, vwap, previousHigh) {
  switch (stage) {
    case 'EARLY':
      return _r4(entry - effectiveAtr);                                       // 1×ATR
    case 'EXPANSION': {
      // Use VWAP or previous high as natural stop if available
      const vwapStop = vwap > 0 && vwap < entry ? _r4(vwap * 0.998) : 0;
      const phStop   = previousHigh > 0 && previousHigh < entry ? _r4(previousHigh - 0.05) : 0;
      return vwapStop || phStop || _r4(entry - effectiveAtr);
    }
    case 'EXTENDED':
      return _r4(entry - effectiveAtr * 0.5);                                // 0.5×ATR — tighter
    case 'EXHAUSTION':
      return 0;
    default:
      return _r4(entry - effectiveAtr);
  }
}

// Stage-specific target price
function _stageTarget(stage, entry, effectiveAtr) {
  switch (stage) {
    case 'EARLY':     return _r4(entry + effectiveAtr * 3);  // 3×ATR — full upside
    case 'EXPANSION': return _r4(entry + effectiveAtr * 2);  // 2×ATR — standard
    case 'EXTENDED':  return _r4(entry + effectiveAtr * 1);  // 1×ATR — limited remaining move
    case 'EXHAUSTION':return 0;
    default:          return _r4(entry + effectiveAtr * 2);
  }
}

function _entryType(stage) {
  switch (stage) {
    case 'EARLY':     return 'AGGRESSIVE';
    case 'EXPANSION': return 'CONFIRMATION';
    case 'EXTENDED':  return 'PULLBACK';
    case 'EXHAUSTION':return 'BLOCKED';
    default:          return 'CONFIRMATION';
  }
}

function _exitType(stage) {
  switch (stage) {
    case 'EARLY':     return 'ATR_3X';
    case 'EXPANSION': return 'ATR_2X';
    case 'EXTENDED':  return 'ATR_1X';
    case 'EXHAUSTION':return 'BLOCKED';
    default:          return 'ATR_2X';
  }
}

function _qualityGate({ price, atr, volume, confidence, rr }) {
  if (confidence < MIN_CONFIDENCE)               return { pass: false, reason: 'confidence_below_50' };
  if (price > 0 && (atr / price) < MIN_ATR_PCT)  return { pass: false, reason: 'atr_too_small' };
  if (volume < MIN_VOLUME)                        return { pass: false, reason: 'volume_below_500k' };
  if (rr < MIN_RR)                                return { pass: false, reason: 'rr_below_2' };
  return { pass: true, reason: null };
}

// ── Phase 6: Context entry gate ───────────────────────────────────────────────
//
// Only enforced when context is available (UNKNOWN values pass through).
//
//   BREAKOUT entries (EARLY / EXPANSION):
//     - price must be ABOVE or RECLAIM VWAP
//     - volume must not be FADING
//
//   PULLBACK entries (EXTENDED):
//     - RECLAIM + EXPANDING volume → allow (best pullback setup)
//     - ABOVE VWAP → allow
//     - BELOW VWAP → block (no support)

function _contextEntryGate(stage, context) {
  if (!context) return { pass: true, reason: null };

  const { vwap_relation, volume_trend } = context;

  // Skip enforcement if both dimensions are unknown
  if (vwap_relation === 'UNKNOWN' && volume_trend === 'UNKNOWN')
    return { pass: true, reason: null };

  if (stage === 'EARLY' || stage === 'EXPANSION') {
    if (vwap_relation === 'BELOW')
      return { pass: false, reason: 'breakout_entry_below_vwap' };
    if (volume_trend === 'FADING' && vwap_relation !== 'RECLAIM')
      return { pass: false, reason: 'breakout_entry_volume_fading' };
  }

  if (stage === 'EXTENDED') {
    if (vwap_relation === 'BELOW')
      return { pass: false, reason: 'pullback_entry_below_vwap' };
  }

  return { pass: true, reason: null };
}

function _tradeQuality({ price, atr, volume, confidence, rr }) {
  let score = 50;
  const atrPct = price > 0 ? (atr / price) * 100 : 0;
  if (atrPct >= 3)      score += 15;
  else if (atrPct >= 2) score += 10;
  else if (atrPct >= 1) score += 5;
  else                  score -= 15;

  if (volume >= 10_000_000)     score += 15;
  else if (volume >= 5_000_000) score += 10;
  else if (volume >= 1_000_000) score += 5;
  else                          score -= 10;

  if (confidence >= 75)      score += 15;
  else if (confidence >= 60) score += 8;
  else if (confidence < 50)  score -= 15;

  if (rr >= 3.0) score += 10; else if (rr >= 2.5) score += 5; else if (rr < 2.0) score -= 20;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function _contextInsight(context, stage) {
  if (!context) return null;

  const { vwap_relation, volume_trend, structure } = context;
  const parts = [];

  // Describe the VWAP + volume combination
  if (vwap_relation === 'ABOVE' && volume_trend === 'EXPANDING')
    parts.push('holding above VWAP with expanding volume');
  else if (vwap_relation === 'RECLAIM')
    parts.push('just reclaimed VWAP — momentum shifting');
  else if (vwap_relation === 'BELOW' && volume_trend === 'FADING')
    parts.push('below VWAP with fading volume');
  else if (vwap_relation === 'ABOVE')
    parts.push('above VWAP');
  else if (vwap_relation === 'BELOW')
    parts.push('below VWAP');

  // Describe structure
  if (structure === 'TRENDING_UP')    parts.push('higher highs and higher lows intact');
  else if (structure === 'WEAKENING') parts.push('lower highs forming');

  if (parts.length === 0) return null;

  let insight = 'Stock is ' + parts.join(' with ') + '.';

  if (structure === 'TRENDING_UP')
    insight += ' This suggests continuation.';
  else if (structure === 'WEAKENING')
    insight += ' Watch for reversal signs.';

  // Stage-specific follow-on action
  if (stage === 'EARLY' || stage === 'EXPANSION') {
    if (vwap_relation === 'ABOVE')
      insight += ' Watch for pullback to VWAP as a safer entry.';
    else if (vwap_relation === 'RECLAIM')
      insight += ' Trade as continuation while price holds above VWAP.';
  } else if (stage === 'EXTENDED') {
    insight += ' Move is extended — reduced size, tight stop near VWAP.';
  }

  return insight;
}

function _narratives(signal, entry, stop, target, rr, stage, context) {
  const { price = 0, atr = 0, volume = 0, relativeVolume = 0,
    changePercent = 0, gapPercent = 0, strategy = null,
    catalyst = null, regime = null } = signal;

  // WHAT HAPPENED (why_moving)
  // Rules: must be specific — no generic fallback text
  const m = [];

  // Gap
  if (gapPercent > 10)      m.push(`Gapped up ${gapPercent.toFixed(1)}% from previous close`);
  else if (gapPercent > 5)  m.push(`Pre-market gap of ${gapPercent.toFixed(1)}%`);
  else if (gapPercent > 2)  m.push(`Opening gap of ${gapPercent.toFixed(1)}% from prior close`);
  else if (gapPercent < -5) m.push(`Gapped down ${Math.abs(gapPercent).toFixed(1)}% from previous close`);

  // Price change
  if (changePercent > 20)      m.push(`Up ${changePercent.toFixed(1)}% — extended move`);
  else if (changePercent > 10) m.push(`Up ${changePercent.toFixed(1)}% intraday with sustained momentum`);
  else if (changePercent > 5)  m.push(`Up ${changePercent.toFixed(1)}% — move in progress`);
  else if (changePercent > 2)  m.push(`${changePercent.toFixed(1)}% gain building structure`);
  else if (changePercent < -5) m.push(`Down ${Math.abs(changePercent).toFixed(1)}% — selling pressure`);

  // Volume
  if (relativeVolume > 8)       m.push(`Extraordinary volume at ${relativeVolume.toFixed(1)}× the 30-day average`);
  else if (relativeVolume > 4)  m.push(`High-conviction volume at ${relativeVolume.toFixed(1)}× average`);
  else if (relativeVolume > 2)  m.push(`Elevated volume at ${relativeVolume.toFixed(1)}× average`);
  else if (relativeVolume > 0)  m.push(`Volume at ${relativeVolume.toFixed(1)}× average — below threshold`);

  // Catalyst — MUST explicitly state presence or absence
  if (catalyst && String(catalyst).trim()) {
    m.push(`Catalyst: ${String(catalyst).trim()}`);
  } else {
    m.push('No confirmed catalyst — technical move only');
  }

  const why_moving = m.join('. ').replace(/\.\./g, '.');

  // WHAT IT MEANS (why_tradeable) — includes context insight
  const t = [];
  const volM   = (volume / 1_000_000).toFixed(1);
  const atrPct = price > 0 ? ((atr / price) * 100).toFixed(1) : '0';
  // Liquidity + volatility assessment — specific values only
  const volDesc = Number(volume) >= 1_000_000
    ? `${volM}M shares traded — liquid`
    : Number(volume) >= 500_000
      ? `${volM}M shares traded — minimum liquidity`
      : `${volM}M shares traded — below liquidity threshold`;
  t.push(volDesc);

  const atrDesc = Number(atrPct) >= 2
    ? `ATR $${atr.toFixed(2)} (${atrPct}% of price) — sufficient volatility for meaningful stops`
    : Number(atrPct) >= 1
      ? `ATR $${atr.toFixed(2)} (${atrPct}% of price) — borderline volatility`
      : `ATR $${atr.toFixed(2)} (${atrPct}% of price) — low volatility, tight risk structure`;
  t.push(atrDesc);

  if (strategy) t.push(`${strategy} pattern detected`);

  // Stage-specific interpretation
  switch (stage) {
    case 'EARLY':     t.push('Early stage — move unconfirmed, aggressive entry only with strict stop'); break;
    case 'EXPANSION': t.push('Expansion phase — momentum confirmed by volume and price structure'); break;
    case 'EXTENDED':  t.push('Extended move — upside limited, only pullback entries, reduced size'); break;
    case 'EXHAUSTION':t.push('Exhaustion detected — avoid new long exposure entirely'); break;
    default: break;
  }

  // No catalyst = explicit lower-conviction label
  if (!catalyst || !String(catalyst).trim()) {
    t.push('Technical setup only — no confirmed catalyst (lower conviction)');
  }

  if (regime === 'BULL')      t.push('Bullish market regime supports long setups');
  else if (regime === 'BEAR') t.push('Bear regime — reduce position size, tighten stops');

  const ctxInsight = _contextInsight(context, stage);
  if (ctxInsight) t.push(ctxInsight);
  const why_tradeable = t.join('. ');

  // WHAT TO WATCH NEXT — explicit plan OR explicit avoid
  let how_to_trade;
  if (stage === 'EXHAUSTION') {
    how_to_trade = 'Avoid — exhaustion after extended move. No valid entry. Wait for multi-candle consolidation before reassessing.';
  } else if (entry <= 0 || stop <= 0) {
    how_to_trade = 'Avoid — insufficient price structure to define entry and stop levels.';
  } else {
    const riskPerShare = Math.abs(entry - stop);
    const breakEven    = _r4(entry + riskPerShare);
    const partial      = _r4(entry + riskPerShare * 1.5);
    const trail        = _r4(entry + riskPerShare * 2);
    how_to_trade =
      `Enter at $${entry.toFixed(2)} (${_entryLabel(strategy, stage)}). ` +
      `Stop at $${stop.toFixed(2)} — max risk £${MAX_RISK_GBP}. ` +
      `Target $${target.toFixed(2)} (${rr.toFixed(1)}:1 R:R). ` +
      `Move stop to break-even at $${breakEven.toFixed(2)} (+1R). ` +
      `Take partial profits at $${partial.toFixed(2)} (+1.5R). ` +
      `Trail stop above $${trail.toFixed(2)} to lock gains (+2R).`;
    if (context?.time_context === 'OPEN')
      how_to_trade += ' Caution: first 30 min — allow price to establish range before entering.';
    else if (context?.time_context === 'POWER_HOUR')
      how_to_trade += ' Power hour — momentum can accelerate or reverse sharply.';
    else if (context?.time_context === 'AFTER_HOURS' || context?.time_context === 'CLOSED')
      how_to_trade += ' Market closed — this is a pre-positioning plan, not a live entry.';
  }

  return { why_moving, why_tradeable, how_to_trade };
}

/**
 * Compute a full signal-level execution plan (pure, synchronous).
 *
 * Classifies the signal into a lifecycle stage (EARLY / EXPANSION / EXTENDED /
 * EXHAUSTION), applies market context overrides, and adapts entry, stop,
 * target, and narrative accordingly.
 *
 * @param {object} signal - { price, atr?, volume?, relativeVolume?,
 *   changePercent?, gapPercent?, confidence?, strategy?, previousHigh?,
 *   vwap?, catalyst?, regime?, previousClose?, marketContext? }
 * @returns {object} execution plan including lifecycle_stage, entry_type,
 *   exit_type, vwap_relation, volume_trend, market_structure, time_context
 */
function computeExecutionPlan(signal) {
  const {
    price = 0, atr = 0, volume = 0, relativeVolume = 0,
    changePercent = 0, gapPercent = 0, confidence = 50,
    strategy = null, previousHigh = 0, vwap = 0,
    catalyst = null, regime = null, previousClose = 0,
    marketContext = null,
  } = signal;

  if (!price || price <= 0) return _emptyExecPlan('no_price');

  const effectiveAtr = atr > 0 ? atr : price * 0.02;

  // Phase 5: context-aware stage classification
  const stage     = computeLifecycleStageWithContext(changePercent, relativeVolume, price, previousClose, marketContext);
  const entryType = _entryType(stage);
  const exitType  = _exitType(stage);

  // Context fields for DB storage
  const vwap_relation    = marketContext?.vwap_relation    ?? null;
  const volume_trend     = marketContext?.volume_trend     ?? null;
  const market_structure = marketContext?.structure        ?? null;
  const time_context     = marketContext?.time_context     ?? null;

  // EXHAUSTION — block long exposure immediately
  if (stage === 'EXHAUSTION') {
    const enriched = { ...signal, atr: effectiveAtr, relativeVolume, changePercent, gapPercent, catalyst, regime };
    const { why_moving } = _narratives(enriched, 0, 0, 0, 0, stage, marketContext);
    return {
      ..._emptyExecPlan('exhaustion_stage_blocked'),
      lifecycle_stage: stage,
      entry_type:      entryType,
      exit_type:       exitType,
      vwap_relation, volume_trend, market_structure, time_context,
      why_moving,
      why_tradeable:   'Move showing exhaustion — avoid long exposure. Wait for consolidation.',
      how_to_trade:    'Setup blocked — exhaustion after extended move. Wait for consolidation before new entry.',
    };
  }

  const entry = _stageEntry(stage, strategy, price, previousHigh, vwap);
  if (entry <= 0) return {
    ..._emptyExecPlan('no_entry'),
    lifecycle_stage: stage, entry_type: entryType, exit_type: exitType,
    vwap_relation, volume_trend, market_structure, time_context,
  };

  const stop         = _stageStop(stage, entry, effectiveAtr, vwap, previousHigh);
  const target       = _stageTarget(stage, entry, effectiveAtr);
  const riskPerShare = Math.abs(entry - stop);
  const rr           = riskPerShare > 0 ? _r3((target - entry) / riskPerShare) : 0;

  // Phase 6: quality gate + context entry gate (both must pass)
  const { pass: qualPass, reason: qualReason } = _qualityGate({ price, atr: effectiveAtr, volume, confidence, rr });
  const { pass: ctxPass,  reason: ctxReason  } = _contextEntryGate(stage, marketContext);
  const pass   = qualPass && ctxPass;
  const reason = !qualPass ? qualReason : (!ctxPass ? ctxReason : null);

  let positionSize = 0;
  if (pass) {
    const raw  = riskPerShare > 0 ? MAX_RISK_GBP / riskPerShare : 0;
    const mult = confidence > 75 ? 1.2 : confidence < 60 ? 0.5 : 1.0;
    positionSize = _r2(raw * mult);
  }

  const enriched = { ...signal, atr: effectiveAtr, relativeVolume, changePercent, gapPercent, catalyst, regime };
  const { why_moving, why_tradeable, how_to_trade } = _narratives(enriched, entry, stop, target, rr, stage, marketContext);

  return {
    entry_price:          entry,
    stop_loss:            stop,
    target_price:         target,
    position_size:        positionSize,
    risk_reward:          rr,
    trade_quality_score:  _tradeQuality({ price, atr: effectiveAtr, volume, confidence, rr }),
    execution_ready:      pass,
    rejection_reason:     reason,
    lifecycle_stage:      stage,
    entry_type:           entryType,
    exit_type:            exitType,
    vwap_relation,
    volume_trend,
    market_structure,
    time_context,
    why_moving,
    why_tradeable,
    how_to_trade,
  };
}

function _emptyExecPlan(reason) {
  return {
    entry_price: 0, stop_loss: 0, target_price: 0, position_size: 0,
    risk_reward: 0, trade_quality_score: 0, execution_ready: false,
    rejection_reason: reason, why_moving: '', why_tradeable: '', how_to_trade: '',
    lifecycle_stage: null, entry_type: null, exit_type: null,
    vwap_relation: null, volume_trend: null, market_structure: null, time_context: null,
  };
}

function _r4(n) { return Math.round(n * 10000) / 10000; }
function _r3(n) { return Math.round(n * 1000)  / 1000;  }
function _r2(n) { return Math.round(n * 100)   / 100;   }

module.exports = {
  runExecutionEngine,
  startExecutionScheduler,
  stopExecutionScheduler,
  computeExecutionPlan,
  computeLifecycleStage,
  computeLifecycleStageWithContext,
};
