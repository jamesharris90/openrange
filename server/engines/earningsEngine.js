const { runEarningsIngestionEngine } = require('./earningsIngestionEngine');

async function runEarningsEngine() {
  return runEarningsIngestionEngine();
}

module.exports = {
  runEarningsEngine,
};
