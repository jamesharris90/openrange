const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

let ensureTablePromise = null;

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseCatalystType(signal = {}) {
  const direct = String(signal.catalyst_type || '').trim();
  if (direct) return direct.toUpperCase();

  const why = String(signal.why || '').trim();
  const match = why.match(/catalyst\s*:\s*([a-z_ -]+)/i);
  if (!match) return 'UNKNOWN';

  return String(match[1] || '')
    .trim()
    .replace(/\s+/g, '_')
    .toUpperCase() || 'UNKNOWN';
}

function parseEntryPrice(signal = {}) {
  return (
    toNumberOrNull(signal.entry_price)
    ?? toNumberOrNull(signal.price)
    ?? toNumberOrNull(signal.current_price)
    ?? toNumberOrNull(signal.last_price)
    ?? toNumberOrNull(signal.close)
  );
}

async function ensureBacktestSignalsTable() {
  if (!ensureTablePromise) {
    ensureTablePromise = (async () => {
      await queryWithTimeout(
        `CREATE TABLE IF NOT EXISTS backtest_signals (
          id BIGSERIAL PRIMARY KEY,
          symbol TEXT,
          signal_timestamp TIMESTAMP,
          confidence NUMERIC,
          catalyst_type TEXT,
          entry_price NUMERIC,
          max_upside_pct NUMERIC,
          max_drawdown_pct NUMERIC,
          close_price NUMERIC,
          result TEXT,
          evaluated BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )`,
        [],
        {
          timeoutMs: 6000,
          maxRetries: 0,
          slowQueryMs: 1000,
          label: 'services.backtest_logger.ensure_table',
        }
      );

      await queryWithTimeout(
        `CREATE INDEX IF NOT EXISTS idx_backtest_signals_symbol_signal_timestamp
         ON backtest_signals (symbol, signal_timestamp)`,
        [],
        {
          timeoutMs: 6000,
          maxRetries: 0,
          slowQueryMs: 1000,
          label: 'services.backtest_logger.ensure_index',
        }
      );
    })().catch((error) => {
      ensureTablePromise = null;
      throw error;
    });
  }

  return ensureTablePromise;
}

async function logSignalsForBacktest(signals = []) {
  try {
    await ensureBacktestSignalsTable();

    if (!Array.isArray(signals) || signals.length === 0) return { inserted: 0 };

    let inserted = 0;

    for (const signal of signals) {
      const symbol = String(signal?.symbol || '').trim().toUpperCase();
      if (!symbol) continue;

      const confidence = toNumberOrNull(signal?.confidence);
      const catalystType = parseCatalystType(signal);
      const entryPrice = parseEntryPrice(signal);

      const result = await queryWithTimeout(
        `INSERT INTO backtest_signals (
          symbol,
          signal_timestamp,
          confidence,
          catalyst_type,
          entry_price
        ) VALUES ($1, NOW(), $2, $3, $4)`,
        [symbol, confidence, catalystType, entryPrice],
        {
          timeoutMs: 1500,
          maxRetries: 0,
          slowQueryMs: 400,
          label: 'services.backtest_logger.insert',
        }
      );

      inserted += Number(result?.rowCount || 0);
    }

    return { inserted };
  } catch (error) {
    logger.warn('backtest signal logging failed', {
      scope: 'backtest_logger',
      error: error.message,
      signal_count: Array.isArray(signals) ? signals.length : 0,
    });

    return { inserted: 0, error: error.message };
  }
}

module.exports = {
  ensureBacktestSignalsTable,
  logSignalsForBacktest,
};
