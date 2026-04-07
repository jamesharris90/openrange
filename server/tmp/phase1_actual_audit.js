const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
}

const { queryWithTimeout } = require('../db/pg');
const OUTPUT_PATH = process.env.PHASE1_PRECHECK_OUTPUT_PATH || path.resolve(__dirname, '../../logs/precheck_validation.json');

async function run(label, sql, params = [], timeoutMs = 12000) {
  try {
    const result = await queryWithTimeout(sql, params, { timeoutMs, label, maxRetries: 0 });
    return result.rows || [];
  } catch (error) {
    return [{ error: error.message }];
  }
}

(async () => {
  const output = {
    ticker_universe: await run('audit.ticker_universe', `select count(*)::int as count, max(last_updated) as latest_update from ticker_universe`),
    daily_ohlc: await run('audit.daily_ohlc', `select count(*)::bigint as count, min(date) as min_date, max(date) as max_date, count(distinct symbol)::int as symbols from daily_ohlc`, [], 30000),
    intraday_1m: await run('audit.intraday_1m', `select count(*)::bigint as count, max(timestamp) as latest_bar, count(distinct symbol)::int as symbols from intraday_1m`, [], 30000),
    catalyst_signals: await run('audit.catalyst_signals', `select count(*)::bigint as count, max(created_at) as latest_created_at from catalyst_signals`),
    trade_outcomes: await run('audit.trade_outcomes', `select count(*)::bigint as count from trade_outcomes`),
    backtest_signals: await run('audit.backtest_signals', `select count(*)::bigint as total, count(*) filter (where evaluated = false)::bigint as pending, count(*) filter (where evaluated = true)::bigint as evaluated from backtest_signals`),
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.error(`[phase1_actual_audit] wrote ${OUTPUT_PATH}`);
})().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
