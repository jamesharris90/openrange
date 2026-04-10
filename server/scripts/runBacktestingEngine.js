#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });

const { runHistoricalBackfill, runNightlyIncrementalBacktest } = require('../backtester/engine');

function parseArgs(argv) {
  const args = { mode: 'historical' };
  for (const token of argv) {
    if (token === '--nightly') args.mode = 'nightly';
    if (token === '--historical') args.mode = 'historical';
    if (token.startsWith('--strategy=')) args.strategyIds = token.split('=')[1].split(',').map((value) => value.trim()).filter(Boolean);
    if (token.startsWith('--symbols=')) args.symbols = token.split('=')[1].split(',').map((value) => value.trim()).filter(Boolean);
    if (token === '--skip-scores') args.skipScoring = true;
    if (token === '--skip-picks') args.skipPickGeneration = true;
    if (token === '--reset-checkpoint') args.resetCheckpoint = true;
    if (token === '--no-checkpoint') args.useCheckpoint = false;
    if (token.startsWith('--checkpoint-file=')) args.checkpointFile = token.split('=')[1].trim();
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = args.mode === 'nightly'
    ? await runNightlyIncrementalBacktest(args)
    : await runHistoricalBackfill(args);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});