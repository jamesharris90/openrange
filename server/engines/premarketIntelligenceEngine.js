'use strict';

/**
 * Premarket Intelligence Engine
 *
 * Runs every 10 minutes AFTER sessionAggregationEngine.
 * Reads PREMARKET candles from intraday_1m, computes:
 *   - pm_high, pm_low, pm_open (first candle open), pm_last (last close)
 *   - range_percent = (pm_high - pm_low) / pm_low * 100
 *   - trend: UP / DOWN / RANGE
 *   - previous_close from daily_ohlc → gap_percent
 *   - gap_confidence: HIGH / MEDIUM / LOW
 *   - signal_type: GAP_AND_GO / GAP_FADE / RANGE_BUILD / UNDEFINED
 *   - premarket_valid: boolean
 *
 * Then UPDATEs premarket_watchlist with all computed columns.
 *
 * NON-NEGOTIABLE:
 *   - NO synthetic data
 *   - NO overwriting valid data with nulls
 *   - ALL intelligence derived from DB
 *   - MUST degrade gracefully (skip symbol if no PM candles)
 */

const { queryWithTimeout } = require('../db/pg');

const ENGINE_LABEL = '[PM_INTEL]';
const INTER_SYMBOL_DELAY_MS = 200;

// ── Fetch premarket candles for a symbol ────────────────────────────────────

async function fetchPremarketCandles(symbol) {
  const { rows } = await queryWithTimeout(
    `SELECT
       "timestamp",
       open, high, low, close, volume,
       data_quality_score
     FROM intraday_1m
     WHERE symbol = $1
       AND session = 'PREMARKET'
       AND "timestamp" >= NOW() - INTERVAL '2 days'
       AND close > 0
     ORDER BY "timestamp" ASC`,
    [symbol],
    { timeoutMs: 10_000, label: `pm_intel.candles.${symbol}`, maxRetries: 0 }
  );
  return rows;
}

// ── Fetch previous close from daily_ohlc ────────────────────────────────────

async function fetchPreviousClose(symbol) {
  const { rows } = await queryWithTimeout(
    `SELECT close
     FROM daily_ohlc
     WHERE symbol = $1
       AND close > 0
     ORDER BY date DESC
     LIMIT 1`,
    [symbol],
    { timeoutMs: 10_000, label: `pm_intel.prev_close.${symbol}`, maxRetries: 0 }
  );
  return rows[0]?.close ?? null;
}

// ── Trend classification ─────────────────────────────────────────────────────

/**
 * Determine trend from ordered premarket candles.
 * UP:    pm_last > pm_open AND higher highs dominate
 * DOWN:  pm_last < pm_open AND lower lows dominate
 * RANGE: otherwise
 */
function classifyTrend(candles) {
  if (!candles || candles.length < 2) return 'RANGE';

  const pmOpen = Number(candles[0].open);
  const pmLast = Number(candles[candles.length - 1].close);
  const highs  = candles.map(c => Number(c.high));
  const lows   = candles.map(c => Number(c.low));

  let higherHighs = 0;
  let lowerLows   = 0;
  for (let i = 1; i < highs.length; i++) {
    if (highs[i] > highs[i - 1]) higherHighs++;
    if (lows[i]  < lows[i - 1])  lowerLows++;
  }

  const priceMove = pmOpen > 0 ? ((pmLast - pmOpen) / pmOpen) * 100 : 0;

  if (pmLast > pmOpen && (priceMove > 0.5 || higherHighs > lowerLows)) return 'UP';
  if (pmLast < pmOpen && (priceMove < -0.5 || lowerLows > higherHighs)) return 'DOWN';
  return 'RANGE';
}

// ── Gap confidence classification ────────────────────────────────────────────

/**
 * HIGH:   volume > 200k AND range > 2% AND candle count > 20
 * MEDIUM: volume > 50k  AND range > 0.5% AND count > 5
 * LOW:    everything else
 */
function classifyGapConfidence(pmVolume, rangePercent, candleCount) {
  const vol   = Number(pmVolume)     || 0;
  const range = Number(rangePercent) || 0;
  const count = Number(candleCount)  || 0;

  if (vol > 200_000 && range > 2 && count > 20) return 'HIGH';
  if (vol > 50_000  && range > 0.5 && count > 5) return 'MEDIUM';
  return 'LOW';
}

// ── Signal classification ────────────────────────────────────────────────────

/**
 * GAP_AND_GO:  gap > 5 AND trend = UP  AND confidence = HIGH
 * GAP_FADE:    gap > 5 AND trend = DOWN
 * RANGE_BUILD: range < 2
 * UNDEFINED:   all other cases
 */
function classifySignal(gapPercent, trend, confidence, rangePercent) {
  const gap   = Math.abs(Number(gapPercent)   || 0);
  const range = Number(rangePercent) || 0;

  if (gap > 5 && trend === 'UP'   && confidence === 'HIGH') return 'GAP_AND_GO';
  if (gap > 5 && trend === 'DOWN')                          return 'GAP_FADE';
  if (range < 2)                                            return 'RANGE_BUILD';
  return 'UNDEFINED';
}

// ── Process one symbol ───────────────────────────────────────────────────────

async function processSymbol(symbol) {
  // Fetch premarket candles
  let candles;
  try {
    candles = await fetchPremarketCandles(symbol);
  } catch (err) {
    console.warn(`${ENGINE_LABEL} candles fetch failed for ${symbol}: ${err.message}`);
    return { symbol, skipped: true, reason: 'candles_fetch_error' };
  }

  if (!candles || candles.length === 0) {
    return { symbol, skipped: true, reason: 'no_premarket_candles' };
  }

  // Compute OHLC aggregates
  const pmOpen  = Number(candles[0].open);
  const pmLast  = Number(candles[candles.length - 1].close);
  const pmHigh  = candles.reduce((max, c) => Math.max(max, Number(c.high)), -Infinity);
  const pmLow   = candles.reduce((min, c) => Math.min(min, Number(c.low)),   Infinity);
  const pmVolume = candles.reduce((sum, c) => sum + (Number(c.volume) || 0), 0);
  const candleCount = candles.length;

  if (pmLow <= 0 || !Number.isFinite(pmHigh) || !Number.isFinite(pmLow)) {
    return { symbol, skipped: true, reason: 'invalid_ohlc' };
  }

  const rangePercent = ((pmHigh - pmLow) / pmLow) * 100;
  const trend = classifyTrend(candles);

  // Previous close for gap calculation
  let prevClose = null;
  try {
    prevClose = await fetchPreviousClose(symbol);
  } catch (err) {
    console.warn(`${ENGINE_LABEL} prev_close fetch failed for ${symbol}: ${err.message}`);
  }

  let gapPercent = null;
  if (prevClose && prevClose > 0) {
    gapPercent = ((pmLast - prevClose) / prevClose) * 100;
  }

  const gapConfidence = classifyGapConfidence(pmVolume, rangePercent, candleCount);
  const signalType    = classifySignal(gapPercent, trend, gapConfidence, rangePercent);
  const premarketValid =
    gapConfidence !== 'LOW' &&
    pmVolume > 100_000 &&
    rangePercent > 1;

  return {
    symbol,
    skipped:         false,
    pm_open:         pmOpen,
    pm_high:         pmHigh,
    pm_low:          pmLow,
    pm_last:         pmLast,
    pm_volume:       pmVolume,
    candle_count:    candleCount,
    range_percent:   rangePercent,
    trend,
    prev_close:      prevClose,
    gap_percent:     gapPercent,
    gap_confidence:  gapConfidence,
    signal_type:     signalType,
    premarket_valid: premarketValid,
  };
}

// ── UPDATE premarket_watchlist ───────────────────────────────────────────────

async function updateWatchlist(result) {
  await queryWithTimeout(
    `UPDATE premarket_watchlist SET
       premarket_trend          = $2,
       premarket_range_percent  = $3,
       premarket_gap_confidence = $4,
       premarket_signal_type    = $5,
       premarket_valid          = $6,
       updated_at               = NOW()
     WHERE symbol = $1`,
    [
      result.symbol,
      result.trend,
      result.range_percent !== null ? Math.round(result.range_percent * 100) / 100 : null,
      result.gap_confidence,
      result.signal_type,
      result.premarket_valid,
    ],
    {
      timeoutMs:  10_000,
      label:      `pm_intel.update.${result.symbol}`,
      maxRetries: 0,
      poolType:   'write',
    }
  );
}

// ── Main run ─────────────────────────────────────────────────────────────────

async function runPremarketIntelligenceEngine() {
  const t0 = Date.now();
  console.log(`${ENGINE_LABEL} starting`);

  // Get all symbols currently in premarket_watchlist
  let symbols;
  try {
    const { rows } = await queryWithTimeout(
      `SELECT symbol FROM premarket_watchlist ORDER BY score DESC`,
      [],
      { timeoutMs: 10_000, label: 'pm_intel.symbols' }
    );
    symbols = rows.map(r => r.symbol);
  } catch (err) {
    console.error(`${ENGINE_LABEL} failed to load symbols:`, err.message);
    return { ok: false, error: err.message };
  }

  if (!symbols || symbols.length === 0) {
    console.warn(`${ENGINE_LABEL} no symbols in premarket_watchlist`);
    return { ok: true, processed: 0 };
  }

  console.log(`${ENGINE_LABEL} processing ${symbols.length} symbols`);

  const results    = [];
  let updated      = 0;
  let skipped      = 0;
  const signalDist = {};

  for (const symbol of symbols) {
    try {
      const result = await processSymbol(symbol);
      results.push(result);

      if (result.skipped) {
        skipped++;
        console.log(`${ENGINE_LABEL} ${symbol} skipped: ${result.reason}`);
      } else {
        await updateWatchlist(result);
        updated++;
        const sig = result.signal_type;
        signalDist[sig] = (signalDist[sig] || 0) + 1;
        console.log(
          `${ENGINE_LABEL} ${symbol}` +
          ` trend=${result.trend}` +
          ` gap=${result.gap_percent != null ? result.gap_percent.toFixed(2) : 'n/a'}%` +
          ` conf=${result.gap_confidence} signal=${result.signal_type}` +
          ` valid=${result.premarket_valid}`
        );
      }
    } catch (err) {
      console.error(`${ENGINE_LABEL} ${symbol} error: ${err.message}`);
      skipped++;
    }

    if (INTER_SYMBOL_DELAY_MS > 0) {
      await new Promise(r => setTimeout(r, INTER_SYMBOL_DELAY_MS));
    }
  }

  const ms = Date.now() - t0;
  console.log(
    `${ENGINE_LABEL} done — updated=${updated} skipped=${skipped}` +
    ` signals=${JSON.stringify(signalDist)} ${ms}ms`
  );

  return {
    ok:                  true,
    processed:           symbols.length,
    updated,
    skipped,
    signal_distribution: signalDist,
    duration_ms:         ms,
    results,
  };
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let _timer = null;

function startPremarketIntelligenceScheduler(intervalMs = 10 * 60 * 1000) {
  if (_timer) return;

  runPremarketIntelligenceEngine().catch(err =>
    console.error(`${ENGINE_LABEL} startup run failed:`, err.message)
  );

  _timer = setInterval(() => {
    runPremarketIntelligenceEngine().catch(err =>
      console.error(`${ENGINE_LABEL} scheduled run failed:`, err.message)
    );
  }, intervalMs);

  console.log(`${ENGINE_LABEL} scheduler started (interval=${intervalMs / 60000}min)`);
}

function stopPremarketIntelligenceScheduler() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    console.log(`${ENGINE_LABEL} scheduler stopped`);
  }
}

module.exports = {
  runPremarketIntelligenceEngine,
  startPremarketIntelligenceScheduler,
  stopPremarketIntelligenceScheduler,
};
