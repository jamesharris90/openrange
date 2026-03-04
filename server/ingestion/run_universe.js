require('dotenv').config();

const { runUniverseIngestion } = require('./fmp_universe_ingest');

async function runUniverse() {
  const result = await runUniverseIngestion();
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  runUniverse()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('run_universe fatal error:', err);
      process.exit(1);
    });
}

module.exports = {
  runUniverse,
};
