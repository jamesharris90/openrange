const dotenv = require('../server/node_modules/dotenv');
const { queryWithTimeout, pool } = require('../server/db/pg');

dotenv.config({ path: 'server/.env' });

async function main() {
  const idTypeRes = await queryWithTimeout(
    `SELECT data_type, udt_name
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name='signals' AND column_name='id'`,
    [],
    { timeoutMs: 10000, label: 'schema.signals.id_type', maxRetries: 0 }
  );

  const idType = idTypeRes.rows?.[0];
  if (!idType) {
    throw new Error('signals.id not found');
  }

  const sqlType = idType.udt_name === 'uuid' ? 'uuid' : idType.data_type || 'text';

  await queryWithTimeout(
    `ALTER TABLE trade_setups ADD COLUMN IF NOT EXISTS signal_id ${sqlType}`,
    [],
    { timeoutMs: 15000, label: 'schema.fix.add_trade_setups_signal_id', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE INDEX IF NOT EXISTS idx_trade_setups_signal_id ON trade_setups(signal_id)`,
    [],
    { timeoutMs: 15000, label: 'schema.fix.index_trade_setups_signal_id', maxRetries: 0 }
  );

  // Backfill missing signal links by matching setup symbol to latest signal symbol.
  await queryWithTimeout(
    `WITH latest AS (
       SELECT DISTINCT ON (UPPER(symbol)) id, UPPER(symbol) AS symbol_key
       FROM signals
       ORDER BY UPPER(symbol), created_at DESC
     )
     UPDATE trade_setups ts
     SET signal_id = latest.id
     FROM latest
     WHERE ts.signal_id IS NULL
       AND UPPER(ts.symbol) = latest.symbol_key`,
    [],
    { timeoutMs: 20000, label: 'schema.fix.backfill_trade_setups_signal_id', maxRetries: 0 }
  );

  console.log(JSON.stringify({ fixed: true, sqlType }, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ fixed: false, error: error.message }, null, 2));
    process.exit(1);
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
