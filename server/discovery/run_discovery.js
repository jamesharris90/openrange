require('dotenv').config();

const { runDiscoveryCycle } = require('./discovery_scheduler');
const { pool } = require('../db/pg');

async function runDiscovery() {
  const result = await runDiscoveryCycle('manual');

  const distribution = await pool.query(
    `SELECT source,
            COUNT(*)::int AS count
     FROM discovered_symbols
     GROUP BY source
     ORDER BY count DESC`
  );

  const report = {
    ...result,
    source_distribution: distribution.rows,
  };

  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (require.main === module) {
  runDiscovery()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('run_discovery fatal error:', err.message);
      await pool.end();
      process.exit(1);
    });
}

module.exports = {
  runDiscovery,
};
