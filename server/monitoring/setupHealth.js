const { pool } = require('../db/pg');

async function getSetupHealth() {
  const { rows } = await pool.query(`
    SELECT COUNT(*)::int AS setup_count,
           MAX(detected_at) AS last_setup_at
    FROM trade_setups
  `);

  const row = rows[0] || { setup_count: 0, last_setup_at: null };

  return {
    engine: 'strategy',
    setup_count: Number(row.setup_count) || 0,
    last_setup_at: row.last_setup_at,
    status: 'ok',
  };
}

module.exports = {
  getSetupHealth,
};
