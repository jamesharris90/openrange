const { fetchUpcomingEarningsWithinDays } = require('../data/earnings');

const SIGNAL_NAME = 'earnings_upcoming_within_3d';

function daysUntil(dateOnly, now = new Date()) {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const [year, month, day] = String(dateOnly).split('-').map(Number);
  const eventUtc = Date.UTC(year, month - 1, day);
  return Math.round((eventUtc - todayUtc) / 86400000);
}

function toEarningsUpcomingSignal(row, options = {}) {
  const daysUntilEarnings = daysUntil(row.earningsDate, options.now || new Date());

  return {
    symbol: row.symbol,
    signal: SIGNAL_NAME,
    signalCategory: 'earnings',
    direction: 'neutral',
    fired: daysUntilEarnings >= 0 && daysUntilEarnings <= 3,
    detectedAt: new Date().toISOString(),
    reason: `${row.symbol} has earnings scheduled within ${daysUntilEarnings} day${daysUntilEarnings === 1 ? '' : 's'}.`,
    evidence: {
      company: row.company,
      earningsDate: row.earningsDate,
      reportTime: row.reportTime,
      daysUntilEarnings,
      exchange: row.exchange,
      price: row.price,
      averageVolume: row.averageVolume,
      marketCap: row.marketCap,
      source: row.source,
      updatedAt: row.updatedAt,
    },
  };
}

async function detectUpcomingEarningsWithin3d(options = {}) {
  const earningsRows = await fetchUpcomingEarningsWithinDays({
    ...options,
    windowDays: 3,
  });

  return earningsRows
    .map((row) => toEarningsUpcomingSignal(row, options))
    .filter((signal) => signal.fired);
}

module.exports = {
  SIGNAL_NAME,
  daysUntil,
  detectUpcomingEarningsWithin3d,
  toEarningsUpcomingSignal,
};