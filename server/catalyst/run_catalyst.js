require('dotenv').config();

const { runCatalystCycle } = require('./catalyst_scheduler');
const { pool } = require('../db/pg');

async function runCatalyst() {
  const result = await runCatalystCycle('manual');

  const typeDistribution = await pool.query(
    `SELECT catalyst_type,
            COUNT(*)::int AS count
     FROM trade_catalysts
     GROUP BY catalyst_type
     ORDER BY count DESC`
  );

  const report = {
    ...result,
    distribution: typeDistribution.rows,
  };

  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (require.main === module) {
  runCatalyst()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('run_catalyst fatal error:', err.message);
      await pool.end();
      process.exit(1);
    });
}

module.exports = {
  runCatalyst,
};
