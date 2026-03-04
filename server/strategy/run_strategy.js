require('dotenv').config();

const { runStrategyCycle } = require('./strategy_scheduler');
const { pool } = require('../db/pg');

async function runStrategy() {
  const result = await runStrategyCycle('manual');

  const distribution = await pool.query(
    `SELECT setup,
            COUNT(*)::int AS count
     FROM trade_setups
     GROUP BY setup
     ORDER BY count DESC`
  );

  const report = {
    ...result,
    distribution: distribution.rows,
  };

  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (require.main === module) {
  runStrategy()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('run_strategy fatal error:', err.message);
      await pool.end();
      process.exit(1);
    });
}

module.exports = {
  runStrategy,
};
