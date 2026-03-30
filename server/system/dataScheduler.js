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
 */

const { getMarketMode } = require('../utils/marketMode');
const { ingestQuotes, ingestIntraday, ingestDaily, ingestMetrics, getActiveSymbols } = require('../engines/marketDataEngine');

// ── tick intervals (ms) ───────────────────────────────────────────────────────

const INTERVALS = {
  LIVE:   { quotes: 60_000,       intraday: 5 * 60_000,  daily: null,           metrics: 5 * 60_000  },
  RECENT: { quotes: 5 * 60_000,   intraday: 30 * 60_000, daily: 60 * 60_000,    metrics: 30 * 60_000 },
  PREP:   { quotes: 60 * 60_000,  intraday: null,        daily: 60 * 60_000,    metrics: 60 * 60_000 },
};

// ── state ─────────────────────────────────────────────────────────────────────

const handles = {
  quotes:   null,
  intraday: null,
  daily:    null,
  metrics:  null,
  modeCheck: null,
};

let currentMode = null;
let runningJobs = new Set();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── job runner ────────────────────────────────────────────────────────────────

/**
 * Wraps an ingestion function to skip if already running (no overlap).
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
    try {
      await fn();
    } catch (err) {
      console.error(`[INGEST ERROR] job=${name} reason=${err.message}`);
    } finally {
      runningJobs.delete(name);
    }
  };
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

  // Apply initial schedule
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

module.exports = {
  startDataScheduler,
  stopDataScheduler,
};
