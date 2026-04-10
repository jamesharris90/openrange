const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const pool = require('../db/pool');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

function pickTimestampColumn(columns) {
  const preferred = [
    'updated_at',
    'timestamp',
    'created_at',
    'date',
    'datetime',
    'time',
    'event_time',
    'published_at'
  ];
  const names = columns.map((c) => c.column_name);
  for (const name of preferred) {
    if (names.includes(name)) return name;
  }
  return null;
}

async function run() {
  const tablesRes = await pool.query(
    "select table_name from information_schema.tables where table_schema='public' order by table_name"
  );
  const tables = tablesRes.rows.map((r) => r.table_name);

  const report = {
    generated_at: new Date().toISOString(),
    table_count: tables.length,
    tables: [],
    focus_tables: {}
  };

  for (const tableName of tables) {
    const colsRes = await pool.query(
      "select column_name, data_type from information_schema.columns where table_schema='public' and table_name = $1 order by ordinal_position",
      [tableName]
    );

    const columns = colsRes.rows;
    const rowCountRes = await pool.query(`select count(*)::bigint as count from public.${tableName}`);
    const rowCount = Number(rowCountRes.rows[0].count);

    const tsCol = pickTimestampColumn(columns);
    let latestTimestamp = null;
    if (tsCol) {
      const latestRes = await pool.query(`select max(${tsCol}) as latest from public.${tableName}`);
      latestTimestamp = latestRes.rows[0].latest;
    }

    report.tables.push({
      table_name: tableName,
      row_count: rowCount,
      timestamp_column: tsCol,
      latest_timestamp: latestTimestamp,
      active_receiving_data: Boolean(latestTimestamp),
      columns
    });
  }

  const focus = ['intraday_prices', 'daily_prices', 'quotes', 'opportunities', 'signals', 'catalysts'];
  for (const name of focus) {
    report.focus_tables[name] = report.tables.find((t) => t.table_name === name) || null;
  }

  const outPath = path.join(__dirname, '..', '..', 'docs', 'db-reality-scan.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify({ ok: true, outPath, tableCount: report.table_count }, null, 2));

  await pool.end();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
