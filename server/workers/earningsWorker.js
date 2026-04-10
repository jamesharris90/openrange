const { runEarningsEngine } = require('../engines/earningsEngine');
const logger = require('../logger');
const { logCron } = require('../system/cronMonitor');

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
let timer = null;
let inFlight = false;

function getEngineCount(result) {
  if (Array.isArray(result)) return result.length;
  if (Array.isArray(result?.rows)) return result.rows.length;
  if (typeof result?.ingested === 'number') return result.ingested;
  if (typeof result?.upserted === 'number') return result.upserted;
  if (typeof result?.catalystsStored === 'number') return result.catalystsStored;
  if (typeof result?.count === 'number') return result.count;
  if (typeof result?.processed === 'number') return result.processed;
  if (typeof result?.inserted === 'number') return result.inserted;
  return 0;
}

function getEngineSymbols(result) {
  if (Array.isArray(result?.symbols)) {
    return result.symbols
      .filter((symbol) => typeof symbol === 'string' && symbol.length > 0)
      .slice(0, 50);
  }

  const rows = Array.isArray(result)
    ? result
    : Array.isArray(result?.rows)
      ? result.rows
      : [];

  return rows
    .map((row) => row?.symbol)
    .filter((symbol) => typeof symbol === 'string' && symbol.length > 0)
    .slice(0, 50);
}

async function runEarningsWorker() {
  if (inFlight) {
    return { skipped: true, reason: 'already_running' };
  }

  inFlight = true;
  logCron('ENGINE_START', { engine: 'earnings' });
  const startedAt = Date.now();
  try {
    const result = await runEarningsEngine();
    const count = getEngineCount(result);
    const symbolsSample = getEngineSymbols(result).slice(0, 10);
    const durationMs = Date.now() - startedAt;
    console.log('[ENGINE OUTPUT]', {
      engine: 'earnings',
      symbols: symbolsSample,
      count,
      duration_ms: durationMs,
    });
    logCron('ENGINE_SUCCESS', { engine: 'earnings', count, symbols_sample: symbolsSample, duration_ms: durationMs });
    logger.info('[EARNINGS_WORKER] run complete', result || {});
    return result;
  } catch (error) {
    logCron('ENGINE_ERROR', { engine: 'earnings', error: error.message, stage: 'run', duration_ms: Date.now() - startedAt });
    logger.error('[EARNINGS_WORKER] run failed', { error: error.message });
    return { skipped: false, error: error.message };
  } finally {
    inFlight = false;
  }
}

function startEarningsWorker() {
  if (timer) return;

  runEarningsWorker().catch(() => null);
  timer = setInterval(() => {
    runEarningsWorker().catch(() => null);
  }, TWELVE_HOURS_MS);
}

module.exports = {
  runEarningsWorker,
  startEarningsWorker,
};
