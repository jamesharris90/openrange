const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

async function ensureExpectedMovesTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS expected_moves (
      symbol TEXT PRIMARY KEY,
      expected_move NUMERIC,
      atr_percent NUMERIC,
      price NUMERIC,
      earnings_date DATE,
      updated_at TIMESTAMPTZ DEFAULT now()
    )`,
    [],
    { timeoutMs: 5000, label: 'engines.expectedMove.ensure_table', maxRetries: 0 }
  );
}

async function runExpectedMoveEngine() {
  const startedAt = Date.now();
  await ensureExpectedMovesTable();

  const { rows } = await queryWithTimeout(
    `SELECT
      e.symbol,
      e.earnings_date,
      COALESCE(m.price, q.price, 0) AS price,
      COALESCE(
        m.atr_percent,
        CASE
          WHEN COALESCE(m.price, q.price) > 0 AND m.atr IS NOT NULL
            THEN (m.atr / COALESCE(m.price, q.price)) * 100
          ELSE NULL
        END,
        ABS(m.gap_percent),
        ABS(COALESCE(m.change_percent, q.change_percent)),
        0
      ) AS atr_percent
    FROM earnings_events e
    LEFT JOIN market_metrics m ON m.symbol = e.symbol
    LEFT JOIN market_quotes q ON q.symbol = e.symbol
    WHERE e.earnings_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'`,
    [],
    { timeoutMs: 10000, label: 'engines.expectedMove.select', maxRetries: 0 }
  );

  for (const row of rows) {
    const price = Number(row.price || 0);
    const atrPercent = Number(row.atr_percent || 0);
    const expectedMove = price > 0 && atrPercent > 0
      ? (price * atrPercent) / 100
      : 0;

    await queryWithTimeout(
      `INSERT INTO expected_moves (symbol, expected_move, atr_percent, price, earnings_date, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (symbol)
       DO UPDATE SET
         expected_move = EXCLUDED.expected_move,
         atr_percent = EXCLUDED.atr_percent,
         price = EXCLUDED.price,
         earnings_date = EXCLUDED.earnings_date,
         updated_at = now()`,
      [row.symbol, expectedMove, atrPercent, price, row.earnings_date],
      { timeoutMs: 5000, label: 'engines.expectedMove.upsert', maxRetries: 0 }
    );
  }

  const runtimeMs = Date.now() - startedAt;
  logger.info('Expected move engine complete', { updated: rows.length, runtimeMs });
  return { updated: rows.length, runtimeMs };
}

module.exports = {
  runExpectedMoveEngine,
};
