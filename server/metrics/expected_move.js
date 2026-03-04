const { pool } = require('../db/pg');

function expectedMoveFromAtr(atr) {
  const value = Number(atr);
  if (!Number.isFinite(value)) return null;
  return value * 1.5;
}

async function getExpectedMoveRows(limit = 100) {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 500));

  const { rows } = await pool.query(
    `SELECT symbol,
            price,
            atr,
            (atr * 1.5)::numeric AS expected_move,
            last_updated
     FROM market_metrics
     WHERE atr IS NOT NULL
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
