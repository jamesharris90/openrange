const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { fmpFetch } = require('./fmpClient');

function normalizeBars(payload, symbol) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .map((row) => ({
      symbol,
      timestamp: row.date || row.datetime || row.timestamp || null,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume) || 0,
    }))
    .filter((row) => row.timestamp && Number.isFinite(row.open) && Number.isFinite(row.high) && Number.isFinite(row.low) && Number.isFinite(row.close));
}

async function getCoverageCount(symbol, sinceTs) {
  const { rows } = await queryWithTimeout(
    `SELECT COUNT(*)::int AS bar_count
     FROM intraday_1m
     WHERE symbol = $1
       AND timestamp > $2`,
    [symbol, sinceTs],
    { timeoutMs: 7000, label: 'intraday_backfill.coverage_count', maxRetries: 0, poolType: 'read' }
  );

  return Number(rows?.[0]?.bar_count || 0);
}

async function insertBars(rows) {
  if (!rows.length) return 0;

  const payload = JSON.stringify(rows);
  const result = await queryWithTimeout(
    `INSERT INTO intraday_1m
       (symbol, timestamp, open, high, low, close, volume)
     SELECT x.symbol, x.timestamp, x.open, x.high, x.low, x.close, x.volume
     FROM jsonb_to_recordset($1::jsonb)
       AS x(symbol text, timestamp timestamptz, open numeric, high numeric, low numeric, close numeric, volume numeric)
     ON CONFLICT (symbol, timestamp) DO NOTHING`,
    [payload],
    { timeoutMs: 12000, label: 'intraday_backfill.insert_bars', maxRetries: 0, poolType: 'write' }
  );

  return Number(result?.rowCount || 0);
}

async function ensureIntradayCoverage(rawSymbol, sinceTs) {
  const symbol = String(rawSymbol || '').trim().toUpperCase();
  if (!symbol || !sinceTs) {
    return { symbol, sinceTs, covered: false, reason: 'invalid_input', existingCount: 0, inserted: 0 };
  }

  const existingCount = await getCoverageCount(symbol, sinceTs);
  if (existingCount > 0) {
    return { symbol, sinceTs, covered: true, source: 'existing', existingCount, inserted: 0 };
  }

  try {
    const payload = await fmpFetch(`/historical-chart/1min/${symbol}`);
    const normalized = normalizeBars(payload, symbol).filter((row) => new Date(row.timestamp) > new Date(sinceTs));
    const inserted = await insertBars(normalized);

    return {
      symbol,
      sinceTs,
      covered: inserted > 0,
      source: 'backfill',
      existingCount,
      fetched: normalized.length,
      inserted,
    };
  } catch (error) {
    logger.warn('[INTRADAY_BACKFILL] failed', { symbol, error: error.message });
    return {
      symbol,
      sinceTs,
      covered: false,
      source: 'backfill_error',
      existingCount,
      inserted: 0,
      error: error.message,
    };
  }
}

module.exports = {
  ensureIntradayCoverage,
};
