const fs = require('fs');
const path = require('path');
const { queryWithTimeout } = require('../../db/pg');

const earningsSql = fs.readFileSync(path.join(__dirname, '..', 'queries', 'earnings.sql'), 'utf8');

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function getEarningsRows() {
  const result = await queryWithTimeout(earningsSql, [], {
    timeoutMs: 4000,
    label: 'v2.earnings',
    maxRetries: 0,
  });

  return (result.rows || []).map((row) => ({
    symbol: row.symbol || null,
    earnings_date: row.earnings_date || null,
    eps_estimate: toNumber(row.eps_estimate),
    eps_actual: toNumber(row.eps_actual),
    days_to_earnings: toNumber(row.days_to_earnings),
  }));
}

module.exports = {
  getEarningsRows,
};