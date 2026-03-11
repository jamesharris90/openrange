const { queryWithTimeout } = require('../db/pg');

const TABLES = [
  'intraday_1m',
  'market_quotes',
  'news_articles',
  'earnings_events',
  'trade_setups',
  'trade_catalysts',
  'opportunity_stream',
];

async function countTable(name) {
  try {
    const result = await queryWithTimeout(
      `SELECT COUNT(*)::int AS count FROM ${name}`,
      [],
      { timeoutMs: 3000, label: `system.data_health.${name}`, maxRetries: 0 }
    );
    return Number(result.rows?.[0]?.count || 0);
  } catch (_error) {
    return 0;
  }
}

async function getDataHealth() {
  const entries = await Promise.all(
    TABLES.map(async (name) => [name, await countTable(name)])
  );

  const tables = Object.fromEntries(entries);
  const hasZero = Object.values(tables).some((value) => Number(value || 0) === 0);

  return {
    status: hasZero ? 'warning' : 'ok',
    tables,
  };
}

module.exports = {
  TABLES,
  getDataHealth,
};
