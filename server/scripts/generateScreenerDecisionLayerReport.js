#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
if (!process.env.DATABASE_URL && !process.env.SUPABASE_DB_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
}

const { buildAndStoreScreenerSnapshot, getLatestScreenerPayload } = require('../v2/services/snapshotService');

const OUTPUT_PATH = path.resolve(__dirname, '..', '..', 'SCREENER_DECISION_LAYER_REPORT.json');

function countBy(rows, field) {
  return rows.reduce((accumulator, row) => {
    const key = String(row?.[field] || 'UNKNOWN');
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
}

function sortSample(rows, comparator) {
  return [...rows].sort(comparator).slice(0, 5).map((row) => ({
    symbol: row.symbol,
    rvol: row.rvol,
    gap_percent: row.gap_percent,
    trend: row.trend,
    vwap_position: row.vwap_position,
    momentum: row.momentum,
  }));
}

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
    distributions: {
      trend: countBy(rows, 'trend'),
      vwap_position: countBy(rows, 'vwap_position'),
      momentum: countBy(rows, 'momentum'),
    },
    samples: {
      top_rvol: sortSample(rows, (left, right) => (right.rvol ?? -1) - (left.rvol ?? -1)),
      bullish_trend: sortSample(rows.filter((row) => row.trend === 'BULLISH'), (left, right) => (right.rvol ?? -1) - (left.rvol ?? -1)),
      bullish_momentum: sortSample(rows.filter((row) => row.momentum === 'BULLISH'), (left, right) => (right.gap_percent ?? -999) - (left.gap_percent ?? -999)),
    },
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