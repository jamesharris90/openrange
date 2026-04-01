const pg = require('pg');
const { resolveDatabaseUrl } = require('./connectionConfig');

const RawPool = pg.Pool;
const RawClient = pg.Client;
const SINGLETON_KEY = Symbol.for('openrange.db.pool.singleton');
const isTestRuntime = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);

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
const connectionTimeoutMs = 2000;
const statementTimeoutMs = Number(process.env.PG_STATEMENT_TIMEOUT_MS || 10000);
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

const DB_CONCURRENCY_LIMIT = Number(process.env.DB_CONCURRENCY_LIMIT || 5);
const dbQueryLimit = createLimiter(Number.isFinite(DB_CONCURRENCY_LIMIT) && DB_CONCURRENCY_LIMIT > 0 ? DB_CONCURRENCY_LIMIT : 5);
let currentOpsCount = 0;

function createSingletonState() {
  return {
    rawPool: null,
    dbUrl: null,
    host: null,
    port: null,
    pooled: false,
    maxConnections,
    allowDirectClient: false,
  };
}

function createRawPool(state) {
  const resolved = resolveDatabaseUrl();
  const rawPool = new RawPool({
    connectionString: resolved.dbUrl,
    ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
    max: maxConnections,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: connectionTimeoutMs,
    statement_timeout: Number.isFinite(statementTimeoutMs) && statementTimeoutMs > 0 ? statementTimeoutMs : 10000,
  });

  state.rawPool = rawPool;
  state.dbUrl = resolved.dbUrl;
  state.host = resolved.host;
  state.port = resolved.port;
  state.pooled = Boolean(resolved.pooled);

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
    console.log(`DB POOL INITIALISED (max=${maxConnections}, pooled=${state.pooled})`);
    rawPool.query('SELECT NOW() AS now').catch((err) => {
      console.error('[DB] Initial connectivity check failed:', err.message);
    });
  }

  return rawPool;
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

ensureState();

module.exports = query;
