const { runEngine } = require('./engineSupervisor');

let lastRun = Date.now();

function heartbeat() {
  lastRun = Date.now();
}

function monitorPipeline() {
  setInterval(() => {
    const delta = Date.now() - lastRun;

    if (delta > 120000) {
      console.warn('[WATCHDOG] pipeline stalled, restarting');
      runEngine('ingestion');
      runEngine('opportunity');
    }
  }, 60000);
}

module.exports = {
  heartbeat,
  monitorPipeline,
};
