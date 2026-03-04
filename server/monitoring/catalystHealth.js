const { pool } = require('../db/pg');

async function getCatalystHealth() {
  const { rows } = await pool.query(`
    SELECT COUNT(*)::int AS catalyst_count,
           MAX(published_at) AS last_catalyst_at
    FROM trade_catalysts
  `);

  const row = rows[0] || { catalyst_count: 0, last_catalyst_at: null };

  return {
    engine: 'catalyst',
    catalyst_count: Number(row.catalyst_count) || 0,
    last_catalyst_at: row.last_catalyst_at,
    status: 'ok',
  };
}

module.exports = {
  getCatalystHealth,
};
