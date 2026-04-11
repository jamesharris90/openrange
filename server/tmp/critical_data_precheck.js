const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
}

const { pool } = require('../db/pg');

const SYMBOLS = ['AAPL', 'INTC', 'NVDA'];

const TABLE_CHECKS = [
  {
    table: 'news_articles',
    columns: ['id', 'symbol', 'headline', 'title', 'published_at', 'url', 'source', 'symbols'],
    symbolColumn: 'symbol',
  },
  {
    table: 'earnings_events',
    columns: ['symbol', 'report_date', 'report_time', 'eps_estimate', 'eps_actual', 'expected_move_percent', 'updated_at'],
    symbolColumn: 'symbol',
  },
  {
    table: 'earnings_history',
    columns: ['symbol', 'report_date', 'eps_actual', 'eps_estimate'],
    symbolColumn: 'symbol',
  },
  {
    table: 'data_coverage',
    columns: ['symbol', 'coverage_score', 'has_news', 'has_earnings', 'has_technicals', 'last_news_at', 'last_earnings_at'],
    symbolColumn: 'symbol',
  },
  {
    table: 'daily_ohlcv',
    columns: ['symbol', 'date', 'close'],
    symbolColumn: 'symbol',
  },
  {
    table: 'market_quotes',
    columns: ['symbol', 'price', 'updated_at'],
    symbolColumn: 'symbol',
  },
];

async function tableExists(tableName) {
  const result = await pool.query('SELECT to_regclass($1) AS name', [`public.${tableName}`]);
  return Boolean(result.rows?.[0]?.name);
}

async function readColumns(tableName) {
  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1`,
    [tableName],
  );
  return new Set((result.rows || []).map((row) => row.column_name));
}

async function readTotalCount(tableName) {
  const result = await pool.query(`SELECT COUNT(*)::bigint AS count FROM ${tableName}`);
  return Number(result.rows?.[0]?.count || 0);
}

async function readSymbolCounts(tableName, symbolColumn) {
  if (!symbolColumn) {
    return {};
  }

  const result = await pool.query(
    `SELECT UPPER(${symbolColumn}) AS symbol, COUNT(*)::bigint AS count
     FROM ${tableName}
     WHERE UPPER(${symbolColumn}) = ANY($1::text[])
     GROUP BY UPPER(${symbolColumn})`,
    [SYMBOLS],
  );

  const counts = Object.fromEntries(SYMBOLS.map((symbol) => [symbol, 0]));
  for (const row of result.rows || []) {
    counts[String(row.symbol || '').toUpperCase()] = Number(row.count || 0);
  }
  return counts;
}

async function readCoverageRows() {
  const result = await pool.query(
    `SELECT symbol, coverage_score, has_news, has_earnings, has_technicals, last_news_at, last_earnings_at, last_checked
     FROM data_coverage
     WHERE UPPER(symbol) = ANY($1::text[])
     ORDER BY symbol ASC`,
    [SYMBOLS],
  );
  return result.rows || [];
}

async function readRecentNewsRows() {
  const result = await pool.query(
    `SELECT UPPER(symbol) AS symbol, MAX(published_at) AS latest_published_at
     FROM news_articles
     WHERE UPPER(symbol) = ANY($1::text[])
     GROUP BY UPPER(symbol)`,
    [SYMBOLS],
  );
  return result.rows || [];
}

async function readRecentEarningsRows() {
  const result = await pool.query(
    `SELECT UPPER(symbol) AS symbol,
            MAX(report_date) AS latest_report_date,
            COUNT(*) FILTER (WHERE report_date >= CURRENT_DATE) AS upcoming_count
     FROM earnings_events
     WHERE UPPER(symbol) = ANY($1::text[])
     GROUP BY UPPER(symbol)`,
    [SYMBOLS],
  );
  return result.rows || [];
}

async function main() {
  const report = {
    ok: true,
    checked_at: new Date().toISOString(),
    symbols: SYMBOLS,
    tables: [],
    symbol_samples: {
      coverage: [],
      news: [],
      earnings: [],
    },
  };

  for (const check of TABLE_CHECKS) {
    const exists = await tableExists(check.table);
    const entry = {
      table: check.table,
      exists,
      columns: {},
      row_count: 0,
      symbol_counts: Object.fromEntries(SYMBOLS.map((symbol) => [symbol, 0])),
    };

    if (exists) {
      const columns = await readColumns(check.table);
      for (const column of check.columns) {
        entry.columns[column] = columns.has(column);
      }
      entry.row_count = await readTotalCount(check.table);
      entry.symbol_counts = await readSymbolCounts(check.table, check.symbolColumn);
    } else {
      report.ok = false;
    }

    report.tables.push(entry);
  }

  if (report.tables.find((entry) => entry.table === 'data_coverage')?.exists) {
    report.symbol_samples.coverage = await readCoverageRows();
  }
  if (report.tables.find((entry) => entry.table === 'news_articles')?.exists) {
    report.symbol_samples.news = await readRecentNewsRows();
  }
  if (report.tables.find((entry) => entry.table === 'earnings_events')?.exists) {
    report.symbol_samples.earnings = await readRecentEarningsRows();
  }

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      checked_at: new Date().toISOString(),
      error: error.message,
      stack: error.stack,
    }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch {
      // Ignore shutdown errors during validation.
    }
  });