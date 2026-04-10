#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });

const fs = require('fs');
const path = require('path');
const { runHistoricalBackfill, resolveCheckpointFile } = require('../backtester/engine');
const { loadStrategyModules } = require('../backtester/strategyLoader');

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function writeStatus(statusFile, patch) {
  if (!statusFile) {
    return;
  }

  const current = readJsonFile(statusFile) || {};
  writeJsonFile(statusFile, {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

function parseArgs(argv) {
  const args = {
    skipScoring: true,
    skipPickGeneration: true,
    useCheckpoint: true,
  };
  for (const token of argv) {
    if (token.startsWith('--strategy=')) {
      args.strategyIds = token.split('=')[1].split(',').map((value) => value.trim()).filter(Boolean);
    }
    if (token.startsWith('--symbols=')) {
      args.symbols = token.split('=')[1].split(',').map((value) => value.trim()).filter(Boolean);
    }
    if (token === '--with-scores') {
      args.skipScoring = false;
    }
    if (token === '--with-picks') {
      args.skipPickGeneration = false;
    }
    if (token === '--reset-checkpoint') {
      args.resetCheckpoint = true;
    }
    if (token === '--no-checkpoint') {
      args.useCheckpoint = false;
    }
    if (token.startsWith('--checkpoint-file=')) {
      args.checkpointFile = token.split('=')[1].trim();
    }
    if (token.startsWith('--status-file=')) {
      args.statusFile = token.split('=')[1].trim();
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const activeStrategyIds = loadStrategyModules()
    .filter((strategy) => !args.strategyIds || args.strategyIds.includes(strategy.id))
    .map((strategy) => strategy.id);
  const checkpointFile = args.useCheckpoint === false ? null : resolveCheckpointFile({
    ...args,
    mode: 'historical',
    strategyIds: activeStrategyIds,
  });

  writeStatus(args.statusFile, {
    job: 'phase2-backfill',
    status: 'running',
    pid: process.pid,
    startedAt: new Date().toISOString(),
    checkpointFile,
    stdoutFile: readJsonFile(args.statusFile || '')?.stdoutFile || null,
    scope: {
      symbols: args.symbols || null,
      strategyIds: args.strategyIds || null,
      skipScoring: args.skipScoring === true,
      skipPickGeneration: args.skipPickGeneration === true,
    },
  });

  try {
    const result = await runHistoricalBackfill(args);
    writeStatus(args.statusFile, {
      job: 'phase2-backfill',
      status: 'completed',
      pid: process.pid,
      checkpointFile: result.checkpointFile || checkpointFile,
      completedAt: new Date().toISOString(),
      result,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    writeStatus(args.statusFile, {
      job: 'phase2-backfill',
      status: 'failed',
      pid: process.pid,
      checkpointFile,
      completedAt: new Date().toISOString(),
      error: error?.stack || error?.message || String(error),
    });
    throw error;
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});