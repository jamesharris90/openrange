const { Pool } = require('pg');
const { resolveDatabaseUrl } = require('./connectionConfig');

function createLimiter(maxConcurrent) {
  let active = 0;
  const queue = [];

  const runNext = () => {
    if (active >= maxConcurrent) return;
    const next = queue.shift();
    if (!next) return;

    active += 1;
    Promise.resolve()
      .then(next.fn)
      .then(next.resolve, next.reject)
      .finally(() => {
        active -= 1;
        runNext();
      });
  };

  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    runNext();
  });
}

const maxConnections = Number(process.env.PGPOOL_MAX || 20);
const connectionTimeoutMs = Number(process.env.PGPOOL_CONNECTION_TIMEOUT_MS || 10000);
const statementTimeoutMs = Number(process.env.PG_STATEMENT_TIMEOUT_MS || 10000);
const shouldUseSsl = process.env.PGSSL_DISABLE !== 'true';

const { dbUrl, host: activeDbHost } = resolveDatabaseUrl();

function maskDbUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch (_error) {
    return '[invalid DATABASE_URL]';
  }
}

const pool = new Pool({
  connectionString: dbUrl,
  ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
  max: Number.isFinite(maxConnections) && maxConnections > 0 ? maxConnections : 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: Number.isFinite(connectionTimeoutMs) && connectionTimeoutMs > 0 ? connectionTimeoutMs : 10000,
  statement_timeout: Number.isFinite(statementTimeoutMs) && statementTimeoutMs > 0 ? statementTimeoutMs : 10000,
});

const DB_CONCURRENCY_LIMIT = Number(process.env.DB_CONCURRENCY_LIMIT || 5);
const dbQueryLimit = createLimiter(Number.isFinite(DB_CONCURRENCY_LIMIT) && DB_CONCURRENCY_LIMIT > 0 ? DB_CONCURRENCY_LIMIT : 5);
let currentOpsCount = 0;

const rawQuery = pool.query.bind(pool);
pool.query = (...args) => dbQueryLimit(async () => {
  currentOpsCount += 1;
  console.log('Active DB Ops:', currentOpsCount);
  try {
    return await rawQuery(...args);
  } finally {
    currentOpsCount = Math.max(0, currentOpsCount - 1);
    console.log('Active DB Ops:', currentOpsCount);
  }
});

pool.on('connect', () => {
  console.log(`[DB] Connected to: ${maskDbUrl(dbUrl)}`);
  console.log(`DB CONNECTED TO: ${activeDbHost}`);
});

pool.on('error', (err) => {
  console.error('[PG POOL ERROR]', err.message);
});

pool.query('SELECT NOW() AS now').catch((err) => {
  console.error('[DB] Initial connectivity check failed:', err.message);
});

module.exports = pool;
