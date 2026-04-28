'use strict';

const crypto = require('crypto');
const { getWindow } = require('./index');
const { getPremarketEarningsExpansion } = require('./expansion/premarket_earnings');
const { runBeaconPipeline, SIGNALS: ALL_SIGNALS } = require('../orchestrator/run');
const { recordRunStart, recordRunSuccess, recordRunFailure } = require('../persistence/runs');
const { queryWithTimeout } = require('../../db/pg');

async function getNightlyUniverseForToday() {
  const { rows } = await queryWithTimeout(
    `
      SELECT DISTINCT symbol
      FROM beacon_v0_picks
      WHERE discovered_in_window = 'nightly'
        AND created_at > NOW() - INTERVAL '36 hours'
    `,
    [],
    {
      timeoutMs: 10000,
      label: 'window_runner.nightly_universe',
      maxRetries: 0,
      poolType: 'read',
    },
  );
  return rows.map((row) => row.symbol).filter(Boolean);
}

async function getWindowExpansionUniverse(window) {
  const max = window.universe.expansion_max_symbols || 50;

  switch (window.name) {
    case 'premarket': {
      const result = await getPremarketEarningsExpansion({ limit: max });
      console.log(JSON.stringify({
        log: 'window_runner.expansion',
        window: window.name,
        source: 'premarket_earnings',
        symbol_count: result.symbols.length,
        sample: result.metadata.slice(0, 5),
      }));
      return result.symbols;
    }
    case 'open':
    case 'power_hour':
    case 'post_market':
      console.log(`[window-runner] expansion universe for ${window.name}: not yet implemented (G2c-5+), returning empty`);
      return [];
    default:
      console.warn(`[window-runner] unknown window: ${window.name}`);
      return [];
  }
}

async function getPriorWindowSymbols(window) {
  const symbolsToInclude = [];

  if (window.universe.include_premarket_window_picks) {
    const { rows } = await queryWithTimeout(
      `
        SELECT DISTINCT symbol
        FROM beacon_v0_picks
        WHERE discovered_in_window = 'premarket'
          AND created_at > NOW() - INTERVAL '24 hours'
      `,
      [],
      { timeoutMs: 5000, label: 'window_runner.premarket_picks', poolType: 'read', maxRetries: 0 },
    );
    symbolsToInclude.push(...rows.map((row) => row.symbol));
  }

  if (window.universe.include_open_window_picks) {
    const { rows } = await queryWithTimeout(
      `
        SELECT DISTINCT symbol
        FROM beacon_v0_picks
        WHERE discovered_in_window = 'open'
          AND created_at > NOW() - INTERVAL '12 hours'
      `,
      [],
      { timeoutMs: 5000, label: 'window_runner.open_picks', poolType: 'read', maxRetries: 0 },
    );
    symbolsToInclude.push(...rows.map((row) => row.symbol));
  }

  return symbolsToInclude.filter(Boolean);
}

async function buildWindowUniverse(window) {
  const universe = new Set();

  if (window.universe.include_nightly_picks) {
    const nightly = await getNightlyUniverseForToday();
    nightly.forEach((symbol) => universe.add(symbol));
  }

  const priorWindowSymbols = await getPriorWindowSymbols(window);
  priorWindowSymbols.forEach((symbol) => universe.add(symbol));

  const expansion = await getWindowExpansionUniverse(window);
  expansion.forEach((symbol) => universe.add(symbol));

  return Array.from(universe);
}

function generateWindowRunId(windowName) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const hash = crypto.randomBytes(4).toString('hex');
  return `v0-${windowName}-${timestamp}-${hash}`;
}

function getWindowSignals(window) {
  const windowSignals = ALL_SIGNALS.filter((signal) => window.signals.includes(signal.SIGNAL_NAME));
  if (windowSignals.length !== window.signals.length) {
    const missing = window.signals.filter((name) => !ALL_SIGNALS.find((signal) => signal.SIGNAL_NAME === name));
    throw new Error(`Window ${window.name} references unknown signals: ${missing.join(', ')}`);
  }
  return windowSignals;
}

async function runWindow(windowName, options = {}) {
  const window = getWindow(windowName);
  const runId = options.runId || generateWindowRunId(windowName);
  const startedAt = Date.now();

  console.log(`[window-runner] Starting ${windowName} window run: ${runId}`);

  try {
    const universe = await buildWindowUniverse(window);
    console.log(`[window-runner] ${windowName} universe size: ${universe.length}`);

    if (universe.length === 0) {
      console.log(`[window-runner] ${windowName}: empty universe, skipping`);
      return { runId, status: 'skipped', reason: 'empty_universe' };
    }

    await recordRunStart(runId, universe.length);
    const windowSignals = getWindowSignals(window);

    const result = await runBeaconPipeline(universe, {
      persist: true,
      runId,
      limit: window.top_n,
      signals: windowSignals,
      minAlignmentCount: window.min_alignment_count,
      windowContext: {
        name: window.name,
        rankingWeights: window.ranking_weights,
      },
      skipNarrativeGeneration: true,
      interSignalDelayMs: 0,
    });

    const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
    await recordRunSuccess(runId, result.picks.length, durationSeconds, {
      worker_version: 'g2c-window-runner-v1',
      window: windowName,
      signals_processed: windowSignals.length,
    });

    console.log(`[window-runner] ${windowName} completed: ${result.picks.length} picks in ${durationSeconds}s`);
    return { runId, status: 'completed', picks: result.picks.length, duration: durationSeconds };
  } catch (error) {
    const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
    console.error(`[window-runner] ${windowName} failed:`, error.message);
    await recordRunFailure(runId, error.message || String(error), durationSeconds).catch(() => {});
    throw error;
  }
}

module.exports = {
  runWindow,
  buildWindowUniverse,
  generateWindowRunId,
};