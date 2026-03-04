const { pool } = require('../db/pg');

async function getQueueHealth() {
  const { rows } = await pool.query(`
    SELECT COUNT(*)::int AS queue_size,
           MIN(created_at) AS oldest_item
    FROM symbol_queue
  `);

  const row = rows[0] || { queue_size: 0, oldest_item: null };

  return {
    engine: 'queue',
    queue_size: Number(row.queue_size) || 0,
    oldest_item: row.oldest_item,
    status: 'ok',
  };
}

module.exports = {
  getQueueHealth,
};
