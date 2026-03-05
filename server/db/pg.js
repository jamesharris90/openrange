const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase')
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected PG pool error:', err.message);
});

function createTimeoutError(timeoutMs, label) {
  const error = new Error(`Query timeout after ${timeoutMs}ms${label ? ` (${label})` : ''}`);
  error.code = 'QUERY_TIMEOUT';
  return error;
}

async function queryWithTimeout(sql, params = [], options = {}) {
  const timeoutMs = Number(options.timeoutMs) || 5000;
  const slowQueryMs = Number(options.slowQueryMs) || 1000;
  const label = options.label || 'db.query';
  const startedAt = Date.now();

  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(createTimeoutError(timeoutMs, label));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([
      pool.query(sql, params),
      timeoutPromise,
    ]);
    const durationMs = Date.now() - startedAt;
    if (durationMs >= slowQueryMs) {
      console.warn(`[DB_SLOW_QUERY] ${label} took ${durationMs}ms`);
    }
    return result;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

module.exports = { pool, queryWithTimeout };
