const { queryWithTimeout } = require('../db/pg');

async function runQuery(name, sql, params) {
  const result = await queryWithTimeout(sql, params, {
    timeoutMs: 10000,
    label: `inspect.${name}`,
    maxRetries: 0,
  }).catch((error) => ({ rows: [{ error: error.message }] }));
  console.log(`TABLE=${name}`);
  console.log(JSON.stringify(result.rows, null, 2));
}

async function main() {
  const symbols = ['GVH', 'ARTL'];

  await runQuery(
    'signal_hierarchy',
    `SELECT symbol, hierarchy_rank, signal_class, strategy, score, confidence, created_at
     FROM signal_hierarchy
     WHERE symbol = ANY($1)
     ORDER BY hierarchy_rank DESC NULLS LAST`,
    [symbols]
  );

  await runQuery(
    'trade_signals',
    `SELECT symbol, strategy, score, confidence, setup_type, entry_price, sector, catalyst_type, rvol, gap_percent, atr_percent, updated_at
     FROM trade_signals
     WHERE symbol = ANY($1)
     ORDER BY updated_at DESC NULLS LAST`,
    [symbols]
  );

  await runQuery(
    'market_quotes',
    `SELECT symbol, price, change_percent, relative_volume, volume, sector, previous_close, updated_at
     FROM market_quotes
     WHERE symbol = ANY($1)
     ORDER BY symbol ASC`,
    [symbols]
  );

  await runQuery(
    'opportunity_stream',
    `SELECT symbol, expected_move, change_percent, relative_volume, trade_class, why, how, created_at
     FROM opportunity_stream
     WHERE symbol = ANY($1)
     ORDER BY created_at DESC NULLS LAST
     LIMIT 20`,
    [symbols]
  );
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
