#!/usr/bin/env node

const path = require('path');
const cron = require('node-cron');

require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
process.env.PG_POOL_MAX = process.env.BEACON_NIGHTLY_PG_POOL_MAX || '1';

const { runBeaconNightlyCycle } = require('./beacon-nightly/nightlyCycle');
const { checkRecentRun } = require('./workers/lib/recencyGuard');

const DEFAULT_CRON = '30 21 * * 2-6';
const DEFAULT_TIMEZONE = 'UTC';
const KEEPALIVE_INTERVAL_MS = 60 * 60 * 1000;
const RECENCY_WINDOW_HOURS = Number(process.env.BEACON_NIGHTLY_RECENCY_WINDOW_HOURS || 20);

let cycleInFlight = false;
let keepAliveTimer = null;

function parseArgs(argv) {
  const args = {};
  for (const token of argv) {
    if (token === '--skip-outcomes') args.skipOutcomeEvaluation = true;
    if (token === '--skip-tuning') args.skipAdaptiveTuning = true;
    if (token === '--skip-backtest') args.skipBacktest = true;
    if (token.startsWith('--strategy=')) args.strategyIds = token.split('=')[1].split(',').map((value) => value.trim()).filter(Boolean);
    if (token.startsWith('--symbols=')) args.symbols = token.split('=')[1].split(',').map((value) => value.trim()).filter(Boolean);
    if (token.startsWith('--trigger=')) args.trigger = token.split('=')[1].trim();
  }
  return args;
}

function envFlag(name, fallback) {
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

function ensureKeepAlive() {
  if (keepAliveTimer) {
    return;
  }

  keepAliveTimer = setInterval(() => {}, KEEPALIVE_INTERVAL_MS);
}

function formatError(error) {
  return error?.stack || error?.message || String(error);
}

async function runCycle(trigger) {
  if (cycleInFlight) {
    console.warn(`[beacon-nightly-worker] Cycle already running. Skipping trigger='${trigger}'.`);
    return;
  }

  cycleInFlight = true;
  const startedAt = Date.now();

  try {
    const skip = await checkRecentRun({
      table: 'beacon_nightly_runs',
      recencyWindowHours: RECENCY_WINDOW_HOURS,
      workerName: 'beacon-nightly-worker',
      runIdColumn: 'id',
    });

    if (skip) {
      console.log(JSON.stringify({
        log: 'beacon_nightly_worker.skip',
        trigger,
        ...skip,
      }));
      return { skipped: true, reason: skip.reason, runId: skip.recent_run_id };
    }

    const result = await runBeaconNightlyCycle({
      serviceRole: 'beacon-nightly-worker',
      trigger,
    });
    const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(3);
    console.log(`[beacon-nightly-worker] Cycle complete in ${durationSeconds}s. Result: ${JSON.stringify(result)}`);
  } catch (error) {
    console.error('[beacon-nightly-worker] Cycle failed:', formatError(error));
  } finally {
    cycleInFlight = false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (Object.keys(args).length > 0) {
    console.warn(`[beacon-nightly-worker] CLI args detected but ignored in scheduler mode: ${JSON.stringify(args)}`);
  }

  const enabled = envFlag('BEACON_NIGHTLY_ENABLED', true);
  const runOnBoot = envFlag('BEACON_NIGHTLY_RUN_ON_BOOT', false);
  const cronExpression = String(process.env.BEACON_NIGHTLY_CRON || DEFAULT_CRON).trim() || DEFAULT_CRON;
  const timezone = String(process.env.BEACON_NIGHTLY_TIMEZONE || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;

  console.log(`[beacon-nightly-worker] Starting. Enabled=${enabled} Cron='${cronExpression}' TZ='${timezone}' RunOnBoot=${runOnBoot}`);

  process.on('SIGTERM', () => {
    console.log('[beacon-nightly-worker] SIGTERM received. Exiting.');
    process.exit(0);
  });

  if (!enabled) {
    console.log('[beacon-nightly-worker] BEACON_NIGHTLY_ENABLED=false → idling, not scheduling.');
    ensureKeepAlive();
    return;
  }

  cron.schedule(cronExpression, () => {
    const firedAt = new Date().toISOString();
    console.log(`[beacon-nightly-worker] Cron fired at ${firedAt}`);
    void runCycle('cron');
  }, {
    timezone,
  });

  console.log(`[beacon-nightly-worker] Cron scheduled. Next fire per '${cronExpression}' (${timezone}).`);

  if (runOnBoot) {
    console.log('[beacon-nightly-worker] RunOnBoot=true. Triggering immediate cycle.');
    void runCycle('boot');
  }
}

main().catch((error) => {
  console.error('[beacon-nightly-worker] Cycle failed:', formatError(error));
  process.exit(1);
});