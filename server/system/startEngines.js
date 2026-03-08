const { evaluateSignals } = require('../engines/signalPerformanceEngine');
const { runSignalNarrativeEngine } = require('../engines/signalNarrativeEngine');
const { runMcpNarrativeEngine } = require('../engines/mcpNarrativeEngine');
const { runIntelNarrativeEngine } = require('../engines/intelNarrativeEngine');
const { validateSchema } = require('./schemaValidator');
const cron = require('node-cron');
const { runRssWorker } = require('../workers/rss_worker');
const { runMorningBriefEngine } = require('../engines/morningBriefEngine');

let performanceSchedulerStarted = false;
let performanceRunInFlight = false;
let narrativeSchedulerStarted = false;
let rssSchedulerStarted = false;
let morningBriefSchedulerStarted = false;

async function startEnginesSequentially() {
  const delay = (ms) => new Promise((res) => setTimeout(res, ms));

  try {
    await validateSchema();

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

    console.log('[Engine] Starting Signal Performance Engine');
    addEngineJob(async () => {
      await evaluateSignals();
      console.log('[ENGINE] Signal performance engine started');
    });

    // Fire-and-forget startup pass so performance evaluation begins immediately
    // without blocking Express bootstrap.
    (async () => {
      try {
        console.log('[PERFORMANCE] initial evaluation starting');
        await evaluateSignals();
        console.log('[PERFORMANCE] initial evaluation complete');
      } catch (err) {
        console.error('[PERFORMANCE ENGINE STARTUP ERROR]', err);
      }
    })();

    if (!performanceSchedulerStarted) {
      performanceSchedulerStarted = true;

      setInterval(async () => {
        if (performanceRunInFlight) {
          return;
        }

        performanceRunInFlight = true;
        try {
          console.log('[PERFORMANCE] scheduled evaluation starting');
          await evaluateSignals();
          console.log('[PERFORMANCE] scheduled evaluation finished');
        } catch (err) {
          console.error('[PERFORMANCE ENGINE ERROR]', err);
        } finally {
          performanceRunInFlight = false;
        }
      }, 15 * 60 * 1000);
    }

    if (!global.intelligenceSchedulerStarted) {
      global.intelligenceSchedulerStarted = true;

      setInterval(runSignalNarrativeEngine, 15 * 60 * 1000);
      setInterval(runMcpNarrativeEngine, 30 * 60 * 1000);
    }

    if (!global.intelNarrativeSchedulerStarted) {
      global.intelNarrativeSchedulerStarted = true;

      setInterval(() => {
        runIntelNarrativeEngine();
      }, 10 * 60 * 1000);
    }

    if (!narrativeSchedulerStarted) {
      narrativeSchedulerStarted = true;

      (async () => {
        try {
          console.log('[INTEL] starting engines');
          runSignalNarrativeEngine();
          runMcpNarrativeEngine();
          runIntelNarrativeEngine();
        } catch (err) {
          console.error('[ENGINE ERROR]', err.message);
        }
      })();
    }

    if (!rssSchedulerStarted) {
      rssSchedulerStarted = true;
      cron.schedule('*/2 * * * *', async () => {
        try {
          await runRssWorker();
        } catch (error) {
          console.error('[RSS] scheduled worker error', error.message);
        }
      });
      console.log('[RSS] scheduler registered (every 2 minutes)');
    }

    if (!morningBriefSchedulerStarted) {
      morningBriefSchedulerStarted = true;
      cron.schedule('0 8 * * 1-5', async () => {
        try {
          await runMorningBriefEngine({ sendEmail: true });
        } catch (error) {
          console.error('[MORNING_BRIEF] scheduled run error', error.message);
        }
      }, { timezone: 'America/New_York' });
      console.log('[MORNING_BRIEF] scheduler registered (08:00 ET weekdays)');
    }

    console.log('[Engine] All engines started successfully');
  } catch (err) {
    console.error('[Engine] Startup failure', err);
  }
}

module.exports = startEnginesSequentially;
