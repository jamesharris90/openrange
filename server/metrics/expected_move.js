const { pool } = require('../db/pg');

function expectedMoveFromAtr(atr) {
  const value = Number(atr);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(value * 2, 10);
}

async function getExpectedMoveRows(limit = 100) {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 500));

  const { rows } = await pool.query(
    `SELECT symbol,
            price,
            atr,
            LEAST((atr / NULLIF(price, 0)) * 100 * 2, 10) AS expected_move,
            last_updated
     FROM market_metrics
     WHERE atr IS NOT NULL AND atr > 0
     ORDER BY atr DESC
     LIMIT $1`,
    [boundedLimit]
  );

  return rows;
}

module.exports = {
  expectedMoveFromAtr,
  getExpectedMoveRows,
};
