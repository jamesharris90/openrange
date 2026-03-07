const db = require('../db');

async function evaluateSignals() {
  console.log('[SIGNAL PERFORMANCE] evaluation started');

  const signals = await db.query(`
    SELECT *
    FROM strategy_signals
    WHERE created_at >= NOW() - interval '1 day'
  `);

  for (const signal of signals.rows) {
    console.log('[SIGNAL PERFORMANCE] processing', signal.symbol);

    const priceData = await db.query(`
      SELECT close
      FROM market_metrics
      WHERE symbol = $1
      LIMIT 1
    `, [signal.symbol]);

    if (!priceData.rows.length) continue;

    const currentPrice = priceData.rows[0].close;
    const entryPrice = signal.entry_price || currentPrice;

    const upside = ((currentPrice - entryPrice) / entryPrice) * 100;
    const drawdown = ((entryPrice - currentPrice) / entryPrice) * 100;

    let outcome = null;

    if (upside >= 2) outcome = 'WIN';
    if (drawdown >= 2) outcome = 'LOSS';

    await db.query(`
      INSERT INTO signal_performance
      (signal_id, symbol, strategy, class, score, probability,
       entry_price, max_upside, max_drawdown, outcome, evaluated_at)

      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())

      ON CONFLICT (signal_id)
      DO UPDATE SET
        max_upside = GREATEST(signal_performance.max_upside, EXCLUDED.max_upside),
        max_drawdown = GREATEST(signal_performance.max_drawdown, EXCLUDED.max_drawdown),
        outcome = COALESCE(EXCLUDED.outcome, signal_performance.outcome),
        evaluated_at = NOW();
    `, [
      signal.id,
      signal.symbol,
      signal.strategy,
      signal.class,
      signal.score,
      signal.probability,
      entryPrice,
      upside,
      drawdown,
      outcome,
    ]);
  }

  console.log('[SIGNAL PERFORMANCE] run completed');
}

module.exports = { evaluateSignals };
