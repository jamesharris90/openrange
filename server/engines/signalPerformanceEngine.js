const db = require('../db');

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function classifyOutcome(maxUpside, maxDrawdown) {
  if (maxUpside >= 0.05) return 'WIN';
  if (maxDrawdown <= -0.03) return 'LOSS';
  return 'NEUTRAL';
}

async function runSignalPerformanceEngine() {
  const signalsResult = await db.query(
    `SELECT id, symbol, strategy, class, change_percent, updated_at
     FROM strategy_signals
     WHERE updated_at > NOW() - INTERVAL '24 hours'`
  );

  const signals = Array.isArray(signalsResult?.rows) ? signalsResult.rows : [];
  console.log(`[PERFORMANCE] evaluated signals: ${signals.length}`);

  let inserted = 0;

  for (const signal of signals) {
    const duplicate = await db.query(
      `SELECT id
       FROM signal_performance
       WHERE signal_id = $1
       LIMIT 1`,
      [signal.id]
    );

    if (duplicate.rows.length > 0) {
      continue;
    }

    const intradayExtremes = await db.query(
      `SELECT
         MIN(i.low)::numeric AS min_price,
         MAX(i.high)::numeric AS max_price
       FROM intraday_1m i
       WHERE i.symbol = $1
         AND i.timestamp >= $2`,
      [signal.symbol, signal.updated_at]
    );

    const entryRow = await db.query(
      `SELECT i.close::numeric AS entry_price
       FROM intraday_1m i
       WHERE i.symbol = $1
         AND i.timestamp >= $2
       ORDER BY i.timestamp ASC
       LIMIT 1`,
      [signal.symbol, signal.updated_at]
    );

    let entryPrice = toNumber(entryRow.rows[0]?.entry_price);

    if (!entryPrice || entryPrice <= 0) {
      const fallback = await db.query(
        `SELECT m.price::numeric AS fallback_price
         FROM market_metrics m
         WHERE m.symbol = $1
         LIMIT 1`,
        [signal.symbol]
      );
      entryPrice = toNumber(fallback.rows[0]?.fallback_price);
    }

    if (!entryPrice || entryPrice <= 0) {
      continue;
    }

    const maxPrice = toNumber(intradayExtremes.rows[0]?.max_price) ?? entryPrice;
    const minPrice = toNumber(intradayExtremes.rows[0]?.min_price) ?? entryPrice;

    const maxUpside = (maxPrice - entryPrice) / entryPrice;
    const maxDrawdown = (minPrice - entryPrice) / entryPrice;
    const outcome = classifyOutcome(maxUpside, maxDrawdown);

    await db.query(
      `INSERT INTO signal_performance
       (signal_id, symbol, strategy, class, entry_price, max_upside, max_drawdown, outcome, evaluated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        signal.id,
        signal.symbol,
        signal.strategy,
        signal.class,
        entryPrice,
        maxUpside,
        maxDrawdown,
        outcome,
      ]
    );

    inserted += 1;
  }

  console.log(`[PERFORMANCE] new records inserted: ${inserted}`);

  return {
    evaluatedSignals: signals.length,
    inserted,
  };
}

module.exports = { runSignalPerformanceEngine };
