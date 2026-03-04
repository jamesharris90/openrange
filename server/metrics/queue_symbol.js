const fs = require('fs').promises;
const path = require('path');
const { pool } = require('../db/pg');
const logger = require('../logger');

let queueReady = false;

async function ensureQueueTable() {
  if (queueReady) return;
  const sqlPath = path.join(__dirname, '..', 'migrations', 'create_symbol_queue.sql');
  const sql = await fs.readFile(sqlPath, 'utf8');
  await pool.query(sql);
  queueReady = true;
}

async function queueSymbol(symbol, reason = 'unknown', options = {}) {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (!normalized) return false;

  await ensureQueueTable();

  await pool.query(
    `INSERT INTO symbol_queue(symbol, reason, created_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (symbol)
     DO UPDATE SET reason = EXCLUDED.reason,
                   created_at = NOW()`,
    [normalized, reason]
  );

  if (!options.silent) {
    logger.info('symbol queued', {
      scope: 'queue',
      symbol: normalized,
      reason,
    });
  }

  return true;
}

module.exports = {
  ensureQueueTable,
  queueSymbol,
};
