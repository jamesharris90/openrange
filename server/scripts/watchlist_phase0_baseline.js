const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { pool } = require('../db/pg');

async function q(sql) {
  const result = await pool.query(sql);
  return Number(result.rows?.[0]?.count || 0);
}

async function main() {
  const baseline = {
    timestamp: new Date().toISOString(),
    counts: {
      stocks_in_play: await q('SELECT COUNT(*)::int AS count FROM stocks_in_play'),
      stocks_in_play_filtered: await q('SELECT COUNT(*)::int AS count FROM stocks_in_play_filtered'),
      signals_recent: await q("SELECT COUNT(*)::int AS count FROM signals WHERE created_at > NOW() - INTERVAL '1 hour'"),
      decision_view: await q('SELECT COUNT(*)::int AS count FROM decision_view'),
    },
    expectations: {
      stocks_in_play_gt_50: null,
      filtered_gt_0: null,
      signals_recent_gt_5: null,
      decision_view_gt_50: null,
    },
    critical_zero: false,
  };

  baseline.expectations.stocks_in_play_gt_50 = baseline.counts.stocks_in_play > 50;
  baseline.expectations.filtered_gt_0 = baseline.counts.stocks_in_play_filtered > 0;
  baseline.expectations.signals_recent_gt_5 = baseline.counts.signals_recent > 5;
  baseline.expectations.decision_view_gt_50 = baseline.counts.decision_view > 50;

  baseline.critical_zero =
    baseline.counts.stocks_in_play === 0 ||
    baseline.counts.signals_recent === 0 ||
    baseline.counts.decision_view === 0;

  const outPath = path.resolve('/Users/jamesharris/Server/logs/watchlist_baseline.json');
  fs.writeFileSync(outPath, JSON.stringify(baseline, null, 2));
  console.log(JSON.stringify(baseline));

  await pool.end();

  if (baseline.critical_zero) {
    process.exit(2);
  }
}

main().catch(async (error) => {
  const outPath = path.resolve('/Users/jamesharris/Server/logs/watchlist_baseline.json');
  fs.writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), error: String(error) }, null, 2));
  console.error(error);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
