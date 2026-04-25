const {
  buildUniverseClause,
  createResultMap,
  queryWithTimeout,
  toNumber,
} = require('./_helpers');

const SIGNAL_NAME = 'earnings_upcoming_within_3d';
const CATEGORY = 'earnings';
const RUN_MODE = 'leaderboard';
const TOP_N = 100;
const WINDOW_DAYS = 3;

function daysUntil(dateOnly, now = new Date()) {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const [year, month, day] = String(dateOnly).split('-').map(Number);
  const eventUtc = Date.UTC(year, month - 1, day);
  return Math.round((eventUtc - todayUtc) / 86400000);
}

async function detect(universe = [], options = {}) {
  const topN = Number(options.topN || TOP_N);
  const windowDays = Number(options.windowDays || WINDOW_DAYS);
  const universeFilter = buildUniverseClause(universe, 3);

  const result = await queryWithTimeout(
    `
      SELECT
        UPPER(symbol) AS symbol,
        company,
        COALESCE(earnings_date, report_date) AS earnings_date,
        COALESCE(time, report_time) AS report_time,
        exchange,
        price,
        avg_volume,
        market_cap,
        source,
        updated_at,
        (COALESCE(earnings_date, report_date) - CURRENT_DATE)::int AS days_until_earnings,
        COALESCE(expected_move_percent, 0)::numeric AS expected_move_percent
      FROM earnings_events
      WHERE symbol IS NOT NULL
        AND COALESCE(earnings_date, report_date) >= CURRENT_DATE
        AND COALESCE(earnings_date, report_date) <= CURRENT_DATE + ($1::int * interval '1 day')
        ${universeFilter.clause}
      ORDER BY days_until_earnings ASC, expected_move_percent DESC NULLS LAST, market_cap DESC NULLS LAST
      LIMIT $2
    `,
    [windowDays, topN, ...universeFilter.params],
    {
      label: 'beacon_v0.signal.earnings_upcoming_within_3d',
      timeoutMs: 10000,
      slowQueryMs: 1000,
      poolType: 'read',
      maxRetries: 1,
    },
  );

  return createResultMap(result.rows, (row, index) => {
    const daysUntilEarnings = toNumber(row.days_until_earnings);
    const expectedMovePercent = toNumber(row.expected_move_percent) || 0;
    return {
      symbol: row.symbol,
      signal: SIGNAL_NAME,
      rank: index + 1,
      score: ((WINDOW_DAYS + 1) - Math.max(daysUntilEarnings || 0, 0)) * 10 + expectedMovePercent,
      metadata: {
        company: row.company,
        earnings_date: row.earnings_date,
        report_time: row.report_time,
        days_until_earnings: daysUntilEarnings,
        exchange: row.exchange,
        price: toNumber(row.price),
        average_volume: toNumber(row.avg_volume),
        market_cap: toNumber(row.market_cap),
        expected_move_percent: expectedMovePercent,
        source: row.source,
        updated_at: row.updated_at,
      },
      reasoning: `Earnings scheduled within ${daysUntilEarnings} day${daysUntilEarnings === 1 ? '' : 's'}`,
    };
  });
}

function summarize(metadata = {}) {
  const days = toNumber(metadata.days_until_earnings ?? metadata.days_until);
  if (days == null) return null;
  if (days === 0) return 'earnings today';
  if (days === 1) return 'earnings tomorrow';
  return `earnings in ${days} days`;
}

module.exports = {
  CATEGORY,
  RUN_MODE,
  SIGNAL_NAME,
  TOP_N,
  WINDOW_DAYS,
  daysUntil,
  detect,
  summarize,
};