const { queryWithTimeout } = require('../db/pg');

async function q(sql, params = [], label = 'phase2.precheck', timeoutMs = 15000) {
  const result = await queryWithTimeout(sql, params, { timeoutMs, label, maxRetries: 0 });
  return result.rows || [];
}

async function main() {
  const requiredTables = [
    'ticker_universe',
    'daily_ohlcv',
    'intraday_1m',
    'news_articles',
    'earnings_history',
    'backtest_signals',
    'strategy_scores',
    'morning_picks',
  ];

  const existingTables = await q(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])
     ORDER BY table_name`,
    [requiredTables],
    'phase2.precheck.tables'
  );

  const columnRows = await q(
    `SELECT table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])
     ORDER BY table_name, ordinal_position`,
    [requiredTables],
    'phase2.precheck.columns'
  );

  const counts = {};
  for (const table of ['ticker_universe', 'daily_ohlcv', 'intraday_1m', 'news_articles', 'earnings_history']) {
    const rows = await q(`SELECT COUNT(*)::bigint AS row_count FROM ${table}`, [], `phase2.precheck.count.${table}`, 30000);
    counts[table] = rows[0]?.row_count ?? null;
  }

  const existing = new Set(existingTables.map((row) => row.table_name));
  const columns = {};
  for (const row of columnRows) {
    if (!columns[row.table_name]) columns[row.table_name] = [];
    columns[row.table_name].push({ column_name: row.column_name, data_type: row.data_type });
  }

  const report = {
    generated_at: new Date().toISOString(),
    required_tables: requiredTables,
    existing_tables: Array.from(existing).sort(),
    missing_tables: requiredTables.filter((name) => !existing.has(name)),
    row_counts: counts,
    columns,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});