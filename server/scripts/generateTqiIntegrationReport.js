#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
if (!process.env.DATABASE_URL && !process.env.SUPABASE_DB_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
}

const { buildAndStoreScreenerSnapshot, getLatestScreenerPayload } = require('../v2/services/snapshotService');

const OUTPUT_PATH = path.resolve(__dirname, '..', '..', 'TQI_INTEGRATION_REPORT.json');

function average(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function countBy(rows, field) {
  return rows.reduce((accumulator, row) => {
    const key = String(row?.[field] || 'UNKNOWN');
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
}

async function main() {
  const startedAt = Date.now();
  const snapshot = await buildAndStoreScreenerSnapshot();
  const payload = await getLatestScreenerPayload();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const sortedRows = [...rows].sort((left, right) => Number(right?.tqi || 0) - Number(left?.tqi || 0));
  const tqiValues = rows.map((row) => Number(row?.tqi || 0)).filter(Number.isFinite);

  const report = {
    generated_at: new Date().toISOString(),
    snapshot_at: payload?.snapshot_at || snapshot?.created_at || null,
    row_count: rows.length,
    avg_tqi: Number(average(tqiValues).toFixed(2)),
    distribution: countBy(rows, 'tqi_label'),
    top_10_tickers_by_tqi: sortedRows.slice(0, 10).map((row) => ({
      symbol: row.symbol,
      tqi: row.tqi,
      tqi_label: row.tqi_label,
      rvol: row.rvol,
      trend: row.trend,
      vwap_position: row.vwap_position,
      momentum: row.momentum,
      catalyst_type: row.catalyst_type,
      catalyst_strength: row.catalyst_strength,
    })),
    timing_ms: {
      snapshot_total_ms: Number(payload?.meta?.total_ms || 0),
      report_total_ms: Date.now() - startedAt,
    },
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});