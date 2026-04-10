const { queryWithTimeout } = require('../db/pg');

async function tableExists(tableName) {
  const result = await queryWithTimeout(
    `SELECT to_regclass($1) AS name`,
    [`public.${tableName}`],
    { timeoutMs: 7000, label: `phase1.table_exists.${tableName}`, maxRetries: 0 }
  ).catch(() => ({ rows: [{ name: null }] }));
  return Boolean(result.rows?.[0]?.name);
}

async function run() {
  const output = {};

  output.tables = (await queryWithTimeout(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    [],
    { timeoutMs: 15000, label: 'phase1.tables', maxRetries: 0 }
  ).catch(() => ({ rows: [] }))).rows;

  const tickerUniverseExists = await tableExists('ticker_universe');
  output.ticker_universe = { exists: tickerUniverseExists };
  if (tickerUniverseExists) {
    output.ticker_universe.total_symbols = (await queryWithTimeout(
      `SELECT COUNT(*)::int AS total_symbols FROM ticker_universe`,
      [],
      { timeoutMs: 7000, label: 'phase1.ticker_universe.count', maxRetries: 0 }
    )).rows?.[0] || null;
    output.ticker_universe.sample = (await queryWithTimeout(
      `SELECT * FROM ticker_universe LIMIT 10`,
      [],
      { timeoutMs: 7000, label: 'phase1.ticker_universe.sample', maxRetries: 0 }
    ).catch(() => ({ rows: [] }))).rows;
  }

  const dailyExists = await tableExists('daily_ohlcv');
  output.daily_ohlcv = { exists: dailyExists };
  if (dailyExists) {
    output.daily_ohlcv.count = (await queryWithTimeout(
      `SELECT COUNT(*)::bigint AS total_rows FROM daily_ohlcv`,
      [],
      { timeoutMs: 7000, label: 'phase1.daily_ohlcv.count', maxRetries: 0 }
    )).rows?.[0] || null;
    output.daily_ohlcv.range = (await queryWithTimeout(
      `SELECT MIN(date) AS min_date, MAX(date) AS max_date, COUNT(DISTINCT symbol)::int AS symbols FROM daily_ohlcv`,
      [],
      { timeoutMs: 7000, label: 'phase1.daily_ohlcv.range', maxRetries: 0 }
    )).rows?.[0] || null;
    output.daily_ohlcv.columns = (await queryWithTimeout(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'daily_ohlcv' ORDER BY ordinal_position`,
      [],
      { timeoutMs: 7000, label: 'phase1.daily_ohlcv.columns', maxRetries: 0 }
    )).rows;
  }

  const intradayExists = await tableExists('intraday_1m');
  output.intraday_1m = { exists: intradayExists };
  if (intradayExists) {
    output.intraday_1m.latest_bar = (await queryWithTimeout(
      `SELECT MAX(timestamp) AS latest_bar FROM intraday_1m`,
      [],
      { timeoutMs: 7000, label: 'phase1.intraday.latest_bar', maxRetries: 0 }
    )).rows?.[0] || null;
    output.intraday_1m.total_bars = (await queryWithTimeout(
      `SELECT COUNT(*)::bigint AS total_bars FROM intraday_1m`,
      [],
      { timeoutMs: 7000, label: 'phase1.intraday.total_bars', maxRetries: 0 }
    )).rows?.[0] || null;
    output.intraday_1m.symbols_with_data = (await queryWithTimeout(
      `SELECT COUNT(DISTINCT symbol)::int AS symbols_with_data FROM intraday_1m`,
      [],
      { timeoutMs: 7000, label: 'phase1.intraday.symbols', maxRetries: 0 }
    )).rows?.[0] || null;
  }

  const catalystExists = await tableExists('catalyst_signals');
  output.catalyst_signals = { exists: catalystExists };
  if (catalystExists) {
    output.catalyst_signals.count = (await queryWithTimeout(
      `SELECT COUNT(*)::bigint AS total_rows FROM catalyst_signals`,
      [],
      { timeoutMs: 7000, label: 'phase1.catalyst.count', maxRetries: 0 }
    )).rows?.[0] || null;
    output.catalyst_signals.latest = (await queryWithTimeout(
      `SELECT MAX(created_at) AS latest_created_at FROM catalyst_signals`,
      [],
      { timeoutMs: 7000, label: 'phase1.catalyst.latest', maxRetries: 0 }
    )).rows?.[0] || null;
  }

  const tradeOutcomesExists = await tableExists('trade_outcomes');
  output.trade_outcomes = { exists: tradeOutcomesExists };
  if (tradeOutcomesExists) {
    output.trade_outcomes.count = (await queryWithTimeout(
      `SELECT COUNT(*)::bigint AS total_rows FROM trade_outcomes`,
      [],
      { timeoutMs: 7000, label: 'phase1.trade_outcomes.count', maxRetries: 0 }
    )).rows?.[0] || null;
  }

  console.log(JSON.stringify(output, null, 2));
}

run().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
