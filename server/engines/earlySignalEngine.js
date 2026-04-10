const { getLatestTick } = require('./liveTickEngine');
const { queryWithTimeout } = require('../db/pg');

const recentSignals = new Map();
const DEDUPE_WINDOW_MS = 60 * 1000;

function clearExpiredDedupeKeys(nowMs) {
  for (const [key, timestamp] of recentSignals.entries()) {
    if (nowMs - Number(timestamp || 0) > DEDUPE_WINDOW_MS) {
      recentSignals.delete(key);
    }
  }
}

async function runEarlySignalEngine(symbols = []) {
  if (!Array.isArray(symbols) || symbols.length === 0) return;

  const nowMs = Date.now();
  clearExpiredDedupeKeys(nowMs);

  for (const rawSymbol of symbols) {
    const symbol = String(rawSymbol || '').trim().toUpperCase();
    if (!symbol) continue;

    const tick = getLatestTick(symbol);
    if (!tick) continue;

    const dedupeKey = `${symbol}_${Math.floor(nowMs / DEDUPE_WINDOW_MS)}`;
    if (recentSignals.has(dedupeKey)) continue;

    let signalType = null;
    let strength = 0;

    if (tick.volume > 500000) {
      signalType = 'EARLY_VOLUME';
      strength = 1;
    }

    if (tick.price > 0 && tick.volume > 1000000) {
      signalType = 'PRICE_SURGE';
      strength = 2;
    }

    if (!signalType) continue;

    try {
      await queryWithTimeout(
        `INSERT INTO early_signals
          (symbol, signal_type, signal_strength, price_at_signal, volume_at_signal)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [symbol, signalType, strength, tick.price, tick.volume],
        {
          label: 'early_signal_engine.insert',
          timeoutMs: 4000,
          maxRetries: 1,
          retryDelayMs: 150,
          poolType: 'write',
        }
      );

      recentSignals.set(dedupeKey, nowMs);
      console.log('[EARLY SIGNAL INSERTED]', { symbol, signal_type: signalType, signal_strength: strength });
    } catch (error) {
      console.error('[EARLY SIGNAL ENGINE ERROR]', error.message);
    }
  }
}

module.exports = { runEarlySignalEngine };
