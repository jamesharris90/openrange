const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getMarketCloseForEntry(entryTime) {
  const close = new Date(entryTime);
  close.setHours(16, 0, 0, 0);
  return close;
}

function computeExitDueAt(entryTime) {
  const afterFourHours = new Date(entryTime.getTime() + (4 * 60 * 60 * 1000));
  const marketClose = getMarketCloseForEntry(entryTime);
  return afterFourHours < marketClose ? afterFourHours : marketClose;
}

async function ensureStrategyTradesTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS strategy_trades (
      id SERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      strategy TEXT NOT NULL,
      entry_price NUMERIC,
      exit_price NUMERIC,
      entry_time TIMESTAMP,
      exit_time TIMESTAMP,
      max_move NUMERIC,
      result_percent NUMERIC,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'engines.strategy_evaluation.ensure_table', maxRetries: 0 }
  );
}

async function recordNewEntries() {
  const { rowCount } = await queryWithTimeout(
    `INSERT INTO strategy_trades (
       symbol,
       strategy,
       entry_price,
       entry_time,
       created_at
     )
     SELECT
       s.symbol,
       s.strategy,
       q.price,
       (s.created_at AT TIME ZONE 'UTC'),
       NOW()
     FROM trade_signals s
     JOIN market_quotes q ON q.symbol = s.symbol
     WHERE q.price IS NOT NULL
       AND q.price > 0
       AND s.created_at >= NOW() - interval '24 hours'
       AND NOT EXISTS (
         SELECT 1
         FROM strategy_trades t
         WHERE t.symbol = s.symbol
           AND t.strategy = s.strategy
           AND t.entry_time = (s.created_at AT TIME ZONE 'UTC')
       )`,
    [],
    { timeoutMs: 12000, label: 'engines.strategy_evaluation.record_entries', maxRetries: 0 }
  );

  return rowCount || 0;
}

async function evaluateOpenTrades() {
  const { rows } = await queryWithTimeout(
    `SELECT
       t.id,
       t.symbol,
       t.strategy,
       t.entry_price,
       t.entry_time,
       q.price AS current_price,
       m.change_percent,
       m.atr_percent
     FROM strategy_trades t
     LEFT JOIN market_quotes q ON q.symbol = t.symbol
     LEFT JOIN market_metrics m ON m.symbol = t.symbol
     WHERE t.exit_time IS NULL
       AND t.entry_price IS NOT NULL
       AND t.entry_price > 0
       AND t.entry_time IS NOT NULL
     ORDER BY t.entry_time ASC`,
    [],
    { timeoutMs: 12000, label: 'engines.strategy_evaluation.select_open', maxRetries: 0 }
  );

  const now = new Date();
  let evaluated = 0;

  for (const row of rows) {
    const entryTime = toDate(row.entry_time);
    if (!entryTime) continue;

    const dueAt = computeExitDueAt(entryTime);
    if (now < dueAt) continue;

    const entryPrice = toNumber(row.entry_price);
    const exitPrice = toNumber(row.current_price, entryPrice);
    if (entryPrice <= 0 || exitPrice <= 0) continue;

    const resultPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
    const maxMove = Math.max(
      Math.abs(resultPercent),
      Math.abs(toNumber(row.change_percent)),
      Math.abs(toNumber(row.atr_percent))
    );

    await queryWithTimeout(
      `UPDATE strategy_trades
       SET
         exit_price = $1,
         exit_time = $2,
         max_move = $3,
         result_percent = $4
       WHERE id = $5`,
      [exitPrice, now, maxMove, resultPercent, row.id],
      { timeoutMs: 7000, label: 'engines.strategy_evaluation.update_trade', maxRetries: 0 }
    );

    evaluated += 1;
  }

  return evaluated;
}

async function getStrategyPerformance() {
  const { rows } = await queryWithTimeout(
    `SELECT
       strategy,
       COUNT(*)::int AS total_trades,
       ROUND(AVG(result_percent)::numeric, 4) AS avg_move,
       ROUND(MAX(max_move)::numeric, 4) AS max_move,
       ROUND((AVG(CASE WHEN result_percent > 0 THEN 1 ELSE 0 END) * 100)::numeric, 2) AS win_rate,
       ROUND(
         COALESCE(
           AVG(CASE WHEN result_percent > 0 THEN result_percent END)
           / NULLIF(ABS(AVG(CASE WHEN result_percent < 0 THEN result_percent END)), 0),
           0
         )::numeric,
         4
       ) AS risk_reward
     FROM strategy_trades
     WHERE result_percent IS NOT NULL
     GROUP BY strategy
     ORDER BY win_rate DESC NULLS LAST, avg_move DESC NULLS LAST`,
    [],
    { timeoutMs: 10000, label: 'engines.strategy_evaluation.performance', maxRetries: 0 }
  );

  return rows;
}

async function runStrategyEvaluationEngine() {
  await ensureStrategyTradesTable();

  const inserted = await recordNewEntries();
  const evaluated = await evaluateOpenTrades();

  const result = { inserted, evaluated };
  logger.info('[STRATEGY_EVALUATION] run complete', result);
  return result;
}

module.exports = {
  runStrategyEvaluationEngine,
  getStrategyPerformance,
};
