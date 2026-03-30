'use strict';

/**
 * dataScheduler.js
 * Time-aware market data scheduler.
 *
 * Schedule:
 *   LIVE   (weekday 09:30–16:00 ET)  → quotes every 60s, intraday every 5min
 *   RECENT (weekday non-market)       → quotes every 5min, intraday every 30min
 *   PREP   (weekend)                  → quotes once/day, daily once/day, news every 10min
 *
 * Guards:
 *   global.marketDataSchedulerStarted — prevents double-start
 *   global.ingestionPaused            — external pause signal
 *
 * Phase 2 additions:
 *   - Row count tracking per job ([INGEST] quotes=X intraday=Y metrics=Z)
 *   - Stale table detection (>24h → backfill trigger)
 *   - getIngestionStatus() exported for /api/system/ingestion-status
 */

const { getMarketMode } = require('../utils/marketMode');
const { ingestQuotes, ingestIntraday, ingestDaily, ingestMetrics, getActiveSymbols } = require('../engines/marketDataEngine');

// ── tick intervals (ms) ───────────────────────────────────────────────────────

const INTERVALS = {
  LIVE:   { quotes: 60_000,       intraday: 5 * 60_000,  daily: null,           metrics: 5 * 60_000  },
  RECENT: { quotes: 5 * 60_000,   intraday: 30 * 60_000, daily: 60 * 60_000,    metrics: 30 * 60_000 },
  PREP:   { quotes: 60 * 60_000,  intraday: null,        daily: 60 * 60_000,    metrics: 60 * 60_000 },
};

// ── ingestion status (exported via getIngestionStatus) ────────────────────────

const _status = {
  current_mode:     null,
  last_run:         { quotes: null, intraday: null, daily: null, metrics: null },
  rows_written:     { quotes: 0,    intraday: 0,    daily: 0,    metrics: 0    },
  stale_tables:     [],
  last_stale_check: null,
};

// ── state ─────────────────────────────────────────────────────────────────────

const handles = {
  quotes:    null,
  intraday:  null,
  daily:     null,
  metrics:   null,
  modeCheck: null,
};

let currentMode = null;
let runningJobs = new Set();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── job runner ────────────────────────────────────────────────────────────────

/**
 * Wraps an ingestion function:
 *  - skip if paused or already running (no overlap)
 *  - capture return value for row count tracking
 *  - emit [INGEST] summary line
 */
function makeJob(name, fn) {
  return async function runJob() {
    if (global.ingestionPaused) {
      console.log(`[INGEST] ${name} skipped — ingestionPaused`);
      return;
    }
    if (runningJobs.has(name)) {
      console.log(`[INGEST] ${name} skipped — already running`);
      return;
    }
    runningJobs.add(name);
    const t0 = Date.now();
    try {
      const result = await fn();
      _status.last_run[name] = new Date().toISOString();

      // Extract row count from various return shapes
      const rows = result?.rows_written ?? result?.updated ?? result?.rowCount ?? 0;
      _status.rows_written[name] = rows;

      console.log(
        `[INGEST] ${name}=+${rows} ` +
        `quotes=${_status.rows_written.quotes} ` +
        `intraday=${_status.rows_written.intraday} ` +
        `daily=${_status.rows_written.daily} ` +
        `metrics=${_status.rows_written.metrics} ` +
        `(${Date.now() - t0}ms)`
      );
    } catch (err) {
      console.error(`[INGEST ERROR] job=${name} reason=${err.message}`);
    } finally {
      runningJobs.delete(name);
    }
  };
}

// ── stale table detection ─────────────────────────────────────────────────────

async function checkStaleTables() {
  _status.last_stale_check = new Date().toISOString();

  let pool;
  try {
    pool = require('../db/pool');
  } catch (_) {
    return;
  }

  const STALE_MS = 24 * 60 * 60 * 1000;
  const stale    = [];

  const checks = [
    { name: 'market_quotes',  query: `SELECT MAX(updated_at) AS ts FROM market_quotes` },
    { name: 'market_metrics', query: `SELECT MAX(updated_at) AS ts FROM market_metrics` },
    { name: 'intraday_1m',    query: `SELECT MAX("timestamp") AS ts FROM intraday_1m`   },
  ];

  for (const check of checks) {
    try {
      const result = await pool.query(check.query);
      const ts = result.rows[0]?.ts;
      if (!ts || (Date.now() - new Date(ts).getTime()) > STALE_MS) {
        stale.push(check.name);
      }
    } catch (_) {
      // table may not exist yet — skip silently
    }
  }

  _status.stale_tables = stale;

  if (stale.length > 0) {
    console.warn(`[INGEST] stale tables detected: ${stale.join(', ')} — triggering backfill`);
    if (stale.includes('market_quotes') || stale.includes('market_metrics')) {
      jobQuotes().catch(() => {});
    }
    if (stale.includes('intraday_1m')) {
      jobIntraday().catch(() => {});
    }
  }
}

// ── interval management ───────────────────────────────────────────────────────

function clearAllIntervals() {
  for (const key of Object.keys(handles)) {
    if (handles[key]) {
      clearInterval(handles[key]);
      handles[key] = null;
    }
  }
}

function setIntervalIfNeeded(key, ms, job) {
  if (!ms) return;
  if (handles[key]) clearInterval(handles[key]);
  handles[key] = setInterval(job, ms);
}

// ── schedule application ──────────────────────────────────────────────────────

const jobQuotes   = makeJob('quotes',   () => ingestQuotes());
const jobIntraday = makeJob('intraday', () => ingestIntraday());
const jobDaily    = makeJob('daily',    () => ingestDaily());
const jobMetrics  = makeJob('metrics',  () => ingestMetrics());

async function applySchedule(mode) {
  if (currentMode === mode) return; // no change
  currentMode = mode;
  _status.current_mode = mode;

  console.log(`[INGEST] schedule mode=${mode}`);
  clearAllIntervals();

  const cfg = INTERVALS[mode];

  setIntervalIfNeeded('quotes',   cfg.quotes,   jobQuotes);
  setIntervalIfNeeded('intraday', cfg.intraday, jobIntraday);
  setIntervalIfNeeded('daily',    cfg.daily,    jobDaily);
  setIntervalIfNeeded('metrics',  cfg.metrics,  jobMetrics);
}

// ── mode watcher ──────────────────────────────────────────────────────────────

async function checkAndApplyMode() {
  try {
    const { mode } = getMarketMode();
    await applySchedule(mode);
  } catch (err) {
    console.error(`[INGEST ERROR] mode check failed: ${err.message}`);
  }

  // Run stale check on every mode poll cycle (every 5 min)
  await checkStaleTables().catch((err) =>
    console.error(`[INGEST ERROR] stale check failed: ${err.message}`)
  );
}

// ── startup ───────────────────────────────────────────────────────────────────

/**
 * Start the data scheduler.
 * Safe to call multiple times — guarded by global.marketDataSchedulerStarted.
 */
async function startDataScheduler() {
  if (global.marketDataSchedulerStarted) {
    console.log('[INGEST] dataScheduler already started — skipping');
    return;
  }
  global.marketDataSchedulerStarted = true;

  console.log('[INGEST] dataScheduler starting');

  // Apply initial schedule + stale check
  await checkAndApplyMode();

  // Re-check mode every 5 minutes (handles market open/close transitions)
  handles.modeCheck = setInterval(checkAndApplyMode, 5 * 60_000);

  // Run initial ingestion immediately (staggered to avoid DB connection spike)
  const { mode } = getMarketMode();
  console.log(`[INGEST] initial run mode=${mode}`);

  try {
    await jobQuotes();
  } catch (_) {}

  await sleep(2000);

  if (mode !== 'PREP') {
    try {
      await jobIntraday();
    } catch (_) {}
  }

  await sleep(2000);

  try {
    await jobMetrics();
  } catch (_) {}

  console.log('[INGEST] dataScheduler ready');
}

/**
 * Stop all scheduled jobs. Used in graceful shutdown.
 */
function stopDataScheduler() {
  clearAllIntervals();
  global.marketDataSchedulerStarted = false;
  console.log('[INGEST] dataScheduler stopped');
}

/**
 * Return current ingestion status snapshot.
 * Used by GET /api/system/ingestion-status.
 */
function getIngestionStatus() {
  return {
    current_mode:     _status.current_mode,
    last_run:         { ..._status.last_run },
    rows_written:     { ..._status.rows_written },
    stale_tables:     [..._status.stale_tables],
    last_stale_check: _status.last_stale_check,
  };
}

module.exports = {
  startDataScheduler,
  stopDataScheduler,
  getIngestionStatus,
};
