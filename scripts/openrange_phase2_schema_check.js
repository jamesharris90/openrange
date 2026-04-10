const dotenv = require('../server/node_modules/dotenv');
const { queryWithTimeout, pool } = require('../server/db/pg');

dotenv.config({ path: 'server/.env' });

const requirements = {
  signals: ['id', 'symbol'],
  trade_setups: ['symbol', 'signal_id'],
  signal_outcomes: ['symbol', 'signal_id', 'pnl_pct'],
  trade_outcomes: ['symbol', 'signal_id', 'pnl_pct'],
  market_metrics: ['symbol'],
};

async function getColumns(tableName) {
  const result = await queryWithTimeout(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName],
    { timeoutMs: 10000, label: `schema.columns.${tableName}`, maxRetries: 0 }
  );
  return result.rows.map((row) => row.column_name);
}

async function main() {
  const report = {};
  let missingTotal = 0;

  for (const [table, requiredColumns] of Object.entries(requirements)) {
    const existingColumns = await getColumns(table);
    const missing = requiredColumns.filter((c) => !existingColumns.includes(c));

    report[table] = {
      exists: existingColumns.length > 0,
      requiredColumns,
      existingColumns,
      missing,
      ok: missing.length === 0 && existingColumns.length > 0,
    };

    missingTotal += missing.length;
  }

  const schemaOk = missingTotal === 0 && Object.values(report).every((r) => r.exists);
  console.log(JSON.stringify({ schemaOk, missingTotal, report }, null, 2));
  process.exit(schemaOk ? 0 : 1);
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ fatal: error.message }, null, 2));
    process.exit(1);
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
