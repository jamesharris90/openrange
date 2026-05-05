const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

const TABLE_CHECK_TTL_MS = 5 * 60 * 1000;

let earningsHistoryTableState = {
  checkedAt: 0,
  exists: null,
};

async function upsertDataStaleFlag(message, metadata = {}) {
  try {
    await queryWithTimeout(
      `
        INSERT INTO system_flags (source_name, flag_type, severity, message, metadata)
        VALUES ('historicalMoveCalculator', 'data_stale', 'info', $1, $2::jsonb)
        ON CONFLICT (source_name, flag_type) WHERE resolved_at IS NULL
        DO UPDATE SET
          severity = EXCLUDED.severity,
          message = EXCLUDED.message,
          metadata = EXCLUDED.metadata,
          last_detected_at = NOW()
      `,
      [message, JSON.stringify(metadata)],
      {
        label: 'calendar.historical_moves.flag',
        timeoutMs: 5000,
        maxRetries: 0,
        poolType: 'write',
      },
    );
  } catch (error) {
    logger.warn('failed to persist historical move system flag', { error: error.message, metadata });
  }
}

async function earningsHistoryTableExists() {
  if (Date.now() - earningsHistoryTableState.checkedAt < TABLE_CHECK_TTL_MS && earningsHistoryTableState.exists !== null) {
    return earningsHistoryTableState.exists;
  }

  const result = await queryWithTimeout(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'earnings_history'
      ) AS exists
    `,
    [],
    {
      label: 'calendar.historical_moves.table_exists',
      timeoutMs: 5000,
      maxRetries: 0,
      poolType: 'read',
    },
  );

  earningsHistoryTableState = {
    checkedAt: Date.now(),
    exists: Boolean(result.rows[0]?.exists),
  };
  return earningsHistoryTableState.exists;
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function computeMoveFromRow(row) {
  const prePrice = toFiniteNumber(row.pre_price);
  const postPrice = toFiniteNumber(row.post_price);
  if (prePrice && prePrice > 0 && postPrice && postPrice > 0) {
    return Math.abs(((postPrice - prePrice) / prePrice) * 100);
  }

  const actualMove = toFiniteNumber(row.actual_move_percent);
  if (actualMove !== null) return Math.abs(actualMove);

  const postMove = toFiniteNumber(row.post_move_percent);
  if (postMove !== null) return Math.abs(postMove);

  return null;
}

function average(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function fetchHistoricalRows(symbols) {
  return queryWithTimeout(
    `
      WITH ranked AS (
        SELECT
          symbol,
          report_date,
          pre_price,
          post_price,
          actual_move_percent,
          post_move_percent,
          ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY report_date DESC) AS row_num
        FROM earnings_history
        WHERE symbol = ANY($1::text[])
      )
      SELECT symbol, report_date, pre_price, post_price, actual_move_percent, post_move_percent
      FROM ranked
      WHERE row_num <= 8
      ORDER BY symbol ASC, report_date DESC
    `,
    [symbols],
    {
      label: 'calendar.historical_moves.batch',
      timeoutMs: 10000,
      maxRetries: 1,
      poolType: 'read',
    },
  );
}

/**
 * Compute a single-symbol average historical earnings move.
 * Returns null when the table is missing or the symbol lacks enough data.
 */
async function computeAvgHistoricalMove(symbol, eventType) {
  if (String(eventType || '').trim().toUpperCase() !== 'EARNINGS') {
    return null;
  }

  const results = await computeAvgHistoricalMoveForSymbols([symbol]);
  return results.get(String(symbol || '').trim().toUpperCase()) ?? null;
}

/**
 * Compute average historical earnings moves for a batch of symbols at request time.
 * TODO impl-30 phase 3: cache historical moves in a daily-rebuilt table.
 */
async function computeAvgHistoricalMoveForSymbols(symbols) {
  const normalizedSymbols = [...new Set((symbols || []).map((symbol) => String(symbol || '').trim().toUpperCase()).filter(Boolean))];
  const result = new Map();

  if (normalizedSymbols.length === 0) {
    return result;
  }

  if (!(await earningsHistoryTableExists())) {
    await upsertDataStaleFlag('earnings_history table missing; avgHistoricalMove falling back to null', {
      symbols: normalizedSymbols.length,
      reason: 'table_missing',
    });
    return result;
  }

  const rows = await fetchHistoricalRows(normalizedSymbols);
  if (rows.rows.length === 0) {
    await upsertDataStaleFlag('earnings_history has no usable rows for requested symbols', {
      symbols: normalizedSymbols,
      reason: 'no_rows',
    });
    return result;
  }

  const bySymbol = new Map();
  rows.rows.forEach((row) => {
    const normalizedSymbol = String(row.symbol || '').trim().toUpperCase();
    if (!bySymbol.has(normalizedSymbol)) {
      bySymbol.set(normalizedSymbol, []);
    }
    const move = computeMoveFromRow(row);
    if (move !== null) {
      bySymbol.get(normalizedSymbol).push(move);
    }
  });

  normalizedSymbols.forEach((symbolValue) => {
    const moves = bySymbol.get(symbolValue) || [];
    if (moves.length >= 2) {
      result.set(symbolValue, Number(average(moves).toFixed(2)));
    }
  });

  if (result.size === 0) {
    await upsertDataStaleFlag('earnings_history lacks enough observations to compute avgHistoricalMove', {
      symbols: normalizedSymbols,
      reason: 'insufficient_rows',
    });
  }

  return result;
}

module.exports = {
  computeAvgHistoricalMove,
  computeAvgHistoricalMoveForSymbols,
};