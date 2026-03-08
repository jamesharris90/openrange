const { Pool } = require('pg');

const maxConnections = Number(process.env.PGPOOL_MAX || 5);
const shouldUseSsl = process.env.PGSSL_DISABLE !== 'true';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
  max: Number.isFinite(maxConnections) && maxConnections > 0 ? maxConnections : 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  statement_timeout: 10000,
});

pool.on('connect', () => {
  console.log('[DB] PostgreSQL pool connected');
});

pool.on('error', (err) => {
  console.error('[PG POOL ERROR]', err.message);
});

module.exports = pool;
