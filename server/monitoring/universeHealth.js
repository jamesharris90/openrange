const { pool } = require('../db/pg');

async function getUniverseHealth() {
  const { rows } = await pool.query(`
    SELECT COUNT(*)::int AS total_symbols,
           MAX(last_updated) AS last_update
    FROM ticker_universe
  `);

  const row = rows[0] || { total_symbols: 0, last_update: null };

  return {
    engine: 'universe',
    total_symbols: Number(row.total_symbols) || 0,
    last_update: row.last_update,
    status: 'ok',
  };
}

module.exports = {
  getUniverseHealth,
};
