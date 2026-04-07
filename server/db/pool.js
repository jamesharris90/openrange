const pg = require('pg');
const { resolveDatabaseUrl } = require('./connectionConfig');

const RawPool = pg.Pool;
const RawClient = pg.Client;
const SINGLETON_KEY = Symbol.for('openrange.db.pool.singleton');
const isTestRuntime = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);

function isPoolerSaturationError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('max client connections reached')
    || message.includes('too many clients')
    || message.includes('remaining connection slots are reserved')
  );
}

function buildDirectSupabaseUrl(dbUrl) {
  try {
    const parsed = new URL(dbUrl);
    const username = String(parsed.username || '');
    const usernameParts = username.split('.');
    const projectRef = usernameParts[1];
    if (!projectRef) {
      return null;
    }

    parsed.hostname = `db.${projectRef}.supabase.co`;
    parsed.port = '5432';
    parsed.username = usernameParts[0] || 'postgres';
    return parsed.toString();
  } catch (_error) {
    return null;
  }
}

function installPgRuntimeGuard() {
  if (pg.__openrangePoolGuardInstalled) return;

  pg.Pool = class GuardedPool extends RawPool {
    constructor(...args) {
      if (global[SINGLETON_KEY]?.rawPool) {
        throw new Error('Multiple pg.Pool instances are forbidden. Use server/db/pg query helpers only.');
      }
      super(...args);
    }
  };

  pg.Client = class GuardedClient extends RawClient {
    constructor(...args) {
      if (!global[SINGLETON_KEY]?.allowDirectClient) {
        throw new Error('Direct pg.Client connections are forbidden. Use the shared DB query layer.');
      }
      super(...args);
    }
  };

  pg.__openrangePoolGuardInstalled = true;
}

installPgRuntimeGuard();

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

const maxConnections = 10;
const connectionTimeoutMs = Number(process.env.PG_CONNECTION_TIMEOUT_MS || 10000);
const statementTimeoutMs = Number(process.env.PG_STATEMENT_TIMEOUT_MS || 10000);
const idleTimeoutMs = 30000;
const shouldUseSsl = process.env.PGSSL_DISABLE !== 'true';

function maskDbUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch (_error) {
    return '[invalid DATABASE_URL]';
  }
}

const DB_CONCURRENCY_LIMIT = Math.max(
  1,
  Math.min(Number(process.env.DB_CONCURRENCY_LIMIT || maxConnections) || maxConnections, maxConnections)
);
const dbQueryLimit = createLimiter(DB_CONCURRENCY_LIMIT);
let currentOpsCount = 0;

function createSingletonState() {
  return {
    rawPool: null,
    dbUrl: null,
    primaryDbUrl: null,
    directDbUrl: null,
    host: null,
    port: null,
    pooled: false,
    usingDirectFallback: false,
    failoverInProgress: null,
    maxConnections,
    allowDirectClient: false,
  };
}

function createRawPool(state, options = {}) {
  const { directFallback = false } = options;
  const resolved = resolveDatabaseUrl();
  const primaryDbUrl = process.env.DATABASE_URL || resolved.dbUrl;
  const directDbUrl = buildDirectSupabaseUrl(primaryDbUrl);
  const targetDbUrl = directFallback && directDbUrl ? directDbUrl : primaryDbUrl;
  const targetHost = new URL(targetDbUrl).hostname;
  const targetPort = Number(new URL(targetDbUrl).port || (directFallback ? 5432 : resolved.port || 5432));
  const rawPool = new RawPool({
    connectionString: targetDbUrl,
    ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
    family: directFallback ? 4 : undefined,
    max: maxConnections,
    idleTimeoutMillis: idleTimeoutMs,
    connectionTimeoutMillis: connectionTimeoutMs,
    statement_timeout: Number.isFinite(statementTimeoutMs) && statementTimeoutMs > 0 ? statementTimeoutMs : 10000,
    application_name: process.env.PG_APP_NAME || (directFallback ? 'openrange-v2-direct-fallback' : 'openrange-v2-manual'),
  });

  state.rawPool = rawPool;
  state.primaryDbUrl = primaryDbUrl;
  state.directDbUrl = directDbUrl;
  state.dbUrl = targetDbUrl;
  state.host = targetHost;
  state.port = targetPort;
  state.pooled = directFallback ? false : Boolean(resolved.pooled);
  state.usingDirectFallback = Boolean(directFallback && directDbUrl);

  rawPool.on('connect', () => {
    if (!isTestRuntime) {
      console.log(`[DB] Connected to: ${maskDbUrl(state.dbUrl)}`);
      console.log(`DB CONNECTED TO: ${state.host}`);
    }
  });

  rawPool.on('error', (err) => {
    console.error('[PG POOL ERROR]', err.message);
  });

  if (!isTestRuntime) {
    console.log(`DB POOL INITIALISED (max=${maxConnections}, pooled=${state.pooled}, idle=${idleTimeoutMs}ms, directFallback=${state.usingDirectFallback})`);
  }

  return rawPool;
}

async function enableDirectFallback(state) {
  if (state.usingDirectFallback || !state.directDbUrl) {
    return;
  }

  if (!state.failoverInProgress) {
    state.failoverInProgress = (async () => {
      const previousPool = state.rawPool;
      state.rawPool = null;
      try {
        if (!isTestRuntime) {
          console.warn('[DB] Pooler saturated, switching to direct Supabase connection');
        }
        if (previousPool) {
          await previousPool.end().catch(() => {});
        }
        createRawPool(state, { directFallback: true });
      } finally {
        state.failoverInProgress = null;
      }
    })();
  }

  await state.failoverInProgress;
}

function ensureState() {
  if (!global[SINGLETON_KEY]) {
    global[SINGLETON_KEY] = createSingletonState();
  }

  if (!global[SINGLETON_KEY].rawPool) {
    createRawPool(global[SINGLETON_KEY]);
  }

  return global[SINGLETON_KEY];
}

async function query(...args) {
  const state = ensureState();
  return dbQueryLimit(async () => {
    currentOpsCount += 1;
    if (!isTestRuntime) {
      console.log('Active DB Ops:', currentOpsCount);
    }
    try {
      return await state.rawPool.query(...args);
    } catch (error) {
      if (isPoolerSaturationError(error) && state.pooled && state.directDbUrl && !state.usingDirectFallback) {
        await enableDirectFallback(state);
        return state.rawPool.query(...args);
      }
      throw error;
    } finally {
      currentOpsCount = Math.max(0, currentOpsCount - 1);
      if (!isTestRuntime) {
        console.log('Active DB Ops:', currentOpsCount);
      }
    }
  });
}

query.query = query;
query.connect = async () => {
  throw new Error('pool.connect() is disabled. Use the shared query layer only.');
};
query.getStats = () => {
  const state = ensureState();
  return {
    totalCount: Number(state.rawPool?.totalCount || 0),
    idleCount: Number(state.rawPool?.idleCount || 0),
    waitingCount: Number(state.rawPool?.waitingCount || 0),
    maxConnections: state.maxConnections,
    pooled: state.pooled,
    host: state.host,
    port: state.port,
    activeOps: currentOpsCount,
  };
};
query.reset = async () => {
  const state = ensureState();
  const previousPool = state.rawPool;
  state.rawPool = null;
  if (previousPool) {
    await previousPool.end().catch(() => {});
  }
  createRawPool(state);
  return query.getStats();
};
query.end = async () => {
  const state = ensureState();
  if (!state.rawPool) return;
  const currentPool = state.rawPool;
  state.rawPool = null;
  await currentPool.end();
};

Object.defineProperties(query, {
  totalCount: { get: () => query.getStats().totalCount },
  idleCount: { get: () => query.getStats().idleCount },
  waitingCount: { get: () => query.getStats().waitingCount },
});

module.exports = query;
