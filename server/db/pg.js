const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

console.log('DB pool configured: max=10 idle=30s timeout=5s');
console.log('DB pool initialised');

pool.on('error', (err) => {
  console.error('Unexpected PG pool error:', err.message);
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTimeoutError(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === 'QUERY_TIMEOUT' || message.includes('timeout');
}

async function runQuery(sql, params = [], label = 'db.query') {
  return pool.query(sql, params).catch((err) => {
    console.error('DB query failed:', err.message, `(${label})`);
    throw err;
  });
}

function createTimeoutError(timeoutMs, label) {
  const error = new Error(`Query timeout after ${timeoutMs}ms${label ? ` (${label})` : ''}`);
  error.code = 'QUERY_TIMEOUT';
  return error;
}

async function queryWithTimeout(sql, params = [], options = {}, attempt = 0) {
  const timeoutMs = Number(options.timeoutMs) || 5000;
  const slowQueryMs = Number(options.slowQueryMs) || 1000;
  const label = options.label || 'db.query';
  const maxRetries = Number(options.maxRetries ?? 1);
  const retryDelayMs = Number(options.retryDelayMs ?? 200);
  const startedAt = Date.now();

  let timeoutHandle;

  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(createTimeoutError(timeoutMs, label));
      }, timeoutMs);
    });

    const result = await Promise.race([
      runQuery(sql, params, label),
      timeoutPromise,
    ]);
    const durationMs = Date.now() - startedAt;
    if (durationMs >= slowQueryMs) {
      console.warn(`[DB_SLOW_QUERY] ${label} took ${durationMs}ms`);
    }
    return result;
  } catch (err) {
    if (isTimeoutError(err)) {
      console.warn(`DB query timeout detected: ${label}`);
    }

    if (isTimeoutError(err) && attempt < maxRetries) {
      await sleep(retryDelayMs);
      return queryWithTimeout(sql, params, options, attempt + 1);
    }

    throw err;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

module.exports = { pool, queryWithTimeout };
