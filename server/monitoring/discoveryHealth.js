const { pool } = require('../db/pg');

async function getDiscoveryHealth() {
  try {
    const { rows } = await pool.query(`
      SELECT COUNT(*)::int AS discovered_symbol_count,
             MAX(detected_at) AS last_detected_at
      FROM discovered_symbols
    `);

    const row = rows[0] || { discovered_symbol_count: 0, last_detected_at: null };

    return {
      engine: 'discovery',
      discovered_symbol_count: Number(row.discovered_symbol_count) || 0,
      last_detected_at: row.last_detected_at,
      status: 'ok',
    };
  } catch {
    return {
      engine: 'discovery',
      discovered_symbol_count: 0,
      last_detected_at: null,
      status: 'degraded',
    };
  }
}

module.exports = {
  getDiscoveryHealth,
};
