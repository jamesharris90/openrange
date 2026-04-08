const { queryWithTimeout } = require('../db/pg');
const { loadStrategyModules } = require('./strategyLoader');
const { buildSharedDataCaches, loadSymbolDataset } = require('./engine');
const { GRADE_SCORES } = require('./scorer');
const { toDateKey, upsertRows } = require('./utils');

function nextWeekday(dateValue) {
  const current = new Date(dateValue);
  const next = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()));
  do {
    next.setUTCDate(next.getUTCDate() + 1);
  } while (next.getUTCDay() === 0 || next.getUTCDay() === 6);
  return next.toISOString().slice(0, 10);
}

function computeConfidenceScore(scoreRow) {
  const winComponent = Number(scoreRow.win_rate || 0) * 100 * 0.4;
  const profitFactor = Math.min(Number(scoreRow.profit_factor || 0), 3);
  const pfComponent = (profitFactor / 3) * 100 * 0.3;
  const gradeComponent = (GRADE_SCORES[String(scoreRow.grade || 'D').toUpperCase()] || 50) * 0.3;
  return winComponent + pfComponent + gradeComponent;
}

async function generateMorningPicks(options = {}) {
  const scoreDate = toDateKey(options.scoreDate || new Date());
  const pickDate = toDateKey(options.pickDate || nextWeekday(scoreDate));
  const latestScoreResult = await queryWithTimeout(
    `SELECT *
     FROM strategy_scores
     WHERE score_date = (
       SELECT MAX(score_date) FROM strategy_scores WHERE lookback_days = 30
     )
       AND lookback_days = 30
       AND grade IN ('A', 'B')
     ORDER BY win_rate DESC, profit_factor DESC`,
    [],
    { timeoutMs: 20000, label: 'backtester.picks.latest_scores', maxRetries: 0 }
  );

  const scoreRows = latestScoreResult.rows || [];
  if (!scoreRows.length) {
    return { pickDate, picksInserted: 0, picks: [] };
  }

  const strategyMap = new Map(loadStrategyModules().map((strategy) => [strategy.id, strategy]));
  const sharedData = await buildSharedDataCaches();
  const picks = [];

  for (const scoreRow of scoreRows) {
    const strategy = strategyMap.get(scoreRow.strategy_id);
    if (!strategy) continue;

    const symbols = sharedData.symbolsByDataRequirement(strategy.dataRequired);
    for (const symbol of symbols) {
      const dataset = await loadSymbolDataset(symbol, strategy, sharedData);
      const context = sharedData.buildContext(symbol, dataset, {
        scanRange: {
          startDate: strategy.timeframe === 'intraday' ? sharedData.latestIntradayDate : sharedData.latestDailyDate,
          endDate: strategy.timeframe === 'intraday' ? sharedData.latestIntradayDate : sharedData.latestDailyDate,
        },
        projected: true,
      });
      const sourceBars = sharedData.resolveBarsForStrategy(strategy, dataset);
      const signals = await strategy.scan(symbol, sourceBars, context);
      const latestSignal = Array.isArray(signals) ? signals[signals.length - 1] : null;
      if (!latestSignal) continue;

      picks.push({
        pick_date: pickDate,
        strategy_id: strategy.id,
        symbol,
        direction: latestSignal.direction,
        entry_price: latestSignal.entryPrice,
        stop_price: latestSignal.stopPrice,
        target_price: latestSignal.targetPrice,
        confidence_score: computeConfidenceScore(scoreRow),
        strategy_win_rate: Number(scoreRow.win_rate || 0),
        strategy_grade: scoreRow.grade,
        rank: 0,
        outcome: 'pending',
        actual_pnl_r: null,
        metadata: {
          strategy_name: strategy.name,
          timeframe: strategy.timeframe,
          projected_entry_level: latestSignal.metadata?.projectedEntryLevel || null,
          source_date: latestSignal.signal_date,
          score_components: {
            win_rate: Number(scoreRow.win_rate || 0),
            profit_factor: Number(scoreRow.profit_factor || 0),
            grade: scoreRow.grade,
          },
          signal_metadata: latestSignal.metadata || {},
        },
      });
    }
  }

  const ranked = picks
    .sort((left, right) => Number(right.confidence_score || 0) - Number(left.confidence_score || 0))
    .slice(0, 25)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  await upsertRows(
    'morning_picks',
    ranked,
    {
      pick_date: 'date',
      strategy_id: 'text',
      symbol: 'text',
      direction: 'text',
      entry_price: 'numeric',
      stop_price: 'numeric',
      target_price: 'numeric',
      confidence_score: 'numeric',
      strategy_win_rate: 'numeric',
      strategy_grade: 'text',
      rank: 'integer',
      outcome: 'text',
      actual_pnl_r: 'numeric',
      metadata: 'jsonb',
    },
    ['pick_date', 'strategy_id', 'symbol'],
    ['direction', 'entry_price', 'stop_price', 'target_price', 'confidence_score', 'strategy_win_rate', 'strategy_grade', 'rank', 'outcome', 'actual_pnl_r', 'metadata'],
    'backtester.picks.upsert'
  );

  return {
    pickDate,
    picksInserted: ranked.length,
    picks: ranked,
  };
}

module.exports = {
  generateMorningPicks,
};