// @ts-nocheck
// server/scripts/runCalibration.ts

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { detectStructures } = require('../services/strategyDetectionEngineV1.ts');
const { getEnrichedUniverse: loadEnrichedUniverse } = require('../services/marketDataEngineV1.ts');

async function main() {
  const universe = await loadEnrichedUniverse();
  for (const stock of universe) {
    detectStructures(stock);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
