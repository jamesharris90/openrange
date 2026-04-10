require('dotenv').config({ path: '/Users/jamesharris/Server/server/.env' });

const fs = require('fs');
const pool = require('../db/pool');

const STRATEGY = 'POST_EARNINGS_MOMENTUM';
const OUTPUT_PATH = '/Users/jamesharris/Server/logs/earnings_outcome_generation.json';
const EDGE_REPORT_PATH = '/Users/jamesharris/Server/logs/earnings_edge_report.json';

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toPct(entryPrice, exitPrice) {
  if (!Number.isFinite(entryPrice) || !Number.isFinite(exitPrice) || entryPrice <= 0) return null;
  return Number((((exitPrice - entryPrice) / entryPrice) * 100).toFixed(6));
}

async function getColumns(pool, tableName) {
  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1`,
    [tableName]
  );
  return new Set((result.rows || []).map((row) => row.column_name));
}

function buildInsert(tableName, columns, values) {
  const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');
  return {
    sql: `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`,
    values,
  };
}

function pearson(xs, ys) {
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length || xs.length < 2) return null;
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varX = 0;
  let varY = 0;

  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  const den = Math.sqrt(varX * varY);
  if (!Number.isFinite(den) || den === 0) return null;
  return Number((cov / den).toFixed(6));
}

async function writeEdgeReport(pool) {
  const report = {
    timestamp: new Date().toISOString(),
    total_trades: 0,
    win_rate: 0,
    avg_return: null,
    median_return: null,
    big_winners: 0,
    losers: 0,
    strategy_rank: null,
    score_correlation: null,
    verdict: 'fail',
    details: {},
  };

  const earningsTrades = await pool.query(
    `SELECT symbol, strategy, pnl_pct, created_at
     FROM trade_outcomes
     WHERE strategy = $1
     ORDER BY COALESCE(created_at, entry_time) DESC NULLS LAST`,
    [STRATEGY]
  );

  report.total_trades = Number(earningsTrades.rowCount || 0);
  report.details.earnings_trades_sample = (earningsTrades.rows || []).slice(0, 25);

  if (report.total_trades === 0) {
    report.details.reason = 'No POST_EARNINGS_MOMENTUM trades found';
    await fs.promises.writeFile(EDGE_REPORT_PATH, JSON.stringify(report, null, 2));
    return report;
  }

  const basic = await pool.query(
    `SELECT
       AVG(CASE WHEN pnl_pct > 0 THEN 1.0 ELSE 0.0 END) AS win_rate,
       AVG(pnl_pct) AS avg_return,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pnl_pct) AS median_return,
       AVG(CASE WHEN pnl_pct < 0 THEN 1.0 ELSE 0.0 END) AS loss_rate
     FROM trade_outcomes
     WHERE strategy = $1
       AND pnl_pct IS NOT NULL`,
    [STRATEGY]
  );

  const dist = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE pnl_pct > 5) AS big_winners,
       COUNT(*) FILTER (WHERE pnl_pct >= 0 AND pnl_pct <= 5) AS small_winners,
       COUNT(*) FILTER (WHERE pnl_pct < 0) AS losers
     FROM trade_outcomes
     WHERE strategy = $1
       AND pnl_pct IS NOT NULL`,
    [STRATEGY]
  );

  const strategyRows = await pool.query(
    `SELECT
       strategy,
       COUNT(*)::int AS trades,
       AVG(pnl_pct) AS avg_return,
       AVG(CASE WHEN pnl_pct > 0 THEN 1.0 ELSE 0.0 END) AS win_rate
     FROM trade_outcomes
     WHERE pnl_pct IS NOT NULL
     GROUP BY strategy
     ORDER BY AVG(pnl_pct) DESC NULLS LAST`
  );

  const ranked = (strategyRows.rows || []).map((row) => ({
    strategy: row.strategy,
    trades: Number(row.trades || 0),
    avg_return: toNumber(row.avg_return),
    win_rate: toNumber(row.win_rate),
  }));

  const strategyRank = ranked.findIndex((row) => row.strategy === STRATEGY);

  const corrRows = await pool.query(
    `SELECT t.symbol, t.pnl_pct, d.final_score
     FROM trade_outcomes t
     LEFT JOIN decision_view d ON UPPER(d.symbol) = UPPER(t.symbol)
     WHERE t.strategy = $1
       AND t.pnl_pct IS NOT NULL
       AND d.final_score IS NOT NULL`,
    [STRATEGY]
  );

  const xs = [];
  const ys = [];
  for (const row of corrRows.rows || []) {
    const x = toNumber(row.final_score);
    const y = toNumber(row.pnl_pct);
    if (x == null || y == null) continue;
    xs.push(x);
    ys.push(y);
  }

  report.win_rate = toNumber(basic.rows?.[0]?.win_rate) || 0;
  report.avg_return = toNumber(basic.rows?.[0]?.avg_return);
  report.median_return = toNumber(basic.rows?.[0]?.median_return);
  report.details.loss_rate = toNumber(basic.rows?.[0]?.loss_rate);
  report.big_winners = Number(dist.rows?.[0]?.big_winners || 0);
  report.details.small_winners = Number(dist.rows?.[0]?.small_winners || 0);
  report.losers = Number(dist.rows?.[0]?.losers || 0);
  report.strategy_rank = strategyRank >= 0 ? strategyRank + 1 : null;
  report.score_correlation = pearson(xs, ys);
  report.details.strategy_comparison = ranked;
  report.details.correlation_pairs = xs.length;
  report.verdict = report.win_rate > 0.5 && (report.avg_return || 0) > 0 ? 'pass' : 'fail';

  await fs.promises.writeFile(EDGE_REPORT_PATH, JSON.stringify(report, null, 2));
  return report;
}

async function main() {
  const output = {
    timestamp: new Date().toISOString(),
    earnings_signals_count: 0,
    signal_outcomes_created: 0,
    trade_outcomes_created: 0,
    skipped_missing_price: 0,
    skipped_existing_signal_outcome: 0,
    skipped_existing_trade_outcome: 0,
    trade_outcomes_post_earnings_momentum: 0,
    verdict: 'fail',
    logs: [],
  };

  try {
    const signalCols = await getColumns(pool, 'signal_outcomes');
    const tradeCols = await getColumns(pool, 'trade_outcomes');

    const signals = await pool.query(
      `SELECT id, UPPER(symbol) AS symbol, created_at
       FROM signals
       WHERE signal_type = 'earnings'
         AND created_at > NOW() - INTERVAL '3 days'
       ORDER BY created_at DESC`
    );

    output.earnings_signals_count = Number(signals.rowCount || 0);

    if (!output.earnings_signals_count) {
      output.verdict = 'fail';
      output.logs.push('No earnings signals found in last 3 days; stopping.');
      await fs.promises.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
      const edge = await writeEdgeReport(pool);
      console.log(edge.verdict === 'pass' ? 'EARNINGS STRATEGY PROFITABLE' : 'EARNINGS STRATEGY NOT PROFITABLE');
      console.log('EARNINGS OUTCOME GENERATION FAILED');
      return;
    }

    for (const sig of signals.rows || []) {
      const symbol = String(sig.symbol || '').trim().toUpperCase();
      if (!symbol) continue;

      const existingSignalOutcome = await pool.query(
        `SELECT id
         FROM signal_outcomes
         WHERE signal_id = $1
         LIMIT 1`,
        [sig.id]
      );
      const existingTradeOutcome = await pool.query(
        `SELECT id
         FROM trade_outcomes
         WHERE signal_id = $1
           AND strategy = $2
         LIMIT 1`,
        [sig.id, STRATEGY]
      );

      const priceNearSignal = await pool.query(
        `SELECT price
         FROM market_metrics
         WHERE UPPER(symbol) = $1
           AND COALESCE(updated_at, last_updated::timestamptz, NOW()) <= $2
         ORDER BY COALESCE(updated_at, last_updated::timestamptz, NOW()) DESC
         LIMIT 1`,
        [symbol, sig.created_at]
      );

      const priceNow = await pool.query(
        `SELECT price
         FROM market_metrics
         WHERE UPPER(symbol) = $1
         ORDER BY COALESCE(updated_at, last_updated::timestamptz, NOW()) DESC
         LIMIT 1`,
        [symbol]
      );

      const entryPrice = toNumber(priceNearSignal.rows?.[0]?.price) ?? toNumber(priceNow.rows?.[0]?.price);
      const exitPrice = toNumber(priceNow.rows?.[0]?.price) ?? toNumber(priceNearSignal.rows?.[0]?.price);
      const pnlPct = toPct(entryPrice, exitPrice);

      if (entryPrice == null || exitPrice == null || pnlPct == null) {
        output.skipped_missing_price += 1;
        output.logs.push(`SKIP ${symbol}: missing/invalid entry-exit price`);
        continue;
      }

      if ((existingSignalOutcome.rows || []).length === 0) {
        const columns = [];
        const values = [];
        const push = (name, value) => {
          if (signalCols.has(name)) {
            columns.push(name);
            values.push(value);
          }
        };

        const now = new Date();
        push('symbol', symbol);
        push('signal_id', sig.id);
        push('entry_price', entryPrice);
        push('exit_price', exitPrice);
        push('return_percent', pnlPct);
        push('pnl_pct', pnlPct);
        push('strategy', STRATEGY);
        push('outcome', pnlPct > 0 ? 'win' : pnlPct < 0 ? 'loss' : 'flat');
        push('created_at', now);
        push('evaluated_at', now);

        if (columns.includes('symbol') && columns.includes('pnl_pct')) {
          const insert = buildInsert('signal_outcomes', columns, values);
          await pool.query(insert.sql, insert.values);
          output.signal_outcomes_created += 1;
        } else {
          output.logs.push(`SKIP ${symbol}: signal_outcomes missing required symbol+pnl_pct columns`);
        }
      } else {
        output.skipped_existing_signal_outcome += 1;
      }

      if ((existingTradeOutcome.rows || []).length === 0) {
        const columns = [];
        const values = [];
        const push = (name, value) => {
          if (tradeCols.has(name)) {
            columns.push(name);
            values.push(value);
          }
        };

        const now = new Date();
        push('symbol', symbol);
        push('signal_id', sig.id);
        push('strategy', STRATEGY);
        push('entry_price', entryPrice);
        push('exit_price', exitPrice);
        push('pnl_pct', pnlPct);
        push('result_pct', pnlPct);
        push('max_move', Math.abs(pnlPct));
        push('success', pnlPct > 0);
        push('created_at', now);
        push('evaluated_at', now);
        push('entry_time', sig.created_at);
        push('exit_time', now);
        push('data_quality', 'derived');
        push('outcome', pnlPct > 0 ? 'win' : pnlPct < 0 ? 'loss' : 'flat');

        if (columns.includes('symbol') && columns.includes('pnl_pct')) {
          const insert = buildInsert('trade_outcomes', columns, values);
          await pool.query(insert.sql, insert.values);
          output.trade_outcomes_created += 1;
        } else {
          output.logs.push(`SKIP ${symbol}: trade_outcomes missing required symbol+pnl_pct columns`);
        }
      } else {
        output.skipped_existing_trade_outcome += 1;
      }
    }

    const postCount = await pool.query(
      `SELECT COUNT(*)::int AS c
       FROM trade_outcomes
       WHERE strategy = $1`,
      [STRATEGY]
    );

    output.trade_outcomes_post_earnings_momentum = Number(postCount.rows?.[0]?.c || 0);

    const edgeReport = await writeEdgeReport(pool);
    output.edge_report_verdict = edgeReport.verdict;

    output.verdict = output.trade_outcomes_post_earnings_momentum > 10 ? 'pass' : 'fail';

    await fs.promises.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));

    if (output.verdict === 'pass') {
      console.log('EARNINGS OUTCOMES ACTIVE');
    } else {
      console.log('EARNINGS OUTCOME GENERATION FAILED');
    }

    console.log(edgeReport.verdict === 'pass' ? 'EARNINGS STRATEGY PROFITABLE' : 'EARNINGS STRATEGY NOT PROFITABLE');
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch(async (error) => {
  const fallback = {
    timestamp: new Date().toISOString(),
    verdict: 'fail',
    error: error.message,
  };
  await fs.promises.writeFile(OUTPUT_PATH, JSON.stringify(fallback, null, 2));
  console.log('EARNINGS OUTCOME GENERATION FAILED');
  process.exit(1);
});
