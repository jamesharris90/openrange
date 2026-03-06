async function startEnginesSequentially() {
  const delay = (ms) => new Promise((res) => setTimeout(res, ms));

  try {
    const {
      runUniverseBuilderNow,
      runMetricsNow,
      runStrategyEngineNow,
      runOpportunityNow,
      runTrendNow,
      runIntelNewsNow,
    } = require('../engines/scheduler');

    console.log('[Engine] Starting Universe Builder');
    await runUniverseBuilderNow();
    await delay(2000);

    console.log('[Engine] Starting Metrics Engine');
    await runMetricsNow();
    await delay(2000);

    console.log('[Engine] Starting Strategy Engine');
    await runStrategyEngineNow();
    await delay(2000);

    console.log('[Engine] Starting Opportunity Engine');
    await runOpportunityNow();
    await delay(2000);

    console.log('[Engine] Starting Trend Engine');
    await runTrendNow();
    await delay(2000);

    console.log('[Engine] Starting Intelligence Engine');
    await runIntelNewsNow();
    await delay(2000);

    console.log('[Engine] All engines started successfully');
  } catch (err) {
    console.error('[Engine] Startup failure', err);
  }
}

module.exports = startEnginesSequentially;
