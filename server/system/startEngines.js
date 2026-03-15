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
const { runSignalCalibrationEngine } = require('../engines/signalCalibrationEngine');
const { runCalibrationPriceUpdater } = require('../engines/calibrationPriceUpdater');
const { runSignalOutcomeEngine } = require('../engines/signalOutcomeEngine');
const { runHistoricalReplay } = require('../engines/replay/historicalSignalReplayEngine');
const { updateStrategyWeights } = require('../engines/adaptiveStrategyEngine');
const { runMissedOpportunityEngine } = require('../engines/missedOpportunityEngine');
const { runMissedOpportunityReplay } = require('../engines/missedOpportunityReplay');
const { runValidationTests, runWeeklyValidationAggregation } = require('../engines/validationEngine');
const { runSignalFeatureEngine } = require('../engines/signalFeatureEngine');
const { runExpectedMoveEngine } = require('../engines/expectedMoveEngine');
const { runMarketRegimeEngine } = require('../engines/marketRegimeEngine');
const { runSignalCaptureEngine } = require('../engines/signalCaptureEngine');
const { runStrategyLearningEngine } = require('../engines/strategyLearningEngine');

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
let signalCalibrationInFlight = false;
let calibrationPriceUpdateInFlight = false;
let signalOutcomeEngineInFlight = false;
let historicalReplayInFlight = false;
let adaptiveStrategyInFlight = false;
let validationDailyInFlight = false;
let missedOpportunityInFlight = false;
let missedOpportunityReplayInFlight = false;
let signalFeatureInFlight = false;
let expectedMoveInFlight = false;
let marketRegimeInFlight = false;
let signalCaptureInFlight = false;
let strategyLearningInFlight = false;

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
          await runMorningBriefEngine({ sendEmail: true, scheduleWindowTag: '08:00_ET' });
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

    if (!global.signalCalibrationEngineStarted) {
      global.signalCalibrationEngineStarted = true;
      console.log('[SIGNAL_CALIBRATION] scheduler registered (*/15 * * * *)');

      signalCalibrationInFlight = true;
      runSignalCalibrationEngine().catch((error) =>
        console.error('[SIGNAL_CALIBRATION] initial run error', error.message)
      ).finally(() => {
        signalCalibrationInFlight = false;
      });

      cron.schedule('*/15 * * * *', async () => {
        if (signalCalibrationInFlight) return;
        signalCalibrationInFlight = true;
        try {
          await runSignalCalibrationEngine();
        } catch (error) {
          console.error('[SIGNAL_CALIBRATION] scheduled run error', error.message);
        } finally {
          signalCalibrationInFlight = false;
        }
      });
    }

    if (!global.calibrationPriceUpdaterStarted) {
      global.calibrationPriceUpdaterStarted = true;
      console.log('[CALIBRATION_PRICE_UPDATER] scheduler registered (*/30 * * * *)');

      calibrationPriceUpdateInFlight = true;
      runCalibrationPriceUpdater().catch((error) =>
        console.error('[CALIBRATION_PRICE_UPDATER] initial run error', error.message)
      ).finally(() => {
        calibrationPriceUpdateInFlight = false;
      });

      cron.schedule('*/30 * * * *', async () => {
        if (calibrationPriceUpdateInFlight) return;
        calibrationPriceUpdateInFlight = true;
        try {
          await runCalibrationPriceUpdater();
        } catch (error) {
          console.error('[CALIBRATION_PRICE_UPDATER] scheduled run error', error.message);
        } finally {
          calibrationPriceUpdateInFlight = false;
        }
      });
    }

    if (!global.signalOutcomeEngineStarted) {
      global.signalOutcomeEngineStarted = true;
      console.log('[SIGNAL_OUTCOME_ENGINE] scheduler registered (*/15 * * * *)');

      signalOutcomeEngineInFlight = true;
      runSignalOutcomeEngine().catch((error) =>
        console.error('[SIGNAL_OUTCOME_ENGINE] initial run error', error.message)
      ).finally(() => {
        signalOutcomeEngineInFlight = false;
      });

      cron.schedule('*/15 * * * *', async () => {
        if (signalOutcomeEngineInFlight) return;
        signalOutcomeEngineInFlight = true;
        try {
          await runSignalOutcomeEngine();
        } catch (error) {
          console.error('[SIGNAL_OUTCOME_ENGINE] scheduled run error', error.message);
        } finally {
          signalOutcomeEngineInFlight = false;
        }
      });
    }

    if (!global.historicalReplayStarted) {
      global.historicalReplayStarted = true;
      console.log('[REPLAY ENGINE] scheduler registered (0 2 * * *)');

      // Nightly replay at 02:00 server time
      cron.schedule('0 2 * * *', async () => {
        if (historicalReplayInFlight) return;
        historicalReplayInFlight = true;
        global.replayLastRunAt = null; // reset while in progress
        try {
          await runHistoricalReplay();
          global.replayLastRunAt = new Date().toISOString();
          console.log('[REPLAY ENGINE] nightly run complete', global.replayLastRunAt);
        } catch (error) {
          console.error('[REPLAY ENGINE] scheduled run error', error.message);
        } finally {
          historicalReplayInFlight = false;
        }
      });
    }

    if (!global.adaptiveStrategyEngineStarted) {
      global.adaptiveStrategyEngineStarted = true;
      console.log('[ADAPTIVE_STRATEGY] scheduler registered (*/30 * * * *)');

      adaptiveStrategyInFlight = true;
      updateStrategyWeights().then(() => {
        global.adaptiveLastRunAt = new Date().toISOString();
      }).catch((error) =>
        console.error('[ADAPTIVE_STRATEGY] initial run error', error.message)
      ).finally(() => {
        adaptiveStrategyInFlight = false;
      });

      cron.schedule('*/30 * * * *', async () => {
        if (adaptiveStrategyInFlight) return;
        adaptiveStrategyInFlight = true;
        try {
          await updateStrategyWeights();
          global.adaptiveLastRunAt = new Date().toISOString();
        } catch (error) {
          console.error('[ADAPTIVE_STRATEGY] scheduled run error', error.message);
        } finally {
          adaptiveStrategyInFlight = false;
        }
      });
    }

    if (!global.phaseFValidationSchedulerStarted) {
      global.phaseFValidationSchedulerStarted = true;
      console.log('[VALIDATION_ENGINE] scheduler registered (00:00 daily)');
      console.log('[MISSED_OPPORTUNITY_ENGINE] scheduler registered (00:10 daily)');
      console.log('[MISSED_REPLAY_ENGINE] scheduler registered (00:20 daily)');

      cron.schedule('0 0 * * *', async () => {
        if (validationDailyInFlight) return;
        validationDailyInFlight = true;
        try {
          await runValidationTests();
          global.validationLastRunAt = new Date().toISOString();

          const now = new Date();
          // Weekly aggregation on Mondays.
          if (now.getDay() === 1) {
            await runWeeklyValidationAggregation();
          }
        } catch (error) {
          console.error('[VALIDATION_ENGINE] scheduled run error', error.message);
        } finally {
          validationDailyInFlight = false;
        }
      });

      cron.schedule('10 0 * * *', async () => {
        if (missedOpportunityInFlight) return;
        missedOpportunityInFlight = true;
        try {
          await runMissedOpportunityEngine();
        } catch (error) {
          console.error('[MISSED_OPPORTUNITY_ENGINE] scheduled run error', error.message);
        } finally {
          missedOpportunityInFlight = false;
        }
      });

      cron.schedule('20 0 * * *', async () => {
        if (missedOpportunityReplayInFlight) return;
        missedOpportunityReplayInFlight = true;
        try {
          await runMissedOpportunityReplay();
        } catch (error) {
          console.error('[MISSED_REPLAY_ENGINE] scheduled run error', error.message);
        } finally {
          missedOpportunityReplayInFlight = false;
        }
      });
    }

    if (!global.learningEngineSchedulerStarted) {
      global.learningEngineSchedulerStarted = true;
      console.log('[SIGNAL_FEATURE_ENGINE] scheduler registered (every 1 minute)');
      console.log('[EXPECTED_MOVE_ENGINE] scheduler registered (hourly)');
      console.log('[MARKET_REGIME_ENGINE] scheduler registered (daily 00:05)');
      console.log('[SIGNAL_CAPTURE_ENGINE] scheduler registered (daily 00:15)');
      console.log('[STRATEGY_LEARNING_ENGINE] scheduler registered (weekly Monday 00:30)');

      cron.schedule('* * * * *', async () => {
        if (signalFeatureInFlight) return;
        signalFeatureInFlight = true;
        try {
          await runSignalFeatureEngine();
        } catch (error) {
          console.error('[SIGNAL_FEATURE_ENGINE] scheduled run error', error.message);
        } finally {
          signalFeatureInFlight = false;
        }
      });

      cron.schedule('0 * * * *', async () => {
        if (expectedMoveInFlight) return;
        expectedMoveInFlight = true;
        try {
          await runExpectedMoveEngine();
        } catch (error) {
          console.error('[EXPECTED_MOVE_ENGINE] scheduled run error', error.message);
        } finally {
          expectedMoveInFlight = false;
        }
      });

      cron.schedule('5 0 * * *', async () => {
        if (marketRegimeInFlight) return;
        marketRegimeInFlight = true;
        try {
          await runMarketRegimeEngine();
        } catch (error) {
          console.error('[MARKET_REGIME_ENGINE] scheduled run error', error.message);
        } finally {
          marketRegimeInFlight = false;
        }
      });

      cron.schedule('15 0 * * *', async () => {
        if (signalCaptureInFlight) return;
        signalCaptureInFlight = true;
        try {
          await runSignalCaptureEngine();
        } catch (error) {
          console.error('[SIGNAL_CAPTURE_ENGINE] scheduled run error', error.message);
        } finally {
          signalCaptureInFlight = false;
        }
      });

      cron.schedule('30 0 * * 1', async () => {
        if (strategyLearningInFlight) return;
        strategyLearningInFlight = true;
        try {
          await runStrategyLearningEngine();
        } catch (error) {
          console.error('[STRATEGY_LEARNING_ENGINE] scheduled run error', error.message);
        } finally {
          strategyLearningInFlight = false;
        }
      });
    }

    console.log('[Engine] All engines started successfully');
  } catch (err) {
    console.error('[Engine] Startup failure', err);
  }
}

module.exports = startEnginesSequentially;
