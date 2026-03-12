const { evaluateSignals } = require('../engines/signalPerformanceEngine');
const { runSignalPerformanceEngine } = require('../engines/signalPerformanceEngine');
const { runSignalNarrativeEngine } = require('../engines/signalNarrativeEngine');
const { runMcpNarrativeEngine } = require('../engines/mcpNarrativeEngine');
const { runIntelNarrativeEngine } = require('../engines/intelNarrativeEngine');
const { validateSchema } = require('./schemaValidator');
const cron = require('node-cron');
const { runRssWorker } = require('../workers/rss_worker');
const { runMorningBriefEngine } = require('../engines/morningBriefEngine');
const { runCatalystEngine } = require('../engines/catalystEngine');
const { runStrategyEvaluationEngine } = require('../engines/strategyEvaluationEngine');
const { runNarrativeEngine } = require('../engines/narrativeEngine');
const { runEarlyAccumulationEngine } = require('../engines/earlyAccumulationEngine');
const { runEarlySignalOutcomeEngine } = require('../engines/earlySignalOutcomeEngine');
const { runStocksInPlayEngine } = require('../engines/stocksInPlayEngine');
const { runOrderFlowImbalanceEngine } = require('../engines/orderFlowImbalanceEngine');
const { runSectorMomentumEngine } = require('../engines/sectorMomentumEngine');
const { runSignalHierarchyEngine } = require('../engines/signalHierarchyEngine');
const { runPremarketNewsletter } = require('../engines/newsletterEngine');
const { runSignalLearningEngine } = require('../engines/signalLearningEngine');
const { updateSignalOutcomeResults } = require('../engines/signalOutcomeWriter');
const { runOpportunityRanker } = require('../engines/opportunityRanker');
const { runOpportunityIntelligenceEngine } = require('../engines/opportunityIntelligenceEngine');

let performanceSchedulerStarted = false;
let performanceRunInFlight = false;
let narrativeSchedulerStarted = false;
let rssSchedulerStarted = false;
let morningBriefSchedulerStarted = false;
let stocksInPlayInFlight = false;
let catalystInFlight = false;
let earlyAccumulationInFlight = false;
let earlyOutcomeInFlight = false;
let orderFlowInFlight = false;
let sectorMomentumInFlight = false;
let hierarchyInFlight = false;
let morningBriefInFlight = false;
let newsletterInFlight = false;
let signalPerfSnapshotInFlight = false;
let strategyEvaluationInFlight = false;
let marketNarrativeInFlight = false;
let signalLearningInFlight = false;
let signalOutcomeUpdateInFlight = false;
let opportunityInFlight = false;
let intelligenceInFlight = false;

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
        if (morningBriefInFlight) return;
        morningBriefInFlight = true;
        try {
          await runMorningBriefEngine({ sendEmail: true });
        } catch (error) {
          console.error('[MORNING_BRIEF] scheduled run error', error.message);
        } finally {
          morningBriefInFlight = false;
        }
      }, { timezone: 'America/New_York' });
      console.log('[MORNING_BRIEF] scheduler registered (08:00 ET weekdays)');
    }

    if (!global.catalystSchedulerStarted) {
      global.catalystSchedulerStarted = true;

      console.log('[CATALYST] Scheduler started');

      runCatalystEngine().catch((err) =>
        console.error('[CATALYST ENGINE ERROR]', err)
      );

      setInterval(() => {
        if (catalystInFlight) return;
        catalystInFlight = true;
        runCatalystEngine().catch((err) =>
          console.error('[CATALYST ENGINE ERROR]', err)
        ).finally(() => {
          catalystInFlight = false;
        });
      }, 5 * 60 * 1000);
    }

    if (!global.strategyEvaluationSchedulerStarted) {
      global.strategyEvaluationSchedulerStarted = true;

      console.log('[STRATEGY_EVALUATION] Scheduler started');

      strategyEvaluationInFlight = true;
      runStrategyEvaluationEngine().catch((err) =>
        console.error('[STRATEGY_EVALUATION ERROR]', err)
      ).finally(() => {
        strategyEvaluationInFlight = false;
      });

      setInterval(() => {
        if (strategyEvaluationInFlight) return;
        strategyEvaluationInFlight = true;
        runStrategyEvaluationEngine().catch((err) =>
          console.error('[STRATEGY_EVALUATION ERROR]', err)
        ).finally(() => {
          strategyEvaluationInFlight = false;
        });
      }, 15 * 60 * 1000);
    }

    if (!global.marketNarrativeSchedulerStarted) {
      global.marketNarrativeSchedulerStarted = true;

      console.log('[NARRATIVE] Scheduler started');

      marketNarrativeInFlight = true;
      runNarrativeEngine().catch((err) =>
        console.error('[NARRATIVE_ENGINE ERROR]', err)
      ).finally(() => {
        marketNarrativeInFlight = false;
      });

      setInterval(() => {
        if (marketNarrativeInFlight) return;
        marketNarrativeInFlight = true;
        runNarrativeEngine().catch((err) =>
          console.error('[NARRATIVE_ENGINE ERROR]', err)
        ).finally(() => {
          marketNarrativeInFlight = false;
        });
      }, 30 * 60 * 1000);
    }

    if (!global.earlyAccumulationSchedulerStarted) {
      global.earlyAccumulationSchedulerStarted = true;
      console.log('[EARLY_ACCUMULATION] scheduler registered (*/3 * * * *)');

      cron.schedule('*/3 * * * *', async () => {
        if (earlyAccumulationInFlight) return;
        earlyAccumulationInFlight = true;
        try {
          await runEarlyAccumulationEngine();
        } catch (error) {
          console.error('[EARLY_ACCUMULATION] scheduled run error', error.message);
        } finally {
          earlyAccumulationInFlight = false;
        }
      });
    }

    if (!global.earlySignalOutcomeSchedulerStarted) {
      global.earlySignalOutcomeSchedulerStarted = true;
      console.log('[EARLY_SIGNAL_OUTCOME] scheduler registered (*/30 * * * *)');

      cron.schedule('*/30 * * * *', async () => {
        if (earlyOutcomeInFlight) return;
        earlyOutcomeInFlight = true;
        try {
          await runEarlySignalOutcomeEngine();
        } catch (error) {
          console.error('[EARLY_SIGNAL_OUTCOME] scheduled run error', error.message);
        } finally {
          earlyOutcomeInFlight = false;
        }
      });
    }

    if (!global.stocksInPlaySchedulerStarted) {
      global.stocksInPlaySchedulerStarted = true;
      console.log('[STOCKS_IN_PLAY] scheduler registered (*/5 * * * *)');

      cron.schedule('*/5 * * * *', async () => {
        if (stocksInPlayInFlight) return;
        stocksInPlayInFlight = true;
        try {
          await runStocksInPlayEngine();
        } catch (error) {
          console.error('[STOCKS_IN_PLAY] scheduled run error', error.message);
        } finally {
          stocksInPlayInFlight = false;
        }
      });
    }

    if (!global.orderFlowSchedulerStarted) {
      global.orderFlowSchedulerStarted = true;
      console.log('[ORDER_FLOW_IMBALANCE] scheduler registered (*/5 * * * *)');

      cron.schedule('*/5 * * * *', async () => {
        if (orderFlowInFlight) return;
        orderFlowInFlight = true;
        try {
          await runOrderFlowImbalanceEngine();
        } catch (error) {
          console.error('[ORDER_FLOW_IMBALANCE] scheduled run error', error.message);
        } finally {
          orderFlowInFlight = false;
        }
      });
    }

    if (!global.sectorMomentumSchedulerStarted) {
      global.sectorMomentumSchedulerStarted = true;
      console.log('[SECTOR_MOMENTUM] scheduler registered (*/10 * * * *)');

      cron.schedule('*/10 * * * *', async () => {
        if (sectorMomentumInFlight) return;
        sectorMomentumInFlight = true;
        try {
          await runSectorMomentumEngine();
        } catch (error) {
          console.error('[SECTOR_MOMENTUM] scheduled run error', error.message);
        } finally {
          sectorMomentumInFlight = false;
        }
      });
    }

    if (!global.signalHierarchySchedulerStarted) {
      global.signalHierarchySchedulerStarted = true;
      console.log('[SIGNAL_HIERARCHY] scheduler registered (*/5 * * * *)');

      cron.schedule('*/5 * * * *', async () => {
        if (hierarchyInFlight) return;
        hierarchyInFlight = true;
        try {
          await runSignalHierarchyEngine();
        } catch (error) {
          console.error('[SIGNAL_HIERARCHY] scheduled run error', error.message);
        } finally {
          hierarchyInFlight = false;
        }
      });
    }

    if (!global.opportunitySchedulerStarted) {
      global.opportunitySchedulerStarted = true;
      console.log('[OPPORTUNITY] scheduler registered (*/5 * * * *)');

      opportunityInFlight = true;
      runOpportunityRanker().catch((error) =>
        console.error('[OPPORTUNITY] initial run error', error.message)
      ).finally(() => {
        opportunityInFlight = false;
      });

      cron.schedule('*/5 * * * *', async () => {
        if (opportunityInFlight) return;
        opportunityInFlight = true;
        try {
          await runOpportunityRanker();
        } catch (error) {
          console.error('[OPPORTUNITY] scheduled run error', error.message);
        } finally {
          opportunityInFlight = false;
        }
      });
    }

    if (!global.newsletterSchedulerStarted) {
      global.newsletterSchedulerStarted = true;
      console.log('[NEWSLETTER] scheduler registered (08:15 ET weekdays)');

      cron.schedule('15 8 * * 1-5', async () => {
        if (newsletterInFlight) return;
        newsletterInFlight = true;
        try {
          await runPremarketNewsletter({ sendEmail: true });
        } catch (error) {
          console.error('[NEWSLETTER] scheduled run error', error.message);
        } finally {
          newsletterInFlight = false;
        }
      }, { timezone: 'America/New_York' });
    }

    if (!global.signalPerformanceSnapshotSchedulerStarted) {
      global.signalPerformanceSnapshotSchedulerStarted = true;
      console.log('[SIGNAL_PERFORMANCE_SNAPSHOT] scheduler registered (*/30 * * * *)');

      cron.schedule('*/30 * * * *', async () => {
        if (signalPerfSnapshotInFlight) return;
        signalPerfSnapshotInFlight = true;
        try {
          await runSignalPerformanceEngine();
        } catch (error) {
          console.error('[SIGNAL_PERFORMANCE_SNAPSHOT] scheduled run error', error.message);
        } finally {
          signalPerfSnapshotInFlight = false;
        }
      });
    }

    if (!global.signalLearningSchedulerStarted) {
      global.signalLearningSchedulerStarted = true;
      console.log('[LEARNING_ENGINE] scheduler registered (0 3 * * *)');

      cron.schedule('0 3 * * *', async () => {
        if (signalLearningInFlight) return;
        signalLearningInFlight = true;
        try {
          await runSignalLearningEngine();
        } catch (error) {
          console.error('[LEARNING_ENGINE] scheduled run error', error.message);
        } finally {
          signalLearningInFlight = false;
        }
      });
    }

    if (!global.signalOutcomeUpdaterSchedulerStarted) {
      global.signalOutcomeUpdaterSchedulerStarted = true;
      console.log('[OUTCOME_UPDATER] scheduler registered (*/15 * * * *)');

      cron.schedule('*/15 * * * *', async () => {
        if (signalOutcomeUpdateInFlight) return;
        signalOutcomeUpdateInFlight = true;
        try {
          await updateSignalOutcomeResults();
        } catch (error) {
          console.error('[OUTCOME_UPDATER] scheduled run error', error.message);
        } finally {
          signalOutcomeUpdateInFlight = false;
        }
      });
    }

    if (!global.intelligenceEngineStarted) {
      global.intelligenceEngineStarted = true;
      console.log('[INTELLIGENCE_ENGINE] scheduler registered (*/10 * * * *)');

      intelligenceInFlight = true;
      runOpportunityIntelligenceEngine().catch((error) =>
        console.error('[INTELLIGENCE_ENGINE] initial run error', error.message)
      ).finally(() => {
        intelligenceInFlight = false;
      });

      cron.schedule('*/10 * * * *', async () => {
        if (intelligenceInFlight) return;
        intelligenceInFlight = true;
        try {
          await runOpportunityIntelligenceEngine();
        } catch (error) {
          console.error('[INTELLIGENCE_ENGINE] scheduled run error', error.message);
        } finally {
          intelligenceInFlight = false;
        }
      });
    }

    console.log('[Engine] All engines started successfully');
  } catch (err) {
    console.error('[Engine] Startup failure', err);
  }
}

module.exports = startEnginesSequentially;
