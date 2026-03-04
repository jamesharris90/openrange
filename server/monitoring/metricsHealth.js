const { pool } = require('../db/pg');

async function getMetricsHealth() {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)::int AS row_count,
      MAX(last_updated) AS last_update
    FROM market_metrics
  `);

  const row = rows[0] || { row_count: 0, last_update: null };

  return {
    engine: 'metrics',
    rows: Number(row.row_count) || 0,
    last_update: row.last_update,
    status: 'ok',
  };
}

module.exports = {
  getMetricsHealth,
};
