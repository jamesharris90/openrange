const { queryWithTimeout } = require('../db/pg');
const { standardDeviation, sum, toDateKey, upsertRows } = require('./utils');

const GRADE_SCORES = {
  A: 100,
  B: 85,
  C: 70,
  D: 50,
  F: 20,
};

function gradeStrategy({ winRate, profitFactor, totalSignals }) {
  if (winRate >= 0.65 && profitFactor >= 2.0 && totalSignals >= 10) return 'A';
  if (winRate >= 0.55 && profitFactor >= 1.5 && totalSignals >= 10) return 'B';
  if (winRate >= 0.5 && profitFactor >= 1.2 && totalSignals >= 5) return 'C';
  if (winRate < 0.45 && totalSignals >= 10) return 'F';
  return 'D';
}

function maxConsecutiveLosses(rows) {
  let maxLosses = 0;
  let current = 0;
  for (const row of rows) {
    if (Number(row.pnl_r) < 0) {
      current += 1;
      maxLosses = Math.max(maxLosses, current);
    } else {
      current = 0;
    }
  }
  return maxLosses;
}

function sharpeEstimate(rows) {
  const byDay = new Map();
  for (const row of rows) {
    const key = toDateKey(row.signal_date);
    if (!byDay.has(key)) byDay.set(key, 0);
    byDay.set(key, byDay.get(key) + Number(row.pnl_r || 0));
  }
  const values = Array.from(byDay.values());
  if (values.length < 2) return null;
  const avg = sum(values) / values.length;
  const sd = standardDeviation(values);
  if (!sd || sd === 0) return null;
  return (avg / sd) * Math.sqrt(252);
}

async function calculateStrategyScores(options = {}) {
  const scoreDate = toDateKey(options.scoreDate || new Date());
  const lookbacks = Array.isArray(options.lookbackDays) ? options.lookbackDays : [30, 60];

  const strategyResult = await queryWithTimeout(
    `SELECT DISTINCT strategy_id FROM strategy_backtest_signals ORDER BY strategy_id`,
    [],
    { timeoutMs: 15000, label: 'backtester.scorer.strategy_ids', maxRetries: 0 }
  );

  const rowsToUpsert = [];
  for (const strategyRow of strategyResult.rows || []) {
    const strategyId = strategyRow.strategy_id;
    for (const lookbackDays of lookbacks) {
      const result = await queryWithTimeout(
        `SELECT strategy_id, signal_date, exit_reason, bars_held, pnl_r
         FROM strategy_backtest_signals
         WHERE strategy_id = $1
           AND signal_date >= $2::date - ($3::text || ' days')::interval
           AND signal_date <= $2::date
         ORDER BY signal_date ASC`,
        [strategyId, scoreDate, String(lookbackDays)],
        { timeoutMs: 30000, label: `backtester.scorer.window.${strategyId}.${lookbackDays}`, maxRetries: 0, slowQueryMs: 1500 }
      );

      const rows = result.rows || [];
      const totalSignals = rows.length;
      const wins = rows.filter((row) => Number(row.pnl_r || 0) > 0).length;
      const losses = rows.filter((row) => Number(row.pnl_r || 0) < 0).length;
      const avgPnlR = totalSignals ? (sum(rows.map((row) => row.pnl_r)) / totalSignals) : 0;
      const positive = sum(rows.filter((row) => Number(row.pnl_r || 0) > 0).map((row) => row.pnl_r));
      const negative = Math.abs(sum(rows.filter((row) => Number(row.pnl_r || 0) < 0).map((row) => row.pnl_r)));
      const profitFactor = negative > 0 ? positive / negative : (positive > 0 ? positive : null);
      const avgWin = wins > 0 ? positive / wins : 0;
      const avgLoss = losses > 0 ? negative / losses : 0;
      const winRate = totalSignals > 0 ? wins / totalSignals : 0;
      const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);
      const grade = gradeStrategy({ winRate, profitFactor: profitFactor || 0, totalSignals });

      rowsToUpsert.push({
        strategy_id: strategyId,
        score_date: scoreDate,
        lookback_days: lookbackDays,
        total_signals: totalSignals,
        wins,
        losses,
        win_rate: winRate,
        avg_pnl_r: avgPnlR,
        profit_factor: profitFactor,
        max_consecutive_losses: maxConsecutiveLosses(rows),
        avg_bars_held: totalSignals ? (sum(rows.map((row) => row.bars_held || 0)) / totalSignals) : 0,
        expectancy,
        sharpe_estimate: sharpeEstimate(rows),
        grade,
        metadata: {
          grade_score: GRADE_SCORES[grade],
          avg_win_r: avgWin,
          avg_loss_r: avgLoss,
        },
      });
    }
  }

  await upsertRows(
    'strategy_scores',
    rowsToUpsert,
    {
      strategy_id: 'text',
      score_date: 'date',
      lookback_days: 'integer',
      total_signals: 'integer',
      wins: 'integer',
      losses: 'integer',
      win_rate: 'numeric',
      avg_pnl_r: 'numeric',
      profit_factor: 'numeric',
      max_consecutive_losses: 'integer',
      avg_bars_held: 'numeric',
      expectancy: 'numeric',
      sharpe_estimate: 'numeric',
      grade: 'text',
      metadata: 'jsonb',
    },
    ['strategy_id', 'score_date', 'lookback_days'],
    ['total_signals', 'wins', 'losses', 'win_rate', 'avg_pnl_r', 'profit_factor', 'max_consecutive_losses', 'avg_bars_held', 'expectancy', 'sharpe_estimate', 'grade', 'metadata'],
    'backtester.scorer.upsert'
  );

  return {
    scoreDate,
    rowsInserted: rowsToUpsert.length,
  };
}

module.exports = {
  GRADE_SCORES,
  calculateStrategyScores,
  gradeStrategy,
};