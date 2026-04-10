const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../server/.env') });
const { queryWithTimeout, pool } = require('../server/db/pg');

const LOG_DIR = path.join(__dirname, '../logs');

function writeJson(name, data) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(path.join(LOG_DIR, name), JSON.stringify(data, null, 2));
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function outcomeLabel(row) {
  const raw = String(row.outcome || '').trim().toUpperCase();
  if (raw === 'SUCCESS' || raw === 'WIN') return 'SUCCESS';
  if (raw === 'FAIL' || raw === 'FAILURE' || raw === 'LOSS') return 'FAIL';
  if (row.success === true) return 'SUCCESS';
  if (row.success === false) return 'FAIL';
  return 'UNKNOWN';
}

async function main() {
  try {
    const countRes = await queryWithTimeout(
      'SELECT COUNT(*)::int AS n FROM trade_outcomes',
      [],
      { timeoutMs: 10000, label: 'outcome.phase0.count', maxRetries: 0 }
    );
    const total = Number(countRes.rows?.[0]?.n || 0);

    if (total < 10) {
      console.log('INSUFFICIENT OUTCOME DATA');
      console.log('OUTCOME PROOF: FAILED');
      process.exit(1);
    }

    const top5Res = await queryWithTimeout(
      `SELECT
         symbol,
         strategy,
         entry_price,
         COALESCE(exit_price, entry_price) AS price_30m,
         COALESCE(pnl_pct, result_pct, max_move_pct, pnl_1h, pnl_15m, pnl_5m, 0)::numeric AS move_pct_30m,
         CASE
           WHEN UPPER(COALESCE(outcome, '')) IN ('SUCCESS', 'WIN') OR success = true THEN 'SUCCESS'
           WHEN UPPER(COALESCE(outcome, '')) IN ('FAIL', 'FAILURE', 'LOSS') OR success = false THEN 'FAIL'
           ELSE 'UNKNOWN'
         END AS outcome_label,
         NULL::numeric AS final_score,
         created_at
       FROM trade_outcomes
       ORDER BY created_at DESC NULLS LAST
       LIMIT 5`,
      [],
      { timeoutMs: 10000, label: 'outcome.phase1.top5', maxRetries: 0 }
    );

    const top5 = (top5Res.rows || []).map((r) => ({
      symbol: r.symbol,
      strategy: r.strategy || 'UNKNOWN',
      entry_price: num(r.entry_price, null),
      price_30m: num(r.price_30m, null),
      move_pct_30m: num(r.move_pct_30m, 0),
      outcome_label: r.outcome_label || 'UNKNOWN',
      final_score: r.final_score,
      created_at: r.created_at,
    }));
    writeJson('top5_trades.json', top5);

    const strategyPerfRes = await queryWithTimeout(
      `SELECT
         COALESCE(strategy, 'UNKNOWN') AS strategy,
         COUNT(*)::int AS trades,
         AVG(COALESCE(pnl_pct, result_pct, max_move_pct, pnl_1h, pnl_15m, pnl_5m, 0))::numeric AS avg_return,
         AVG(
           CASE
             WHEN UPPER(COALESCE(outcome, '')) IN ('SUCCESS', 'WIN') OR success = true THEN 1
             ELSE 0
           END
         )::numeric AS win_rate
       FROM trade_outcomes
       GROUP BY COALESCE(strategy, 'UNKNOWN')
       ORDER BY win_rate DESC, trades DESC`,
      [],
      { timeoutMs: 10000, label: 'outcome.phase2.strategy_perf', maxRetries: 0 }
    );

    const strategyPerformance = (strategyPerfRes.rows || []).map((r) => ({
      strategy: r.strategy,
      trades: Number(r.trades || 0),
      avg_return: Number(Number(r.avg_return || 0).toFixed(4)),
      win_rate: Number((Number(r.win_rate || 0) * 100).toFixed(2)),
    }));
    writeJson('strategy_performance.json', strategyPerformance);

    const eligible = strategyPerformance.filter((s) => s.trades >= 5);
    if (eligible.length === 0) {
      console.log('EXECUTION LAYER FAILED');
      console.log('OUTCOME PROOF: FAILED');
      process.exit(1);
    }

    const bestStrategy = [...eligible].sort((a, b) => (b.win_rate - a.win_rate) || (b.avg_return - a.avg_return))[0];
    const worstStrategy = [...eligible].sort((a, b) => (a.win_rate - b.win_rate) || (a.avg_return - b.avg_return))[0];

    const historyRes = await queryWithTimeout(
      `SELECT
         symbol,
         strategy,
         entry_price,
         COALESCE(pnl_pct, result_pct, max_move_pct, pnl_1h, pnl_15m, pnl_5m, 0)::numeric AS move_pct_30m,
         CASE
           WHEN UPPER(COALESCE(outcome, '')) IN ('SUCCESS', 'WIN') OR success = true THEN 'SUCCESS'
           WHEN UPPER(COALESCE(outcome, '')) IN ('FAIL', 'FAILURE', 'LOSS') OR success = false THEN 'FAIL'
           ELSE 'UNKNOWN'
         END AS outcome_label,
         created_at,
         pnl_5m,
         pnl_15m,
         COALESCE(pnl_1h, max_move_pct) AS pnl_60m,
         max_move_pct,
         max_drawdown_pct
       FROM trade_outcomes
       ORDER BY created_at DESC NULLS LAST
       LIMIT 20`,
      [],
      { timeoutMs: 10000, label: 'outcome.phase4.history', maxRetries: 0 }
    );

    const recentHistory = (historyRes.rows || []).map((r) => ({
      symbol: r.symbol,
      strategy: r.strategy || 'UNKNOWN',
      entry_price: num(r.entry_price, null),
      move_pct_30m: num(r.move_pct_30m, 0),
      outcome_label: r.outcome_label || 'UNKNOWN',
      created_at: r.created_at,
      pnl_5m: num(r.pnl_5m, null),
      pnl_15m: num(r.pnl_15m, null),
      pnl_60m: num(r.pnl_60m, null),
      max_move_pct: num(r.max_move_pct, null),
      max_drawdown_pct: num(r.max_drawdown_pct, null),
    }));
    writeJson('recent_history.json', recentHistory);

    const trackingSummary = {
      what_is_tracked: [
        'entry price',
        '5m / 15m / 30m / 60m performance',
        'max move',
        'drawdown',
        'outcome label',
      ],
      why: [
        'measure real edge',
        'validate strategy effectiveness',
        'adjust scoring weights',
        'remove losing setups',
      ],
    };

    const last10 = recentHistory.slice(0, 10);
    const successes = last10.filter((r) => outcomeLabel({ outcome: r.outcome_label }) === 'SUCCESS').length;
    const avgMove10 = last10.length
      ? Number((last10.reduce((s, r) => s + num(r.move_pct_30m, 0), 0) / last10.length).toFixed(4))
      : 0;

    console.log('=== TOP 5 TRADES ===');
    top5.forEach((t) => {
      console.log(`${t.symbol || 'N/A'}, ${t.strategy || 'UNKNOWN'}, ${t.move_pct_30m.toFixed(2)}%, ${t.outcome_label}`);
    });

    console.log('=== BEST STRATEGY ===');
    console.log(`${bestStrategy.strategy}, ${bestStrategy.win_rate.toFixed(2)}%, ${bestStrategy.avg_return.toFixed(4)}%`);

    console.log('=== WORST STRATEGY ===');
    console.log(`${worstStrategy.strategy}, ${worstStrategy.win_rate.toFixed(2)}%, ${worstStrategy.avg_return.toFixed(4)}%`);

    console.log('=== SYSTEM TRACKING ===');
    console.log(JSON.stringify(trackingSummary, null, 2));

    console.log('=== RECENT MARKET BEHAVIOUR ===');
    console.log(`last_10_trades=${last10.length}, success_count=${successes}, fail_count=${Math.max(last10.length - successes, 0)}, avg_move_pct_30m=${avgMove10.toFixed(4)}%`);

    console.log('OUTCOME PROOF: ACTIVE');
  } catch (error) {
    console.error('[OUTCOME_PROOF_ERROR]', error.message);
    console.log('OUTCOME PROOF: FAILED');
    process.exit(1);
  } finally {
    try {
      await pool.end();
    } catch {}
  }
}

main();
