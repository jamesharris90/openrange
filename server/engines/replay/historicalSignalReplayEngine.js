'use strict';

/**
 * server/engines/replay/historicalSignalReplayEngine.js
 *
 * Historical Signal Replay Engine — Phase D
 *
 * Reads daily_ohlc data and generates synthetic trading signals for
 * symbols that meet entry criteria. Signals are inserted into
 * signal_registry with source = 'replay' so the outcome engine can
 * evaluate them and expand the calibration dataset.
 *
 * Run schedule: nightly at 02:00 via startEngines.js
 */

const { queryWithTimeout } = require('../../db/pg');

/**
 * Classify a daily OHLC bar into a strategy label.
 * @param {object} row
 * @returns {string|null} strategy label or null if no signal
 */
function classifySignal(row) {
  const { open, high, low, close } = row;
  if (!open || !high || !low || !close) return null;

  const range    = high - low;
  const bodySize = Math.abs(close - open);
  const bodyPct  = range > 0 ? bodySize / range : 0;

  // ORB — close breaks above 75% of the day's range, with decent body
  if (close > open && close >= low + range * 0.75 && bodyPct >= 0.4) {
    return 'ORB';
  }

  // VWAP Reclaim — close meaningfully above open (proxy for VWAP reclaim day)
  if (close > open * 1.015) {
    return 'VWAP Reclaim';
  }

  // Momentum Continuation — strong bullish close relative to low
  if (close > low * 1.02 && close > open) {
    return 'Momentum Continuation';
  }

  return null;
}

async function runHistoricalReplay() {
  console.log('[REPLAY ENGINE] starting historical signal generation');

  // Fetch last 5,000 daily bars across all symbols, newest first
  const { rows } = await queryWithTimeout(
    `SELECT symbol, open, high, low, close, date
       FROM daily_ohlc
      WHERE close IS NOT NULL
        AND high  IS NOT NULL
        AND low   IS NOT NULL
        AND open  IS NOT NULL
      ORDER BY date DESC
      LIMIT 5000`,
    [],
    { timeoutMs: 30000, label: 'replay_engine.select_ohlc', maxRetries: 1 }
  );

  let inserted = 0;
  let skipped  = 0;

  for (const row of rows) {
    const strategy = classifySignal(row);
    if (!strategy) {
      skipped += 1;
      continue;
    }

    try {
      const result = await queryWithTimeout(
        `INSERT INTO signal_registry
           (symbol, strategy, entry_price, entry_time, source)
         VALUES ($1, $2, $3, $4::date, 'replay')
         ON CONFLICT DO NOTHING`,
        [row.symbol, strategy, row.close, row.date],
        { timeoutMs: 8000, label: 'replay_engine.insert', maxRetries: 0 }
      );
      if (result?.rowCount > 0) inserted += 1;
    } catch (err) {
      // Log individual insert failures but keep processing
      console.error('[REPLAY ENGINE] insert error for', row.symbol, row.date, err.message);
    }
  }

  console.log(
    `[REPLAY ENGINE] replay complete — inserted: ${inserted}, skipped (no signal): ${skipped}, scanned: ${rows.length}`
  );

  return { inserted, skipped, scanned: rows.length };
}

module.exports = { runHistoricalReplay };
