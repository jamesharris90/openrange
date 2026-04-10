const path = require('path');
require('dotenv').config({ path: path.resolve('/Users/jamesharris/Server/server/.env') });
const { queryWithTimeout } = require('/Users/jamesharris/Server/server/db/pg');

const targets = {
  market_quotes: ['pm_change', 'premarket_change_percent', 'premarket_change', 'premarket_volume', 'pm_volume', 'short_float', 'spread_pct', 'spread_percent', 'opt_volume', 'options_volume', 'opt_vol_vs_30d', 'options_volume_vs_30d', 'net_premium', 'unusual_opts', 'unusual_options', 'iv_rank', 'div_yield', 'dividend_yield'],
  market_metrics: ['pm_change', 'premarket_change_percent', 'premarket_change', 'premarket_volume', 'pm_volume', 'short_float', 'spread_pct', 'spread_percent', 'opt_volume', 'options_volume', 'opt_vol_vs_30d', 'options_volume_vs_30d', 'net_premium', 'unusual_opts', 'unusual_options', 'iv_rank', 'div_yield', 'dividend_yield'],
  fundamentals_snapshot: ['div_yield', 'dividend_yield', 'pe', 'ps', 'eps_growth', 'revenue_growth', 'roe', 'fcf_yield'],
  ownership_snapshot: ['institutional_ownership_percent', 'insider_ownership_percent', 'put_call_ratio'],
  company_profiles: ['dividend_yield', 'beta', 'sector', 'exchange'],
  earnings_events: ['report_date', 'eps_estimate', 'eps_actual', 'rev_estimate', 'rev_actual'],
};

async function main() {
  const tables = Object.keys(targets);
  const columnsResult = await queryWithTimeout(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])
     ORDER BY table_name, column_name`,
    [tables],
    { timeoutMs: 10000, label: 'precheck.columns', maxRetries: 0 }
  );

  const columnsByTable = new Map();
  for (const row of columnsResult.rows || []) {
    const list = columnsByTable.get(row.table_name) || [];
    list.push(row.column_name);
    columnsByTable.set(row.table_name, list);
  }

  const report = {};
  for (const [table, wanted] of Object.entries(targets)) {
    const available = new Set(columnsByTable.get(table) || []);
    report[table] = {
      columns_present: wanted.filter((name) => available.has(name)),
      columns_missing: wanted.filter((name) => !available.has(name)),
    };
    try {
      const rowResult = await queryWithTimeout(
        `SELECT to_jsonb(t) AS row FROM ${table} t WHERE UPPER(symbol) = 'INTC' LIMIT 1`,
        [],
        { timeoutMs: 5000, label: `precheck.${table}.row`, maxRetries: 0 }
      );
      report[table].has_intc = Boolean(rowResult.rows?.[0]?.row);
      report[table].intc_sample = rowResult.rows?.[0]?.row || null;
    } catch (error) {
      report[table].has_intc = false;
      report[table].row_error = error.message;
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
