/**
 * phaseScheduler.js
 *
 * Time-phase aware scheduler for US market (America/New_York) timezone.
 *
 * Phases:
 *   overnight          00:00–11:30  — Tier 3 (full universe quotes, ~18h cycle)
 *                                     Layer A fires at ~04:00 UK if stale
 *   prescan            11:30–13:00  — Tier 2 (operational every 30 min) + Tier 1 watchlist (5 min)
 *   watchlist          13:00–14:30  — Tier 1 watchlist (3 min) + Tier 2 operational (30 min)
 *   open-acceleration  14:30–15:00  — Tier 1 watchlist (1 min) + Tier 2 operational (12 min)
 *   post-open          15:00+       — Tier 1 watchlist (4 min) + Tier 2 operational (45 min)
 *
 * Three quote tiers:
 *   Tier 1 — Watchlist symbols only     fast refresh (wl interval)
 *   Tier 2 — Operational universe       rolling refresh (op interval)
 *   Tier 3 — Full universe (~15k)       once every 18h, overnight only
 */

const presetService = require('../services/presetService');
const {
  refreshLayerA,
  refreshLayerB,
  refreshLayerB2,
  refreshLayerC,
  refreshLayerD,
  refreshTier3Quotes,
  computeOperationalUniverse,
} = require('../services/enrichmentPipeline');
const { refreshSpyState } = require('../data-engine/spyStateEngine');
const cacheManager = require('../data-engine/cacheManager');
const { updateIntraday1m } = require('../services/candleUpdateService.ts');

// ---------------------------------------------------------------------------
// Phase detection — built-in Intl, no external packages
// ---------------------------------------------------------------------------

function getNewYorkMinutes() {
  const nowNY = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
  });
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date(nowNY));
  const h = Number((parts.find((p) => p.type === 'hour') || {}).value || 0);
  const m = Number((parts.find((p) => p.type === 'minute') || {}).value || 0);
  return h * 60 + m;
}

function detectPhase() {
  const min = getNewYorkMinutes();
  if (min < 11 * 60 + 30) return 'overnight';          // 00:00–11:30
  if (min < 13 * 60)       return 'prescan';            // 11:30–13:00
  if (min < 14 * 60 + 30)  return 'watchlist';          // 13:00–14:30
  if (min < 15 * 60)       return 'open-acceleration';  // 14:30–15:00
  return 'post-open';                                    // 15:00+
}

// Layer A targets 03:50–04:10 UK (230–250 min from midnight)
function isLayerAWindow() {
  const min = getNewYorkMinutes();
  return min >= 230 && min <= 250;
}

// Intervals in minutes.  0 = disabled.  wl = watchlist, op = operational universe
const PHASE_INTERVALS = {
  overnight:          { wl: 0, op: 0  },
  prescan:            { wl: 5, op: 30 },
  watchlist:          { wl: 3, op: 30 },
  'open-acceleration':{ wl: 1, op: 12 },
  'post-open':        { wl: 4, op: 45 },
};

const TIER3_INTERVAL_HOURS = 18; // full universe quote refresh cadence

// ---------------------------------------------------------------------------
// Mutable scheduler state
// ---------------------------------------------------------------------------

let _apiKey          = null;
let _schedulerUserId = null;
let _logger          = console;

let _currentPhase = 'overnight';
let _activePreset = null;
let _watchlist    = [];

let _lastLayerARun    = null;
let _lastLayerBRun    = null;
let _lastLayerB2Run   = null;
let _lastLayerCRun    = null;
let _lastLayerDRun    = null;
let _lastTier3Run     = null;
let _lastWatchlistRun = null;
let _lastSpyStateRun  = null;

let _layerCInFlight = false;
let _layerDInFlight = false;
let _tier3InFlight  = false;

let _mainInterval = null;
let _tier2Interval = null;

// ---------------------------------------------------------------------------
// Preset + watchlist cache
// ---------------------------------------------------------------------------

async function _loadPresetAndWatchlist() {
  try {
    _activePreset = await presetService.getActivePreset(_schedulerUserId);
    _watchlist    = await presetService.getWatchlist(_schedulerUserId);
    _logger.info('phaseScheduler: preset loaded', {
      presetName:     _activePreset?.name || 'none',
      watchlistCount: _watchlist.length,
    });
  } catch (err) {
    _logger.error('phaseScheduler: failed to load preset', { error: err.message });
  }
}

function notifyPresetChanged() {
  if (!_schedulerUserId) return;
  setImmediate(() => _loadPresetAndWatchlist());
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _minutesSince(ts) {
  if (!ts) return Infinity;
  return (Date.now() - ts) / 60_000;
}

function _hoursSince(ts) {
  if (!ts) return Infinity;
  return (Date.now() - ts) / 3_600_000;
}

function _getOpSymbols() {
  return computeOperationalUniverse(_activePreset).symbols;
}

// ---------------------------------------------------------------------------
// Tier tasks
// ---------------------------------------------------------------------------

// Tier 1 — watchlist fast refresh (news + derived, no full quote fetch)
async function _runTier1() {
  if (_layerDInFlight) return;
  _layerDInFlight = true;
  try {
    const opSymbols = _getOpSymbols();
    await refreshLayerD(_apiKey, opSymbols, _watchlist, _logger);
    _lastLayerDRun    = Date.now();
    _lastWatchlistRun = Date.now();
  } finally {
    _layerDInFlight = false;
  }
}

// Tier 2 — operational universe (quotes + news + derived)
async function runIntradayUpdate() {
  const opSymbols = _getOpSymbols();
  const intradaySymbols = Array.isArray(opSymbols)
    ? opSymbols.map((s) => s?.symbol || s).filter(Boolean)
    : [];

  if (!intradaySymbols.length) {
    _logger.info('[INGESTION] No operational symbols available for intraday update');
    return;
  }

  await updateIntraday1m(intradaySymbols.slice(0, 500), 1);
}

async function _runTier2() {
  if (_layerCInFlight) return;

  console.log('[SCHEDULER] Tier2 cycle started');

  try {
    await runIntradayUpdate();
  } catch (err) {
    console.error('[SCHEDULER] Tier2 intraday update failed', err);
  }

  _layerCInFlight = true;
  try {
    const opSymbols = _getOpSymbols();
    await refreshLayerC(_apiKey, opSymbols, _watchlist, _logger);
    _lastLayerCRun = Date.now();
    await refreshLayerD(_apiKey, opSymbols, _watchlist, _logger);
    _lastLayerDRun    = Date.now();
    _lastWatchlistRun = Date.now();
  } finally {
    _layerCInFlight = false;
  }
}

// Tier 3 — full universe quotes (overnight, every 18h)
async function _runTier3() {
  if (_tier3InFlight) return;
  _tier3InFlight = true;
  try {
    await refreshTier3Quotes(_apiKey, _logger);
    _lastTier3Run = Date.now();
  } finally {
    _tier3InFlight = false;
  }
}

// Layer A — full universe rebuild (once daily, targets ~04:00 UK)
async function _maybeRunLayerA() {
  if (_minutesSince(_lastLayerARun) < 23 * 60) return;
  // Enforce 04:00 window unless universe is completely empty
  if (_lastLayerARun !== null && !isLayerAWindow()) return;
  _logger.info('phaseScheduler: Layer A triggered (daily full universe)');
  await refreshLayerA(_logger);
  // Only mark as run if the universe was actually populated
  if (cacheManager.getBaseUniverse().length > 0) {
    _lastLayerARun = Date.now();
  } else {
    _logger.warn('phaseScheduler: Layer A produced empty universe — will retry next tick');
  }
}

// Layer B — fundamentals (once daily, after Layer A)
async function _maybeRunLayerB() {
  if (!_lastLayerARun) return;
  if (_minutesSince(_lastLayerBRun) < 23 * 60) return;
  _logger.info('phaseScheduler: Layer B triggered (fundamentals)');
  await refreshLayerB(_apiKey, _logger);
  _lastLayerBRun = Date.now();
}

// Layer B2 — Yahoo Finance historical (once daily during prescan, after Layer C)
async function _maybeRunLayerB2() {
  if (!_lastLayerCRun) return; // need quotes first
  if (_minutesSince(_lastLayerB2Run) < 23 * 60) return;
  _logger.info('phaseScheduler: Layer B2 triggered (Yahoo historical)');
  await refreshLayerB2(_logger);
  _lastLayerB2Run = Date.now();
}

// SPY State — refresh every 5 minutes during active phases
async function _maybeRefreshSpyState() {
  if (_minutesSince(_lastSpyStateRun) < 5) return;
  await refreshSpyState(_logger).catch((err) =>
    _logger.warn('phaseScheduler: SPY state refresh failed', { error: err.message })
  );
  _lastSpyStateRun = Date.now();
}

// ---------------------------------------------------------------------------
// Main tick (every 60 seconds)
// ---------------------------------------------------------------------------

async function _tick() {
  const phase = detectPhase();

  if (phase !== _currentPhase) {
    _logger.info('phaseScheduler: phase transition', {
      from: _currentPhase,
      to:   phase,
      nyTime: new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date()),
    });
    _currentPhase = phase;
  }

  const intervals = PHASE_INTERVALS[phase];

  // Overnight — quiet period: Layer A rebuild + Tier 3 full quote sweep
  if (phase === 'overnight') {
    await _maybeRunLayerA();
    await _maybeRunLayerB();

    if (_hoursSince(_lastTier3Run) >= TIER3_INTERVAL_HOURS && !_tier3InFlight) {
      _runTier3().catch((err) =>
        _logger.error('phaseScheduler: Tier 3 error', { error: err.message })
      );
    }
    return;
  }

  // Active phases — also check Layer A/B in case overnight window was missed
  await _maybeRunLayerA();
  await _maybeRunLayerB();

  // SPY state — refresh every 5 min during active phases
  _maybeRefreshSpyState().catch((err) =>
    _logger.warn('phaseScheduler: SPY state error', { error: err.message })
  );

  // Layer B2 — once daily (Yahoo historical, after first Layer C regardless of phase)
  _maybeRunLayerB2().catch((err) =>
    _logger.error('phaseScheduler: Layer B2 error', { error: err.message })
  );

  // Tier 1 — watchlist (news + derived)
  if (intervals.wl > 0 && _minutesSince(_lastWatchlistRun) >= intervals.wl && !_layerDInFlight) {
    _runTier1().catch((err) =>
      _logger.error('phaseScheduler: Tier 1 error', { error: err.message })
    );
  }

  // Tier 2 — operational universe quotes + news
  if (intervals.op > 0 && _minutesSince(_lastLayerCRun) >= intervals.op && !_layerCInFlight) {
    _runTier2().catch((err) =>
      _logger.error('phaseScheduler: Tier 2 error', { error: err.message })
    );
  }
}

// ---------------------------------------------------------------------------
// Start / Stop
// ---------------------------------------------------------------------------

async function startPhaseScheduler(apiKey, schedulerUserId, logger = console) {
  _apiKey          = apiKey;
  _schedulerUserId = schedulerUserId;
  _logger          = logger;

  logger.info('phaseScheduler: starting', { userId: schedulerUserId });

  await _loadPresetAndWatchlist();

  // Avoid blocking startup on full universe rebuild; tick will run Layer A/B as needed.
  if (!cacheManager.getBaseUniverse().length) {
    logger.info('phaseScheduler: universe empty at startup — Layer A/B deferred to scheduler tick');
  }

  // If universe is populated but quotes cache is empty, force Tier 3 to run next tick
  const quotesCache = cacheManager.getDataset('quotes') || new Map();
  if (cacheManager.getBaseUniverse().length > 0 && quotesCache.size === 0) {
    logger.info('phaseScheduler: universe has stocks but no quotes — resetting Tier 3 timer for immediate run');
    _lastTier3Run = null;
  }

  _tick().catch((err) =>
    logger.error('phaseScheduler: initial tick error', { error: err.message })
  );

  console.log('[SYSTEM] Running initial intraday ingestion');
  setTimeout(() => {
    _runTier2().catch((err) =>
      _logger.error('phaseScheduler: initial Tier 2 error', { error: err.message })
    );
  }, 3000);

  _mainInterval = setInterval(() => {
    _tick().catch((err) =>
      _logger.error('phaseScheduler: tick error', { error: err.message })
    );
  }, 60_000);

  _tier2Interval = setInterval(() => {
    _runTier2().catch((err) =>
      _logger.error('phaseScheduler: Tier 2 interval error', { error: err.message })
    );
  }, 60000);

  logger.info('phaseScheduler: running — 60s tick active');
}

function stopPhaseScheduler() {
  if (_mainInterval) {
    clearInterval(_mainInterval);
    _mainInterval = null;
  }
  if (_tier2Interval) {
    clearInterval(_tier2Interval);
    _tier2Interval = null;
  }
}

// ---------------------------------------------------------------------------
// Status API (consumed by /api/system/status)
// ---------------------------------------------------------------------------

function getCurrentPhaseInfo() {
  const opUniverse = cacheManager.getDataset('operationalUniverse') || [];
  return {
    currentPhase:     _currentPhase,
    activePresetName: _activePreset?.name || null,
    watchlistCount:   _watchlist.length,
    operationalCount: Array.isArray(opUniverse) ? opUniverse.length : 0,
    intervals:        PHASE_INTERVALS[_currentPhase] || {},
    // Timestamps
    lastFullRebuild:        _lastLayerARun    ? new Date(_lastLayerARun).toISOString()    : null,
    lastFundamentalsRun:    _lastLayerBRun    ? new Date(_lastLayerBRun).toISOString()    : null,
    lastHistoricalRun:      _lastLayerB2Run   ? new Date(_lastLayerB2Run).toISOString()   : null,
    lastOperationalRefresh: _lastLayerCRun    ? new Date(_lastLayerCRun).toISOString()    : null,
    lastNewsRun:            _lastLayerDRun    ? new Date(_lastLayerDRun).toISOString()    : null,
    lastWatchlistRefresh:   _lastWatchlistRun ? new Date(_lastWatchlistRun).toISOString() : null,
    lastTier3Refresh:       _lastTier3Run     ? new Date(_lastTier3Run).toISOString()     : null,
    lastSpyStateRun:        _lastSpyStateRun  ? new Date(_lastSpyStateRun).toISOString()  : null,
    // In-flight
    tier2InFlight: _layerCInFlight,
    tier3InFlight: _tier3InFlight,
  };
}

module.exports = {
  startPhaseScheduler,
  stopPhaseScheduler,
  getCurrentPhaseInfo,
  notifyPresetChanged,
};
