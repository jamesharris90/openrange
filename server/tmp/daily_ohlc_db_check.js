require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { Client } = require('pg');
const { resolveDatabaseUrl } = require('../db/connectionConfig');

async function main() {
  const { dbUrl } = resolveDatabaseUrl();

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const checks = [
    ['daily_ohlc_exists', "SELECT to_regclass('public.daily_ohlc') AS value"],
    ['daily_ohlcv_exists', "SELECT to_regclass('public.daily_ohlcv') AS value"],
    ['daily_ohlc_columns', "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'daily_ohlc' ORDER BY ordinal_position"],
    ['daily_ohlcv_columns', "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'daily_ohlcv' ORDER BY ordinal_position"],
    ['daily_ohlc_count', 'SELECT COUNT(*)::bigint AS count FROM daily_ohlc'],
    ['daily_ohlcv_count', 'SELECT COUNT(*)::bigint AS count FROM daily_ohlcv'],
    ['daily_ohlc_max', 'SELECT MAX(date) AS max_date FROM daily_ohlc'],
    ['daily_ohlcv_max', 'SELECT MAX(date) AS max_date FROM daily_ohlcv'],
    ['daily_ohlcv_definition', "SELECT pg_get_viewdef('public.daily_ohlcv'::regclass, true) AS definition"],
    ['ticker_universe_active_count', "SELECT COUNT(*)::bigint AS count FROM ticker_universe WHERE COALESCE(is_active, true) = true AND symbol IS NOT NULL AND symbol <> ''"],
    ['daily_ohlc_2026_04_10', "SELECT COUNT(*)::bigint AS count FROM daily_ohlc WHERE date = DATE '2026-04-10'"],
    ['daily_ohlcv_2026_04_10', "SELECT COUNT(*)::bigint AS count FROM daily_ohlcv WHERE date = DATE '2026-04-10'"],
    ['daily_ohlc_latest_dates', 'SELECT date, COUNT(*)::bigint AS count FROM daily_ohlc GROUP BY date ORDER BY date DESC LIMIT 5'],
    ['daily_ohlcv_latest_dates', 'SELECT date, COUNT(*)::bigint AS count FROM daily_ohlcv GROUP BY date ORDER BY date DESC LIMIT 5'],
  ];

  for (const [label, sql] of checks) {
    const result = await client.query(sql);
    console.log(`## ${label}`);
    console.log(JSON.stringify(result.rows));
  }

  await client.end();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
