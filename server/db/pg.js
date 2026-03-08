const sharedPool = require('./pool');
const { AsyncLocalStorage } = require('async_hooks');

const poolRead = sharedPool;
const poolWrite = sharedPool;

const dbContext = new AsyncLocalStorage();

console.log(`DB pool configured: shared(max=${process.env.PGPOOL_MAX || 5}) idle=30s timeout=5s`);
console.log('DB pool initialised');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTimeoutError(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === 'QUERY_TIMEOUT' || message.includes('timeout');
}

function getPoolByType(poolType) {
  if (poolType === 'write') return poolWrite;
  return poolRead;
}

function resolvePoolType(explicitPoolType) {
  if (explicitPoolType === 'read' || explicitPoolType === 'write') return explicitPoolType;
  const context = dbContext.getStore();
  if (context?.poolType === 'read' || context?.poolType === 'write') return context.poolType;
  return 'read';
}

async function runQuery(sql, params = [], label = 'db.query', poolType = 'read') {
  const pool = getPoolByType(poolType);
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
  const poolType = resolvePoolType(options.poolType);
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
      runQuery(sql, params, label, poolType),
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

function runWithDbPool(poolType, fn) {
  if (poolType !== 'read' && poolType !== 'write') {
    return Promise.resolve().then(() => fn());
  }
  return dbContext.run({ poolType }, () => Promise.resolve().then(() => fn()));
}

// Backward compatibility: keep `pool` as read pool for API queries.
const pool = poolRead;

module.exports = {
  pool,
  poolRead,
  poolWrite,
  queryWithTimeout,
  runWithDbPool,
};
