const express = require('express');

const { runStocksInPlayEngine } = require('../engines/stocksInPlayEngine');
const { runCatalystEngine } = require('../engines/catalystEngine');
const { runEarningsEngine } = require('../engines/earningsEngine');
const { runOpportunityIntelligenceEngine } = require('../engines/opportunityIntelligenceEngine');
const { logCron } = require('../system/cronMonitor');
const { isLegacySystemDisabled, getRuntimeMode } = require('../system/runtimeMode');

const router = express.Router();

function getEngineCount(result) {
  if (Array.isArray(result)) return result.length;
  if (Array.isArray(result?.rows)) return result.rows.length;
  if (typeof result?.rows_processed === 'number') return result.rows_processed;
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

async function runWithTrace(engine, runner) {
  logCron('ENGINE_START', { engine });
  const startedAt = Date.now();
  try {
    const result = await runner();
    if (result?.success === false) {
      throw new Error(result.error || `${engine} failed`);
    }
    const count = getEngineCount(result);
    const symbolsSample = getEngineSymbols(result).slice(0, 10);
    const durationMs = Date.now() - startedAt;

    console.log('[ENGINE OUTPUT]', {
      engine,
      symbols: symbolsSample,
      count,
      duration_ms: durationMs,
    });

    logCron('ENGINE_SUCCESS', { engine, count, symbols_sample: symbolsSample, duration_ms: durationMs });
    return { engine, ok: true, count, symbols_sample: symbolsSample, duration_ms: durationMs };
  } catch (error) {
    logCron('ENGINE_ERROR', { engine, error: error.message, stage: 'run', duration_ms: Date.now() - startedAt });
    return { engine, ok: false, error: error.message, count: 0 };
  }
}

router.post('/run-all', async (_req, res) => {
  if (isLegacySystemDisabled()) {
    return res.status(503).json({
      success: false,
      error: 'LEGACY_SYSTEM_DISABLED',
      mode: getRuntimeMode(),
      runs: [],
    });
  }

  const runs = [];
  runs.push(await runWithTrace('stocks-in-play', runStocksInPlayEngine));
  runs.push(await runWithTrace('catalyst', runCatalystEngine));
  runs.push(await runWithTrace('earnings', runEarningsEngine));
  runs.push(await runWithTrace('intelligence', runOpportunityIntelligenceEngine));

  const failed = runs.filter((run) => !run.ok);
  if (failed.length > 0) {
    logCron('ENGINE_ERROR', {
      engine: 'run-all',
      error: `${failed.length} engine(s) failed`,
      failed: failed.map((entry) => ({ engine: entry.engine, error: entry.error })),
    });
  }

  res.json({
    success: failed.length === 0,
    runs,
  });
});

module.exports = router;
