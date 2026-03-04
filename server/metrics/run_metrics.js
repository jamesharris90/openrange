require('dotenv').config();

const { runCycle } = require('./metrics_scheduler');

async function runMetrics() {
  const result = await runCycle('manual');
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  runMetrics()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('run_metrics fatal error:', err);
      process.exit(1);
    });
}

module.exports = {
  runMetrics,
};
