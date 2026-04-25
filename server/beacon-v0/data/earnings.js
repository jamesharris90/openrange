const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '../../.env'),
  override: false,
});

const { queryWithTimeout } = require('../../db/pg');

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toDateOnly(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function normalizeEarningsRow(row) {
  return {
    symbol: normalizeSymbol(row.symbol),
    company: row.company || null,
    earningsDate: toDateOnly(row.earnings_date),
    reportTime: row.report_time || null,
    exchange: row.exchange || null,
    price: toNumber(row.price),
    averageVolume: toNumber(row.avg_volume),
    marketCap: toNumber(row.market_cap),
    source: row.source || null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

async function fetchUpcomingEarningsWithinDays(options = {}) {
  const windowDays = Number(options.windowDays ?? 3);
  const limit = Number(options.limit ?? 500);
  const symbols = Array.isArray(options.symbols)
    ? options.symbols.map(normalizeSymbol).filter(Boolean)
    : [];

  if (!Number.isInteger(windowDays) || windowDays < 0 || windowDays > 30) {
    throw new Error('windowDays must be an integer between 0 and 30');
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
    throw new Error('limit must be an integer between 1 and 5000');
  }

  const params = [windowDays, limit];
  const symbolFilter = symbols.length > 0
    ? 'AND UPPER(symbol) = ANY($3::text[])'
    : '';
  if (symbols.length > 0) params.push(symbols);

  const result = await queryWithTimeout(
    `
      SELECT
        symbol,
        company,
        COALESCE(earnings_date, report_date) AS earnings_date,
        COALESCE(time, report_time) AS report_time,
        exchange,
        price,
        avg_volume,
        market_cap,
        source,
        updated_at
      FROM earnings_events
      WHERE symbol IS NOT NULL
        AND COALESCE(earnings_date, report_date) >= CURRENT_DATE
        AND COALESCE(earnings_date, report_date) <= CURRENT_DATE + ($1::int * interval '1 day')
        ${symbolFilter}
      ORDER BY COALESCE(earnings_date, report_date), symbol
      LIMIT $2
    `,
    params,
    {
      label: 'beacon-v0.fetchUpcomingEarningsWithinDays',
      timeoutMs: Number(options.timeoutMs ?? 5000),
      slowQueryMs: Number(options.slowQueryMs ?? 1000),
      poolType: 'read',
      maxRetries: Number(options.maxRetries ?? 1),
    },
  );

  return result.rows.map(normalizeEarningsRow).filter((row) => row.symbol && row.earningsDate);
}

module.exports = {
  fetchUpcomingEarningsWithinDays,
  normalizeEarningsRow,
};