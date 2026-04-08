#!/usr/bin/env node

const path = require('path');
const cron = require('node-cron');

require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

const { runHistoricalBackfill, runNightlyIncrementalBacktest } = require('./backtester/engine');
const { loadStrategyModules } = require('./backtester/strategyLoader');
const {
  ensurePhase2BackfillStateTable,
  writePhase2BackfillState,
  readPhase2BackfillState,
  appendPhase2BackfillEvent,
  deletePhase2BackfillState,
} = require('./services/phase2BackfillStateStore');

const JOB_NAME = 'phase2-backfill';
const CHECKPOINT_REF = `database:${JOB_NAME}`;
const HEARTBEAT_MS = Math.max(10000, Number(process.env.PHASE2_WORKER_HEARTBEAT_MS || 30000));
const PROGRESS_EVENT_EVERY = Math.max(1, Number(process.env.PHASE2_WORKER_PROGRESS_EVENT_EVERY || 100));
const NIGHTLY_CRON = String(process.env.PHASE2_NIGHTLY_CRON || '15 6 * * 1-5').trim();
const NIGHTLY_TIMEZONE = String(process.env.PHASE2_NIGHTLY_TIMEZONE || 'UTC').trim();

let statusCache = null;
let inFlight = false;

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }

  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseCsvEnv(name) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) {
    return null;
  }

  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return values.length ? values : null;
}

function resolveActiveStrategyIds(requestedStrategyIds) {
  const requested = Array.isArray(requestedStrategyIds) && requestedStrategyIds.length
    ? new Set(requestedStrategyIds)
    : null;

  return loadStrategyModules()
    .filter((strategy) => !requested || requested.has(strategy.id))
    .map((strategy) => strategy.id);
}

function summarizeResult(result) {
  if (!result || typeof result !== 'object') {
    return null;
  }

  return {
    mode: result.mode || null,
    strategiesProcessed: Number(result.strategiesProcessed || 0),
    symbolsProcessed: Number(result.symbolsProcessed || 0),
    totalSymbols: Number(result.totalSymbols || 0),
    generatedSignals: Number(result.generatedSignals || 0),
    scoreRows: Number(result.scoreRows || 0),
    pickRows: Number(result.pickRows || 0),
    peakMemoryMb: Number(result.peakMemoryMb || 0),
    resumedFromCheckpoint: result.resumedFromCheckpoint === true,
  };
}

function formatError(error) {
  return error?.stack || error?.message || String(error);
}

async function readStatePayload(stateKey) {
  const state = await readPhase2BackfillState([stateKey]).catch(() => ({}));
  return state[stateKey]?.payload || null;
}

async function writeStatus(patch) {
  const now = new Date().toISOString();
  statusCache = {
    ...(statusCache || {}),
    ...patch,
    job: JOB_NAME,
    serviceRole: 'phase2-worker',
    updatedAt: now,
    heartbeatAt: now,
    inFlight,
  };
  await writePhase2BackfillState('status', statusCache);
  return statusCache;
}

async function appendEvent(type, message, extra = {}) {
  await appendPhase2BackfillEvent({
    type,
    message,
    createdAt: new Date().toISOString(),
    ...extra,
  }).catch(() => null);
}

function buildCheckpointHandlers() {
  return {
    checkpointRef: CHECKPOINT_REF,
    readCheckpoint: async () => readStatePayload('checkpoint'),
    writeCheckpoint: async (_reference, payload) => {
      await writePhase2BackfillState('checkpoint', payload);
      await writeStatus({
        status: payload?.status === 'completed' ? 'completed' : 'running',
        checkpointRef: CHECKPOINT_REF,
        processedSymbols: Number(payload?.processedSymbols || 0),
        totalSymbols: Number(payload?.totalSymbols || 0),
        persistedSignals: Number(payload?.persistedSignals || 0),
        peakMemoryMb: Number(payload?.peakMemoryMb || 0),
        lastCompletedSymbol: payload?.lastCompletedSymbol || null,
        resumedFromCheckpoint: Number(payload?.processedSymbols || 0) > 0,
      });

      if (payload?.processedSymbols && payload.processedSymbols % PROGRESS_EVENT_EVERY === 0) {
        await appendEvent('progress', '[BACKFILL] progress checkpoint saved', {
          processedSymbols: payload.processedSymbols,
          totalSymbols: payload.totalSymbols,
          persistedSignals: payload.persistedSignals,
          lastCompletedSymbol: payload.lastCompletedSymbol || null,
          peakMemoryMb: payload.peakMemoryMb || null,
        });
      }
    },
    resetCheckpointFn: async () => {
      await deletePhase2BackfillState(['checkpoint']);
    },
  };
}

async function runHistoricalCycle(trigger) {
  if (inFlight) {
    await appendEvent('skip', 'Historical backfill skipped because another cycle is already running', { trigger });
    return null;
  }

  const strategyIds = parseCsvEnv('PHASE2_STRATEGY_IDS');
  const symbols = parseCsvEnv('PHASE2_SYMBOLS');
  const activeStrategyIds = resolveActiveStrategyIds(strategyIds);
  const resetCheckpoint = envFlag('PHASE2_RESET_CHECKPOINT', false);
  const checkpointHandlers = buildCheckpointHandlers();

  inFlight = true;
  await writeStatus({
    status: 'running',
    currentRun: 'historical_backfill',
    trigger,
    startedAt: statusCache?.startedAt || new Date().toISOString(),
    checkpointRef: CHECKPOINT_REF,
    scope: {
      strategyIds: activeStrategyIds.length ? activeStrategyIds : null,
      symbols: symbols && symbols.length ? symbols : null,
      skipScoring: true,
      skipPickGeneration: true,
    },
    nightlyEnabled: envFlag('PHASE2_ENABLE_NIGHTLY', true),
    nightlyCron: NIGHTLY_CRON,
    nightlyTimezone: NIGHTLY_TIMEZONE,
    error: null,
  });
  await appendEvent('historical_start', 'Historical backfill started', { trigger });

  try {
    const result = await runHistoricalBackfill({
      strategyIds: activeStrategyIds,
      symbols,
      skipScoring: true,
      skipPickGeneration: true,
      useCheckpoint: true,
      resetCheckpoint,
      ...checkpointHandlers,
    });

    await appendEvent('historical_complete', 'Historical backfill completed', summarizeResult(result) || {});
    await writeStatus({
      status: envFlag('PHASE2_ENABLE_NIGHTLY', true) ? 'idle' : 'completed',
      currentRun: null,
      historicalCompletedAt: new Date().toISOString(),
      historicalResult: summarizeResult(result),
      processedSymbols: Number(result?.symbolsProcessed || 0),
      totalSymbols: Number(result?.totalSymbols || 0),
      persistedSignals: Number(result?.generatedSignals || 0),
      peakMemoryMb: Number(result?.peakMemoryMb || 0),
      resumedFromCheckpoint: result?.resumedFromCheckpoint === true,
    });
    return result;
  } catch (error) {
    await appendEvent('historical_failed', 'Historical backfill failed', { error: formatError(error) });
    await writeStatus({
      status: 'failed',
      currentRun: null,
      failedAt: new Date().toISOString(),
      error: formatError(error),
    });
    throw error;
  } finally {
    inFlight = false;
    await writeStatus({ status: statusCache?.status || 'idle', currentRun: statusCache?.currentRun || null });
  }
}

async function runNightlyCycle(trigger) {
  if (inFlight) {
    await appendEvent('skip', 'Nightly backtest skipped because another cycle is already running', { trigger });
    return null;
  }

  inFlight = true;
  await writeStatus({
    status: 'running',
    currentRun: 'nightly',
    nightlyTrigger: trigger,
    error: null,
  });
  await appendEvent('nightly_start', 'Nightly backtest started', { trigger });

  try {
    const result = await runNightlyIncrementalBacktest({
      skipScoring: false,
      skipPickGeneration: false,
      useCheckpoint: false,
    });
    await appendEvent('nightly_complete', 'Nightly backtest completed', summarizeResult(result) || {});
    await writeStatus({
      status: 'idle',
      currentRun: null,
      lastNightlyRunAt: new Date().toISOString(),
      lastNightlyResult: summarizeResult(result),
    });
    return result;
  } catch (error) {
    await appendEvent('nightly_failed', 'Nightly backtest failed', { error: formatError(error) });
    await writeStatus({
      status: 'failed',
      currentRun: null,
      nightlyFailedAt: new Date().toISOString(),
      error: formatError(error),
    });
    throw error;
  } finally {
    inFlight = false;
    await writeStatus({ status: statusCache?.status || 'idle', currentRun: statusCache?.currentRun || null });
  }
}

async function startPhase2Worker() {
  await ensurePhase2BackfillStateTable();

  if (envFlag('PHASE2_RESET_STATE', false)) {
    await deletePhase2BackfillState();
  }

  if (!statusCache) {
    statusCache = await readStatePayload('status');
  }

  await writeStatus({
    status: 'starting',
    startedAt: statusCache?.startedAt || new Date().toISOString(),
    checkpointRef: CHECKPOINT_REF,
    nightlyEnabled: envFlag('PHASE2_ENABLE_NIGHTLY', true),
    nightlyCron: NIGHTLY_CRON,
    nightlyTimezone: NIGHTLY_TIMEZONE,
    error: null,
  });

  const heartbeat = setInterval(() => {
    void writeStatus({
      status: inFlight ? 'running' : (statusCache?.status || 'idle'),
      currentRun: inFlight ? statusCache?.currentRun || 'historical_backfill' : null,
    });
  }, HEARTBEAT_MS);
  heartbeat.unref();

  const shutdown = async (signal) => {
    clearInterval(heartbeat);
    await appendEvent('shutdown', 'Phase 2 worker shutting down', { signal });
    await writeStatus({
      status: 'stopped',
      currentRun: null,
      stoppedAt: new Date().toISOString(),
    });
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  await runHistoricalCycle('startup');

  if (!envFlag('PHASE2_ENABLE_NIGHTLY', true)) {
    await appendEvent('worker_ready', 'Phase 2 worker finished historical backfill and is idling', {});
    await writeStatus({
      status: 'idle',
      currentRun: null,
      nightlyEnabled: false,
    });
    console.log('[PHASE2-WORKER] Started');
    await new Promise(() => {});
    return;
  }

  cron.schedule(NIGHTLY_CRON, () => {
    void runNightlyCycle('cron');
  }, {
    timezone: NIGHTLY_TIMEZONE,
  });

  await appendEvent('worker_ready', 'Phase 2 worker ready for nightly runs', {
    nightlyCron: NIGHTLY_CRON,
    nightlyTimezone: NIGHTLY_TIMEZONE,
  });
  await writeStatus({
    status: 'idle',
    currentRun: null,
    nightlyEnabled: true,
    nightlyCron: NIGHTLY_CRON,
    nightlyTimezone: NIGHTLY_TIMEZONE,
  });

  console.log('[PHASE2-WORKER] Started');
  await new Promise(() => {});
}

if (require.main === module) {
  startPhase2Worker().catch(async (error) => {
    await appendEvent('worker_failed', 'Phase 2 worker crashed', { error: formatError(error) }).catch(() => null);
    await writeStatus({
      status: 'failed',
      currentRun: null,
      failedAt: new Date().toISOString(),
      error: formatError(error),
    }).catch(() => null);
    console.error(formatError(error));
    process.exit(1);
  });
}

module.exports = {
  startPhase2Worker,
};