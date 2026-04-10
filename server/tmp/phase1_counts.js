const { queryWithTimeout } = require('../db/pg');

async function query(label, sql) {
  try {
    const result = await queryWithTimeout(sql, [], { timeoutMs: 10000, label, maxRetries: 0 });
    return result.rows?.[0] || null;
  } catch (error) {
    return { error: error.message };
  }
}

(async () => {
  const output = {
    ticker_universe: await query('phase1.ticker_universe', 'select count(*)::int as count from ticker_universe'),
    daily_ohlcv: await query('phase1.daily_ohlcv', 'select count(*)::bigint as count, min(date) as min_date, max(date) as max_date, count(distinct symbol)::int as symbols from daily_ohlcv'),
    intraday_1m: await query('phase1.intraday_1m', 'select count(*)::bigint as count, max(timestamp) as latest_bar, count(distinct symbol)::int as symbols from intraday_1m'),
    catalyst_signals: await query('phase1.catalyst_signals', 'select count(*)::bigint as count, max(created_at) as latest_created_at from catalyst_signals'),
    trade_outcomes: await query('phase1.trade_outcomes', 'select count(*)::bigint as count from trade_outcomes'),
  };
  console.log(JSON.stringify(output, null, 2));
})().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
