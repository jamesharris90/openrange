#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const { buildAndStoreScreenerSnapshot, getLatestScreenerPayload } = require('../v2/services/snapshotService');

const OUTPUT_PATH = path.resolve(__dirname, '..', '..', 'SCREENER_UNIVERSE_REPORT.json');

async function main() {
  const startedAt = Date.now();
  const snapshot = await buildAndStoreScreenerSnapshot();
  const payload = await getLatestScreenerPayload();
  const rows = Array.isArray(payload?.data) ? payload.data : [];

  const report = {
    generated_at: new Date().toISOString(),
    snapshot_at: payload?.snapshot_at || snapshot?.created_at || null,
    raw_universe_size: Number(payload?.meta?.raw_universe_size || 0),
    final_scored_size: Number(payload?.meta?.final_scored_size || rows.length || 0),
    returned_rows: rows.length,
    performance_timing_ms: {
      snapshot_total_ms: Number(payload?.meta?.total_ms || 0),
      report_total_ms: Date.now() - startedAt,
    },
    sample: rows.slice(0, 5).map((row) => ({
      symbol: row.symbol,
      price: row.price,
      change_percent: row.change_percent,
      volume: row.volume,
      rvol: row.rvol,
      state: row.state,
    })),
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});