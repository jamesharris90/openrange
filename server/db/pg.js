const pg = require('pg');
const sharedQuery = require('./pool');
const { AsyncLocalStorage } = require('async_hooks');

const SINGLETON_KEY = Symbol.for('openrange.db.pool.singleton');

function createPoolFacade() {
  return {
    query: sharedQuery,
    end: sharedQuery.end,
    connect: sharedQuery.connect,
    get totalCount() {
      return sharedQuery.getStats().totalCount;
    },
    get idleCount() {
      return sharedQuery.getStats().idleCount;
    },
    get waitingCount() {
      return sharedQuery.getStats().waitingCount;
    },
  };
}

const poolRead = Object.freeze(createPoolFacade());
const poolWrite = Object.freeze(createPoolFacade());

const dbContext = new AsyncLocalStorage();

console.log(`DB pool configured: shared(max=${sharedQuery.getStats().maxConnections}) idle=5s timeout=2s`);

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

function isWriteBlockedBySystemGuard(sql) {
  if (global.systemBlocked !== true) return false;

  const source = String(sql || '');
  const normalized = source.toLowerCase().replace(/\s+/g, ' ');
  const isWrite = /^\s*(insert|update|delete|alter|create|drop)\b/i.test(source);
  if (!isWrite) return false;

  const touchesGuardedTables = /\b(signals|signal_outcomes|trade_outcomes)\b/.test(normalized);
  return touchesGuardedTables;
}

async function runQuery(sql, params = [], label = 'db.query', poolType = 'read') {
  if (isWriteBlockedBySystemGuard(sql)) {
    const reason = global.systemBlockedReason || 'unknown';
    const error = new Error('WRITE BLOCKED BY SYSTEM GUARD');
    error.code = 'SYSTEM_GUARD_WRITE_BLOCKED';
    console.error('WRITE BLOCKED BY SYSTEM GUARD', { label, reason });
    throw error;
  }

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

function getSharedPoolState() {
  sharedQuery.getStats();
  return global[SINGLETON_KEY] || null;
}

function getRawPoolHandle() {
  const state = getSharedPoolState();
  if (!state?.rawPool || typeof state.rawPool.connect !== 'function') {
    throw new Error('Shared DB raw pool is unavailable');
  }
  return { state, rawPool: state.rawPool };
}

async function cancelRunningQuery(pid, label) {
  if (!pid) {
    return;
  }

  const state = getSharedPoolState();
  const connectionString = state?.dbUrl;
  if (!connectionString) {
    throw new Error('Shared DB state is missing an active connection string');
  }

  const previousAllowDirectClient = Boolean(state.allowDirectClient);
  state.allowDirectClient = true;

  const cancelClient = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await cancelClient.connect();
    await cancelClient.query('SELECT pg_cancel_backend($1)', [pid]);
  } catch (error) {
    console.error('[pg] cancel failed:', label, error.message);
  } finally {
    state.allowDirectClient = previousAllowDirectClient;
    await cancelClient.end().catch(() => {});
  }
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
  let client = null;
  let didTimeout = false;
  let timeoutError = null;
  let cancelPromise = null;

  try {
    const { rawPool } = getRawPoolHandle();

    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        didTimeout = true;
        timeoutError = createTimeoutError(timeoutMs, label);
        cancelPromise = client?.processID
          ? cancelRunningQuery(client.processID, label)
          : Promise.resolve();
        reject(timeoutError);
      }, timeoutMs);
    });

    const queryPromise = (async () => {
      client = await rawPool.connect();

      if (didTimeout) {
        throw timeoutError || createTimeoutError(timeoutMs, label);
      }

      try {
        return await client.query(sql, params);
      } catch (error) {
        if (didTimeout) {
          throw timeoutError || createTimeoutError(timeoutMs, label);
        }
        console.error('DB query failed:', error.message, `(${label})`);
        throw error;
      }
    })();

    const result = await Promise.race([
      queryPromise,
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

    if (cancelPromise) {
      await cancelPromise.catch(() => {});
    }

    if (client) {
      try {
        if (didTimeout) {
          client.release(timeoutError || createTimeoutError(timeoutMs, label));
        } else {
          client.release();
        }
      } catch (_error) {
        // Ignore release failures after timeout/cancel.
      }
    }
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

function getPoolStats() {
  return sharedQuery.getStats();
}

async function resetPool() {
  return sharedQuery.reset();
}

module.exports = {
  pool,
  poolRead,
  poolWrite,
  query: sharedQuery,
  queryWithTimeout,
  runWithDbPool,
  getPoolStats,
  resetPool,
};
