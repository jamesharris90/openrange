const { pool, queryWithTimeout } = require('../../db/pg');
const { getCache, setCache } = require('../cache/memoryCache');
const { getScreenerRows } = require('./screenerService');
const { buildOpportunitiesPayload } = require('./opportunitiesService');

const SNAPSHOT_CACHE_KEY = 'screener-v2-snapshot';
const SNAPSHOT_CACHE_TTL_MS = 120000;
const SNAPSHOT_READ_RETRY_BACKOFF_MS = 10000;
const PROFILE_BATCH_SIZE = 500;

let lastSnapshotRecord = null;
let nextSnapshotReadAttemptAt = 0;

function isDbSaturationError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('max client connections reached')
    || message.includes('too many clients')
    || message.includes('connection terminated unexpectedly')
    || message.includes('remaining connection slots are reserved')
  );
}

function isSnapshotStartupSkippableError(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();

  return (
    isDbSaturationError(error)
    || code === 'ENETUNREACH'
    || code === 'EHOSTUNREACH'
    || code === 'ECONNRESET'
    || code === 'ECONNREFUSED'
    || code === 'ETIMEDOUT'
    || code === 'QUERY_TIMEOUT'
    || message.includes('network is unreachable')
    || message.includes('connect enetunreach')
    || message.includes('connection terminated unexpectedly')
  );
}

function withSnapshotTimestamp(payload, snapshotAt) {
  return {
    ...payload,
    snapshot_at: snapshotAt,
  };
}

function getWarmupPayload() {
  return { status: 'warming_up' };
}

function toAgeSeconds(timestamp) {
  if (!timestamp) {
    return null;
  }

  const value = new Date(timestamp).getTime();
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.floor((Date.now() - value) / 1000));
}

function normalizeSymbol(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null;
}

function deriveInstrumentType(profile = {}) {
  const companyName = String(profile.company_name || '').toLowerCase();
  const industry = String(profile.industry || '').toLowerCase();
  const sector = String(profile.sector || '').toLowerCase();
  const combined = `${companyName} ${industry} ${sector}`;

  if (/\b(reit|real estate investment trust)\b/.test(combined)) {
    return 'REIT';
  }

  if (/\b(etf|exchange traded fund|exchange-traded fund)\b/.test(combined)) {
    return 'ETF';
  }

  if (/\b(adr|ads|american depositary|depositary receipt)\b/.test(combined)) {
    return 'ADR';
  }

  if (/\b(closed-end fund|closed end fund|fund|trust|unit|income shares)\b/.test(combined)) {
    return 'FUND';
  }

  return 'STOCK';
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function hydrateInstrumentTypes(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.every((row) => row?.instrument_type)) {
    return rows;
  }

  const symbols = Array.from(new Set(rows.map((row) => normalizeSymbol(row?.symbol)).filter(Boolean)));
  if (symbols.length === 0) {
    return rows;
  }

  const profiles = [];
  for (const batch of chunkArray(symbols, PROFILE_BATCH_SIZE)) {
    const result = await runSnapshotQuery(
      `SELECT symbol, company_name, industry, sector, exchange
       FROM company_profiles
       WHERE symbol = ANY($1::text[])`,
      [batch],
      {
        onSaturationMessage: 'DB SATURATED — SKIPPING SNAPSHOT INSTRUMENT TYPE HYDRATION',
        returnNullOnSaturation: true,
      }
    );

    if (result?.rows?.length) {
      profiles.push(...result.rows);
    }
  }

  const profileBySymbol = new Map(profiles.map((row) => [normalizeSymbol(row.symbol), row]));
  return rows.map((row) => {
    if (!row || row.instrument_type) {
      return row;
    }

    const profile = profileBySymbol.get(normalizeSymbol(row.symbol)) || null;
    return {
      ...row,
      exchange: row.exchange || profile?.exchange || null,
      instrument_type: deriveInstrumentType(profile || {}),
    };
  });
}

function getSnapshotFromCache() {
  return getCache(SNAPSHOT_CACHE_KEY) || lastSnapshotRecord;
}

function setSnapshotCache(snapshot) {
  lastSnapshotRecord = snapshot || lastSnapshotRecord;
  setCache(SNAPSHOT_CACHE_KEY, snapshot, SNAPSHOT_CACHE_TTL_MS);
}

function deferSnapshotReadAttempt() {
  nextSnapshotReadAttemptAt = Date.now() + SNAPSHOT_READ_RETRY_BACKOFF_MS;
}

function clearSnapshotReadDeferral() {
  nextSnapshotReadAttemptAt = 0;
}

async function runSnapshotQuery(sql, params = [], options = {}) {
  const {
    onSaturationMessage = 'DB SATURATED — SKIPPING SNAPSHOT CYCLE',
    returnNullOnSaturation = false,
  } = options;

  try {
    return await pool.query(sql, params);
  } catch (error) {
    if (returnNullOnSaturation && isDbSaturationError(error)) {
      console.warn(onSaturationMessage);
      return null;
    }
    throw error;
  }
}

async function verifySnapshotTableExists() {
  const result = await queryWithTimeout(
    `SELECT to_regclass('public.screener_snapshots') AS table_name`,
    [],
    {
      label: 'snapshot.verifySnapshotTableExists',
      timeoutMs: 15000,
      maxRetries: 2,
      retryDelayMs: 500,
      slowQueryMs: 2000,
    }
  );

  if (!result.rows[0]?.table_name) {
    const error = new Error('Required table public.screener_snapshots is missing. Run migration 053_screener_snapshots.sql before starting the server.');
    console.error('[SCREENER_SNAPSHOT] startup check failed', { error: error.message });
    throw error;
  }

  return true;
}

async function cleanupOldSnapshots() {
  try {
    await runSnapshotQuery(
      `DELETE FROM screener_snapshots
       WHERE created_at < NOW() - INTERVAL '24 hours'`,
      [],
      {
        onSaturationMessage: 'DB SATURATED — SKIPPING SNAPSHOT CLEANUP',
        returnNullOnSaturation: true,
      }
    );
  } catch (error) {
    console.warn('[SCREENER_SNAPSHOT] cleanup failed', { error: error.message });
  }
}

function normalizeSnapshotRecord(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    created_at: row.created_at,
    data: row.data || {},
  };
}

async function getLatestSnapshotRecord() {
  const cached = getSnapshotFromCache();
  if (cached) {
    return cached;
  }

  if (nextSnapshotReadAttemptAt > Date.now()) {
    return null;
  }

  try {
    const result = await runSnapshotQuery(
      `SELECT id, data, created_at
       FROM screener_snapshots
       ORDER BY created_at DESC
       LIMIT 1`,
      [],
      {
        onSaturationMessage: cached
          ? 'DB SATURATED — SERVING STALE SNAPSHOT'
          : 'DB SATURATED — SKIPPING SNAPSHOT READ',
        returnNullOnSaturation: true,
      }
    );

    if (!result) {
      const staleSnapshot = getSnapshotFromCache();
      if (staleSnapshot) {
        return staleSnapshot;
      }

      deferSnapshotReadAttempt();
      return null;
    }

    const snapshot = normalizeSnapshotRecord(result.rows[0]);
    if (snapshot) {
      clearSnapshotReadDeferral();
      setSnapshotCache(snapshot);
    } else {
      deferSnapshotReadAttempt();
    }

    return snapshot;
  } catch (error) {
    if (isDbSaturationError(error)) {
      const staleSnapshot = getSnapshotFromCache();
      if (staleSnapshot) {
        console.warn('[SCREENER_SNAPSHOT] serving stale snapshot after read failure', {
          error: error.message,
          snapshotAt: staleSnapshot.created_at || null,
        });
        return staleSnapshot;
      }

      console.warn('[SCREENER_SNAPSHOT] no snapshot available during transient read failure', {
        error: error.message,
      });
      deferSnapshotReadAttempt();
      return null;
    }

    throw error;
  }
}

async function buildSnapshotPayload(previousSnapshot = null) {
  const previousRows = Array.isArray(previousSnapshot?.data?.screener?.data)
    ? previousSnapshot.data.screener.data
    : [];
  const screenerResult = await getScreenerRows({
    previousRows,
    snapshotTimestamp: new Date().toISOString(),
  });
  const screenerPayload = {
    success: true,
    count: screenerResult.rows.length,
    total: screenerResult.rows.length,
    fallbackUsed: screenerResult.fallbackUsed,
    macro_context: screenerResult.macroContext,
    meta: screenerResult.meta || null,
    data: screenerResult.rows,
  };

  const opportunitiesResult = await buildOpportunitiesPayload({
    rows: screenerResult.rows,
    macroContext: screenerResult.macroContext,
  });
  const opportunitiesPayload = {
    success: true,
    count: opportunitiesResult.rows.length,
    data: opportunitiesResult.rows,
    macro_context: opportunitiesResult.macroContext,
    report: opportunitiesResult.report,
  };

  return {
    screener: screenerPayload,
    opportunities: opportunitiesPayload,
  };
}

async function buildAndStoreScreenerSnapshot() {
  const startedAt = Date.now();

  try {
    const previousSnapshot = await getLatestSnapshotRecord();
    const payload = await buildSnapshotPayload(previousSnapshot);
    const result = await runSnapshotQuery(
      `INSERT INTO screener_snapshots (data)
       VALUES ($1::jsonb)
       RETURNING id, data, created_at`,
      [JSON.stringify(payload)],
      {
        onSaturationMessage: 'DB SATURATED — SKIPPING SNAPSHOT CYCLE',
        returnNullOnSaturation: true,
      }
    );

    if (!result) {
      return null;
    }

    const snapshot = normalizeSnapshotRecord(result.rows[0]);
    setSnapshotCache(snapshot);
    await cleanupOldSnapshots();

    console.log('[SCREENER_SNAPSHOT] built', {
      durationMs: Date.now() - startedAt,
      screenerRows: payload.screener.count,
      opportunitiesRows: payload.opportunities.count,
      snapshotAt: snapshot?.created_at || null,
    });

    return snapshot;
  } catch (error) {
    if (isDbSaturationError(error)) {
      console.warn('DB SATURATED — SKIPPING SNAPSHOT CYCLE');
      return null;
    }

    console.error('[SCREENER_SNAPSHOT] build failed', {
      durationMs: Date.now() - startedAt,
      error: error.message,
    });
    throw error;
  }
}

async function getLatestScreenerPayload() {
  const snapshot = await getLatestSnapshotRecord();
  if (!snapshot?.data?.screener) {
    return getWarmupPayload();
  }

  if (Array.isArray(snapshot.data.screener.data)) {
    snapshot.data.screener.data = await hydrateInstrumentTypes(snapshot.data.screener.data);
    setSnapshotCache(snapshot);
  }

  return withSnapshotTimestamp(snapshot.data.screener, snapshot.created_at);
}

async function getLatestOpportunitiesPayload() {
  const snapshot = await getLatestSnapshotRecord();
  if (!snapshot?.data?.opportunities) {
    return getWarmupPayload();
  }

  return withSnapshotTimestamp(snapshot.data.opportunities, snapshot.created_at);
}

async function getSnapshotStatus() {
  const cachedSnapshot = getSnapshotFromCache();
  const result = await runSnapshotQuery(
    `SELECT COUNT(*)::int AS snapshot_count,
            MAX(created_at) AS last_snapshot_at
     FROM screener_snapshots`,
    [],
    {
      onSaturationMessage: 'DB SATURATED — RETURNING CACHED SNAPSHOT STATUS',
      returnNullOnSaturation: true,
    }
  );

  const snapshotCount = Number(result?.rows?.[0]?.snapshot_count || 0);
  const lastSnapshotAt = result?.rows?.[0]?.last_snapshot_at || cachedSnapshot?.created_at || null;
  const hasSnapshot = snapshotCount > 0 || Boolean(cachedSnapshot);

  return {
    has_snapshot: hasSnapshot,
    last_snapshot_age: toAgeSeconds(lastSnapshotAt),
    snapshot_count: snapshotCount || (cachedSnapshot ? 1 : 0),
  };
}

module.exports = {
  buildAndStoreScreenerSnapshot,
  getLatestScreenerPayload,
  getLatestOpportunitiesPayload,
  getSnapshotStatus,
  getWarmupPayload,
  verifySnapshotTableExists,
  isSnapshotStartupSkippableError,
};