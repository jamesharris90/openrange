async function startEnginesSequentially() {
  const delay = (ms) => new Promise((res) => setTimeout(res, ms));

  try {
    const addEngineJob = require('./engineQueue');
    const {
      runMetricsNow,
      runUniverseBuilderNow,
      runStrategyEngineNow,
      runIntelNewsNow,
    } = require('../engines/scheduler');
    const { runStrategySignalEngine } = require('../engines/strategySignalEngine');
    const runRadarEngine = require('../engines/radarEngine');

    console.log('[Engine] Starting Metrics Engine');
    addEngineJob(async () => {
      await runMetricsNow();
      console.log('[ENGINE] Metrics started');
      await delay(2000);
    });

    console.log('[Engine] Starting Universe Builder');
    addEngineJob(async () => {
      await runUniverseBuilderNow();
      console.log('[ENGINE] Universe builder started');
      await delay(2000);
    });

    console.log('[Engine] Starting Strategy Engine');
    addEngineJob(async () => {
      await runStrategyEngineNow();
      console.log('[ENGINE] Strategy engine started');
      await delay(2000);
    });

    console.log('[Engine] Starting Strategy Signal Engine');
    addEngineJob(async () => {
      await runStrategySignalEngine();
      console.log('[ENGINE] Strategy signal engine started');
      await runRadarEngine();
      console.log('[ENGINE] Radar engine started');
      await delay(2000);
    });

    console.log('[Engine] Starting Intelligence Engine');
    addEngineJob(async () => {
      await runIntelNewsNow();
      console.log('[ENGINE] Intel engine started');
    });

    console.log('[Engine] All engines started successfully');
  } catch (err) {
    console.error('[Engine] Startup failure', err);
  }
}

module.exports = startEnginesSequentially;
