const dotenv = require('../server/node_modules/dotenv');
const { queryWithTimeout, pool } = require('../server/db/pg');

dotenv.config({ path: 'server/.env' });

async function ensureColumns() {
  await queryWithTimeout(
    `ALTER TABLE trade_setups ADD COLUMN IF NOT EXISTS entry_price double precision`,
    [],
    { timeoutMs: 15000, label: 'phase4.add.entry_price', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE trade_setups ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT NOW()`,
    [],
    { timeoutMs: 15000, label: 'phase4.add.created_at', maxRetries: 0 }
  );
}

async function getSignals() {
  const result = await queryWithTimeout(
    `SELECT id, UPPER(symbol) AS symbol
     FROM signals
     WHERE UPPER(symbol) = ANY($1::text[])
       AND created_at > NOW() - interval '15 minutes'
     ORDER BY created_at DESC`,
    [['AAPL', 'SPY', 'ACXP']],
    { timeoutMs: 10000, label: 'phase4.target_signals', maxRetries: 0 }
  );
  return result.rows || [];
}

async function getLatestPrice(symbol) {
  const price = await queryWithTimeout(
    `SELECT price
     FROM market_metrics
     WHERE UPPER(symbol)=UPPER($1)
     ORDER BY COALESCE(updated_at, last_updated, NOW()) DESC
     LIMIT 1`,
    [symbol],
    { timeoutMs: 10000, label: 'phase4.market_price', maxRetries: 0 }
  );
  return Number(price.rows?.[0]?.price || 0);
}

async function ensureSetup(signalId, symbol, entryPrice) {
  const exists = await queryWithTimeout(
    `SELECT 1 FROM trade_setups WHERE signal_id = $1 LIMIT 1`,
    [signalId],
    { timeoutMs: 10000, label: 'phase4.setup_exists', maxRetries: 0 }
  );

  if ((exists.rows || []).length > 0) {
    await queryWithTimeout(
      `UPDATE trade_setups
       SET symbol = $2,
           entry_price = COALESCE(entry_price, $3),
           updated_at = NOW()
       WHERE signal_id = $1`,
      [signalId, symbol, entryPrice],
      { timeoutMs: 10000, label: 'phase4.setup_touch', maxRetries: 0 }
    );
    return 'touched';
  }

  await queryWithTimeout(
    `INSERT INTO trade_setups (symbol, signal_id, setup_type, setup, score, entry_price, detected_at, updated_at, created_at)
     VALUES ($1, $2, 'momentum_continuation', 'momentum_continuation', 70, $3, NOW(), NOW(), NOW())`,
    [symbol, signalId, entryPrice],
    { timeoutMs: 10000, label: 'phase4.setup_insert', maxRetries: 0 }
  );

  return 'inserted';
}

async function main() {
  await ensureColumns();

  const signals = await getSignals();
  const setupActions = [];

  for (const signal of signals) {
    const entryPrice = await getLatestPrice(signal.symbol);
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      setupActions.push({ symbol: signal.symbol, signal_id: signal.id, action: 'skipped_no_price' });
      continue;
    }

    const action = await ensureSetup(signal.id, signal.symbol, entryPrice);
    setupActions.push({ symbol: signal.symbol, signal_id: signal.id, action, entryPrice });
  }

  const joinCheck = await queryWithTimeout(
    `SELECT COUNT(*)::int AS n
     FROM signals s
     JOIN trade_setups ts ON ts.signal_id = s.id
     WHERE s.created_at > NOW() - interval '15 minutes'`,
    [],
    { timeoutMs: 10000, label: 'phase4.join_check', maxRetries: 0 }
  );

  console.log(
    JSON.stringify(
      {
        signalsConsidered: signals.length,
        setupActions,
        joinedRecentSignalsToSetups: Number(joinCheck.rows?.[0]?.n || 0),
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ fatal: error.message }, null, 2));
    process.exit(1);
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
