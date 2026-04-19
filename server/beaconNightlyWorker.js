#!/usr/bin/env node

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
process.env.PG_POOL_MAX = process.env.BEACON_NIGHTLY_PG_POOL_MAX || '1';

const { runBeaconNightlyCycle } = require('./beacon-nightly/nightlyCycle');

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runBeaconNightlyCycle({
    ...args,
    serviceRole: 'beacon-nightly-worker',
    trigger: args.trigger || 'manual',
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});