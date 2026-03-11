const { queryWithTimeout } = require('../db/pg');
const EVENT_TYPES = require('../events/eventTypes');
const eventBus = require('../events/eventBus');
const logger = require('../logger');

function minuteDiff(a, b) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

async function runCandleIntegrityEngine(limit = 40) {
  const startedAt = Date.now();
  const warnings = [];

  try {
    const { rows: symbols } = await queryWithTimeout(
      `SELECT symbol
       FROM market_quotes
       WHERE symbol IS NOT NULL AND symbol <> ''
       ORDER BY COALESCE(volume, 0) DESC NULLS LAST
       LIMIT $1`,
      [Math.max(1, Math.min(Number(limit) || 40, 200))],
      { timeoutMs: 5000, label: 'integrity.candle.symbols', maxRetries: 0 }
    );

    for (const entry of symbols || []) {
      const symbol = String(entry.symbol || '').toUpperCase();
      if (!symbol) continue;

      const { rows } = await queryWithTimeout(
        `SELECT timestamp
         FROM intraday_1m
         WHERE symbol = $1
         ORDER BY timestamp DESC
         LIMIT 90`,
        [symbol],
        { timeoutMs: 3000, label: 'integrity.candle.intraday', maxRetries: 0 }
      );

      const ordered = (rows || []).slice().reverse();
      for (let i = 1; i < ordered.length; i += 1) {
        const prev = ordered[i - 1].timestamp;
        const curr = ordered[i].timestamp;
        const delta = minuteDiff(prev, curr);
        if (delta > 1 && delta <= 5) {
          warnings.push({
            symbol,
            issue: 'missing_candle',
            severity: 'medium',
            timeframe: '1m',
            gap_minutes: delta,
            previous_timestamp: prev,
            current_timestamp: curr,
          });
        }
      }
    }

    for (const warning of warnings) {
      eventBus.emit(EVENT_TYPES.DATA_INTEGRITY_WARNING, {
        source: 'candle_integrity_engine',
        ...warning,
        timestamp: new Date().toISOString(),
      });
    }

    return {
      ok: true,
      checked_symbols: (symbols || []).length,
      warnings,
      execution_time_ms: Date.now() - startedAt,
      last_run: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('[ENGINE ERROR] candle_integrity_engine failed', { error: error.message });
    return {
      ok: false,
      checked_symbols: 0,
      warnings,
      error: error.message,
      execution_time_ms: Date.now() - startedAt,
      last_run: new Date().toISOString(),
    };
  }
}

module.exports = {
  runCandleIntegrityEngine,
};
