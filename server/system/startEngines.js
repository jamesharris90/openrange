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
const { registerEmailIntelligenceSchedules } = require('../email/emailDispatcher');
const { runSignalLearningEngine } = require('../engines/signalLearningEngine');
const { updateSignalOutcomeResults } = require('../engines/signalOutcomeWriter');
const { runOpportunityRanker } = require('../engines/opportunityRanker');
const { runOpportunityIntelligenceEngine } = require('../engines/opportunityIntelligenceEngine');
const { runSignalCalibrationEngine } = require('../engines/signalCalibrationEngine');
const { runCalibrationPriceUpdater } = require('../engines/calibrationPriceUpdater');
const { runSignalOutcomeEngine } = require('../engines/signalOutcomeEngine');
const { runDynamicUniverseEngine } = require('../engines/dynamicUniverseEngine');
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
const { evaluateSignals: evaluateTradeOutcomeSignals, updateOutcomes } = require('../engines/tradeOutcomeEngine');
const { runTQI } = require('../engines/tradeQualityEngine');
const { runBacktest } = require('../engines/backtestEngine');
const { runCatalystDetectionEngine } = require('../engines/catalystDetectionEngine');
const { runCatalystIntelligenceEngine } = require('../engines/catalystIntelligenceEngine');
const { runCatalystPrecedentEngine } = require('../engines/catalystPrecedentEngine');
const { runCatalystSignalEngine } = require('../engines/catalystSignalEngine');
const { runCatalystNarrativeEngine } = require('../engines/catalystNarrativeEngine');
const { runCatalystReactionEngine } = require('../engines/catalystReactionEngine');
const { runExtendedHoursIngest } = require('../engines/fmp_extended_hours_ingest');
const { runFullUniverseRefresh } = require('../engines/fullUniverseRefreshEngine');
const { runOptionsIntelligenceEngine } = require('../engines/optionsIntelligenceEngine');
const { startLiveTickEngine } = require('../engines/liveTickEngine');
const { runEarlySignalEngine } = require('../engines/earlySignalEngine');
const { getActiveTrackedSymbols } = require('../services/trackedUniverseService');
const { sendBeaconMorningBrief, sendSystemMonitor } = require('../email/emailDispatcher');
const { sendStocksInPlayAlert } = require('../email/stocksInPlayAlert');
const { systemGuard } = require('./systemGuard');
const { runDataRecoveryEngine } = require('../engines/dataRecoveryEngine');
const { runDataOrchestrator } = require('./dataOrchestrator');
const { purgeOldValidationLogs, flushValidationMetrics } = require('../engines/dataValidationEngine');
const { logCron } = require('./cronMonitor');
const { queryWithTimeout } = require('../db/pg');

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
let optionsIntelligenceInFlight = false;
let sectorMomentumInFlight = false;
let hierarchyInFlight = false;
let morningBriefInFlight = false;
let newsletterInFlight = false;
let signalPerfSnapshotInFlight = false;
let strategyEvaluationInFlight = false;
let strategyEngineMinuteInFlight = false;
let marketNarrativeInFlight = false;
let signalLearningInFlight = false;
let signalOutcomeUpdateInFlight = false;
let opportunityInFlight = false;
let intelligenceInFlight = false;
let signalCalibrationInFlight = false;
let calibrationPriceUpdateInFlight = false;
let signalOutcomeEngineInFlight = false;
let dynamicUniverseEngineInFlight = false;
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
let tradeOutcomeInFlight = false;
let beaconMorningEmailInFlight = false;
let stocksInPlayEmailInFlight = false;
let systemMonitorEmailInFlight = false;
let catalystDetectionInFlight = false;
let catalystIntelligenceInFlight = false;
let catalystPrecedentInFlight = false;
let catalystSignalInFlight = false;
let catalystNarrativeInFlight = false;
let catalystReactionInFlight = false;
let extendedHoursInFlight = false;
let systemGuardInFlight = false;
let earlySignalInFlight = false;
let refreshRunning = false;

function getEngineCount(result) {
  if (Array.isArray(result)) return result.length;
  if (Array.isArray(result?.rows)) return result.rows.length;
  if (typeof result?.ingested === 'number') return result.ingested;
  if (typeof result?.upserted === 'number') return result.upserted;
  if (typeof result?.catalystsStored === 'number') return result.catalystsStored;
  if (typeof result?.count === 'number') return result.count;
  if (typeof result?.processed === 'number') return result.processed;
  if (typeof result?.inserted === 'number') return result.inserted;
  return 0;
}

function getEngineSymbols(result) {
  if (Array.isArray(result?.symbols)) {
    return result.symbols
      .filter((symbol) => typeof symbol === 'string' && symbol.length > 0)
      .slice(0, 50);
  }

  const rows = Array.isArray(result)
    ? result
    : Array.isArray(result?.rows)
      ? result.rows
      : [];

  return rows
    .map((row) => row?.symbol)
    .filter((symbol) => typeof symbol === 'string' && symbol.length > 0)
    .slice(0, 50);
}

async function safeRefresh() {
  if (refreshRunning || global.fullUniverseRefreshRunning) {
    return;
  }

  refreshRunning = true;
  global.fullUniverseRefreshRunning = true;

  try {
    console.log('[REFRESH] starting');
    await runFullUniverseRefresh();
    console.log('[REFRESH] completed');
  } catch (error) {
    console.error('[REFRESH ERROR]', error.message);
  } finally {
    refreshRunning = false;
    global.fullUniverseRefreshRunning = false;
  }
}

async function getTradableUniverse() {
  try {
    const trackedSymbols = await getActiveTrackedSymbols();
    if (trackedSymbols.length > 0) {
      return trackedSymbols;
    }
  } catch (error) {
    console.warn('[EARLY_SIGNAL] tracked universe lookup failed', error.message);
  }

  try {
    const { rows } = await queryWithTimeout(
      `SELECT symbol
       FROM market_metrics
       WHERE source = 'real'
         AND symbol IS NOT NULL
       ORDER BY COALESCE(volume, 0) DESC
       LIMIT 600`,
      [],
      {
        label: 'early_signal.universe_fallback',
        timeoutMs: 7000,
        maxRetries: 1,
        retryDelayMs: 200,
        poolType: 'read',
      }
    );

    return (rows || [])
      .map((row) => String(row.symbol || '').trim().toUpperCase())
      .filter(Boolean);
  } catch (error) {
    console.error('[EARLY_SIGNAL] fallback universe query failed', error.message);
    return [];
  }
}

async function startEnginesSequentially() {
  const delay = (ms) => new Promise((res) => setTimeout(res, ms));

  try {
    console.log('[ENGINE] Signal engine started');
    console.log('[ENGINE] Stocks in play engine started');
    console.log('[ENGINE] Ingestion engine started');

    await validateSchema();

    // Seed signal_outcomes from signal_log backlog if the table is empty.
    // Must run before systemGuard so writes are not yet blocked.
    seedSignalOutcomesFromLog().catch((err) =>
      console.warn('[ENGINE] signal_outcomes seed failed', err.message)
    );

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

      logCron('ENGINE_START', { engine: 'catalyst' });
      runCatalystEngine().then((result) => {
        const count = getEngineCount(result);
        console.log('[ENGINE OUTPUT]', {
          engine: 'catalyst',
          symbols: getEngineSymbols(result),
          count,
        });
        logCron('ENGINE_SUCCESS', { engine: 'catalyst', count });
      }).catch((err) => {
        console.error('[CATALYST ENGINE ERROR]', err);
        logCron('ENGINE_ERROR', { engine: 'catalyst', error: err.message });
      });

      setInterval(() => {
        if (catalystInFlight) return;
        catalystInFlight = true;
        logCron('ENGINE_START', { engine: 'catalyst' });
        runCatalystEngine().then((result) => {
          const count = getEngineCount(result);
          console.log('[ENGINE OUTPUT]', {
            engine: 'catalyst',
            symbols: getEngineSymbols(result),
            count,
          });
          logCron('ENGINE_SUCCESS', { engine: 'catalyst', count });
        }).catch((err) => {
          console.error('[CATALYST ENGINE ERROR]', err);
          logCron('ENGINE_ERROR', { engine: 'catalyst', error: err.message });
        }).finally(() => {
          catalystInFlight = false;
        });
      }, 5 * 60 * 1000);
    }

    if (!global.catalystDetectionSchedulerStarted) {
      global.catalystDetectionSchedulerStarted = true;
      console.log('[CATALYST_DETECTION] scheduler registered (*/2 * * * *)');

      cron.schedule('*/2 * * * *', async () => {
        if (catalystDetectionInFlight) return;
        catalystDetectionInFlight = true;
        try {
          await runCatalystDetectionEngine();
        } catch (error) {
          console.error('[CATALYST_DETECTION] scheduled run error', error.message);
        } finally {
          catalystDetectionInFlight = false;
        }
      });
    }

    if (!global.catalystIntelligenceSchedulerStarted) {
      global.catalystIntelligenceSchedulerStarted = true;
      console.log('[CATALYST_INTELLIGENCE] scheduler registered (*/5 * * * *)');

      cron.schedule('*/5 * * * *', async () => {
        if (catalystIntelligenceInFlight) return;
        catalystIntelligenceInFlight = true;
        try {
          await runCatalystIntelligenceEngine();
        } catch (error) {
          console.error('[CATALYST_INTELLIGENCE] scheduled run error', error.message);
        } finally {
          catalystIntelligenceInFlight = false;
        }
      });
    }

    if (!global.catalystPrecedentSchedulerStarted) {
      global.catalystPrecedentSchedulerStarted = true;
      console.log('[CATALYST_PRECEDENT] scheduler registered (0 * * * *)');

      cron.schedule('0 * * * *', async () => {
        if (catalystPrecedentInFlight) return;
        catalystPrecedentInFlight = true;
        try {
          await runCatalystPrecedentEngine();
        } catch (error) {
          console.error('[CATALYST_PRECEDENT] scheduled run error', error.message);
        } finally {
          catalystPrecedentInFlight = false;
        }
      });
    }

    if (!global.catalystSignalSchedulerStarted) {
      global.catalystSignalSchedulerStarted = true;
      console.log('[CATALYST_SIGNAL] scheduler registered (*/5 * * * *)');

      cron.schedule('*/5 * * * *', async () => {
        if (catalystSignalInFlight) return;
        catalystSignalInFlight = true;
        try {
          await runCatalystSignalEngine();
        } catch (error) {
          console.error('[CATALYST_SIGNAL] scheduled run error', error.message);
        } finally {
          catalystSignalInFlight = false;
        }
      });
    }

    if (!global.catalystNarrativeSchedulerStarted) {
      global.catalystNarrativeSchedulerStarted = true;
      console.log('[CATALYST_NARRATIVE] scheduler registered (*/5 * * * *)');

      cron.schedule('*/5 * * * *', async () => {
        if (catalystNarrativeInFlight) return;
        catalystNarrativeInFlight = true;
        try {
          await runCatalystNarrativeEngine();
        } catch (error) {
          console.error('[CATALYST_NARRATIVE] scheduled run error', error.message);
        } finally {
          catalystNarrativeInFlight = false;
        }
      });
    }

    if (!global.catalystReactionSchedulerStarted) {
      global.catalystReactionSchedulerStarted = true;
      console.log('[CATALYST_REACTION] scheduler registered (*/5 * * * *)');

      cron.schedule('*/5 * * * *', async () => {
        if (catalystReactionInFlight) return;
        catalystReactionInFlight = true;
        try {
          await runCatalystReactionEngine();
        } catch (error) {
          console.error('[CATALYST_REACTION] scheduled run error', error.message);
        } finally {
          catalystReactionInFlight = false;
        }
      });
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

    if (!global.strategyEngineSchedulerStarted) {
      global.strategyEngineSchedulerStarted = true;
      console.log('[STRATEGY_ENGINE] scheduler registered (every 60s)');

      setInterval(async () => {
        if (strategyEngineMinuteInFlight) return;
        strategyEngineMinuteInFlight = true;
        try {
          await runStrategyEngineNow();
        } catch (error) {
          console.error('[STRATEGY_ENGINE] scheduled run error', error.message);
        } finally {
          strategyEngineMinuteInFlight = false;
        }
      }, 60 * 1000);
    }

    if (!global.fullUniverseRefreshSchedulerStarted) {
      global.fullUniverseRefreshSchedulerStarted = true;
      console.log('[FULL_UNIVERSE_REFRESH] scheduler registered (every 60s)');

      console.log('[REFRESH BOOT] triggered');
      await safeRefresh();

      setInterval(safeRefresh, 60000);

      setInterval(() => {
        console.log('[REFRESH HEARTBEAT]', new Date().toISOString());
      }, 60000);
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
        logCron('ENGINE_START', { engine: 'stocks-in-play' });
        try {
          const result = await runStocksInPlayEngine();
          const count = getEngineCount(result);
          console.log('[ENGINE OUTPUT]', {
            engine: 'stocks',
            symbols: getEngineSymbols(result),
            count,
          });
          logCron('ENGINE_SUCCESS', { engine: 'stocks-in-play', count });
        } catch (error) {
          console.error('[STOCKS_IN_PLAY] scheduled run error', error.message);
          logCron('ENGINE_ERROR', { engine: 'stocks-in-play', error: error.message });
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

    if (!global.optionsIntelligenceSchedulerStarted) {
      global.optionsIntelligenceSchedulerStarted = true;
      console.log('[OPTIONS_INTELLIGENCE] scheduler registered (2,7,12,17,22,27,32,37,42,47,52,57 * * * *)');

      // Staggered 2 min after each 5-min boundary (off-peak from quote refresh)
      cron.schedule('2,7,12,17,22,27,32,37,42,47,52,57 * * * *', async () => {
        if (optionsIntelligenceInFlight) return;
        optionsIntelligenceInFlight = true;
        try {
          const result = await runOptionsIntelligenceEngine();
          logCron('ENGINE_SUCCESS', { engine: 'options-intelligence', ...result });
        } catch (error) {
          console.error('[OPTIONS_INTELLIGENCE] scheduled run error', error.message);
          logCron('ENGINE_ERROR', { engine: 'options-intelligence', error: error.message });
        } finally {
          optionsIntelligenceInFlight = false;
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

    if (!global.emailIntelligenceSchedulerStarted) {
      global.emailIntelligenceSchedulerStarted = true;
      registerEmailIntelligenceSchedules();
      console.log('[EMAIL_INTELLIGENCE] schedulers registered');
      console.log('[EMAIL SCHEDULER] Morning Brief active');
      console.log('[EMAIL SCHEDULER] Weekly Scorecard active');
      console.log('[EMAIL SCHEDULER] Earnings Intelligence active');
      console.log('[EMAIL SCHEDULER] System Monitor active');

      console.log('[EMAIL_INTELLIGENCE] additive scheduler registered (07:00 weekdays London beacon)');
      cron.schedule('0 7 * * 1-5', async () => {
        if (beaconMorningEmailInFlight) return;
        beaconMorningEmailInFlight = true;
        try {
          await sendBeaconMorningBrief().catch((error) => {
            console.error('[EMAIL_INTELLIGENCE] beacon morning send error', error.message);
          });
        } finally {
          beaconMorningEmailInFlight = false;
        }
      }, { timezone: 'Europe/London' });

      console.log('[EMAIL_INTELLIGENCE] additive scheduler registered (market open stocks in play)');
      cron.schedule('30 14 * * 1-5', async () => {
        if (stocksInPlayEmailInFlight) return;
        stocksInPlayEmailInFlight = true;
        try {
          await sendStocksInPlayAlert().catch((error) => {
            console.error('[EMAIL_INTELLIGENCE] stocks in play send error', error.message);
          });
        } finally {
          stocksInPlayEmailInFlight = false;
        }
      }, { timezone: 'Europe/London' });

      console.log('[EMAIL_INTELLIGENCE] additive scheduler registered (06:30 daily London monitor)');
      cron.schedule('30 6 * * *', async () => {
        if (systemMonitorEmailInFlight) return;
        systemMonitorEmailInFlight = true;
        try {
          await sendSystemMonitor().catch((error) => {
            console.error('[EMAIL_INTELLIGENCE] system monitor send error', error.message);
          });
        } finally {
          systemMonitorEmailInFlight = false;
        }
      }, { timezone: 'Europe/London' });
    }

    if (!global.tradeOutcomeSchedulerStarted) {
      global.tradeOutcomeSchedulerStarted = true;
      console.log('[TRADE_OUTCOME] scheduler registered (*/30 * * * *)');

      cron.schedule('*/30 * * * *', async () => {
        if (tradeOutcomeInFlight) return;
        tradeOutcomeInFlight = true;
        try {
          await evaluateTradeOutcomeSignals();
        } catch (error) {
          console.error('[TRADE_OUTCOME] scheduled evaluation error', error.message);
        } finally {
          tradeOutcomeInFlight = false;
        }
      });
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
      logCron('ENGINE_START', { engine: 'intelligence' });
      runOpportunityIntelligenceEngine().then((result) => {
        const count = getEngineCount(result);
        console.log('[ENGINE OUTPUT]', {
          engine: 'intelligence',
          symbols: getEngineSymbols(result),
          count,
        });
        logCron('ENGINE_SUCCESS', { engine: 'intelligence', count });
      }).catch((error) => {
        console.error('[INTELLIGENCE_ENGINE] initial run error', error.message);
        logCron('ENGINE_ERROR', { engine: 'intelligence', error: error.message });
      }).finally(() => {
        intelligenceInFlight = false;
      });

      cron.schedule('*/10 * * * *', async () => {
        if (intelligenceInFlight) return;
        intelligenceInFlight = true;
        logCron('ENGINE_START', { engine: 'intelligence' });
        try {
          const result = await runOpportunityIntelligenceEngine();
          const count = getEngineCount(result);
          console.log('[ENGINE OUTPUT]', {
            engine: 'intelligence',
            symbols: getEngineSymbols(result),
            count,
          });
          logCron('ENGINE_SUCCESS', { engine: 'intelligence', count });
        } catch (error) {
          console.error('[INTELLIGENCE_ENGINE] scheduled run error', error.message);
          logCron('ENGINE_ERROR', { engine: 'intelligence', error: error.message });
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
      console.log('[SIGNAL_OUTCOME_ENGINE] scheduler registered (*/10 * * * *)');

      signalOutcomeEngineInFlight = true;
      runSignalOutcomeEngine().catch((error) =>
        console.error('[SIGNAL_OUTCOME_ENGINE] initial run error', error.message)
      ).finally(() => {
        signalOutcomeEngineInFlight = false;
      });

      cron.schedule('*/10 * * * *', async () => {
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

    if (!global.dynamicUniverseEngineStarted) {
      global.dynamicUniverseEngineStarted = true;
      console.log('[DYNAMIC_UNIVERSE_ENGINE] scheduler registered (*/15 * * * *)');

      dynamicUniverseEngineInFlight = true;
      runDynamicUniverseEngine().catch((error) =>
        console.error('[DYNAMIC_UNIVERSE_ENGINE] initial run error', error.message)
      ).finally(() => {
        dynamicUniverseEngineInFlight = false;
      });

      cron.schedule('*/15 * * * *', async () => {
        if (dynamicUniverseEngineInFlight) return;
        dynamicUniverseEngineInFlight = true;
        try {
          await runDynamicUniverseEngine();
        } catch (error) {
          console.error('[DYNAMIC_UNIVERSE_ENGINE] scheduled run error', error.message);
        } finally {
          dynamicUniverseEngineInFlight = false;
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

    if (!global.extendedHoursIngestSchedulerStarted) {
      global.extendedHoursIngestSchedulerStarted = true;
      console.log('[EXTENDED] scheduler registered (every 10s)');

      extendedHoursInFlight = true;
      runExtendedHoursIngest().catch((error) => {
        console.error('[EXTENDED] startup run error', error.message);
      }).finally(() => {
        extendedHoursInFlight = false;
      });

      setInterval(() => {
        if (extendedHoursInFlight) return;
        extendedHoursInFlight = true;

        runExtendedHoursIngest().catch((error) => {
          console.error('[EXTENDED] scheduled run error', error.message);
        }).finally(() => {
          extendedHoursInFlight = false;
        });
      }, 10000);
    }

    if (!global.liveTickEngineStarted) {
      global.liveTickEngineStarted = true;

      const symbols = await getTradableUniverse();
      if (symbols.length === 0) {
        console.warn('[EARLY_SIGNAL] no tradable symbols found; websocket engine idle');
      } else {
        startLiveTickEngine(symbols);
      }

      if (!global.earlySignalSchedulerStarted) {
        global.earlySignalSchedulerStarted = true;
        console.log('[EARLY_SIGNAL] scheduler registered (every 5 seconds)');

        setInterval(async () => {
          if (earlySignalInFlight || symbols.length === 0) return;
          earlySignalInFlight = true;
          try {
            await runEarlySignalEngine(symbols);
          } catch (error) {
            console.error('[EARLY_SIGNAL] scheduled run error', error.message);
          } finally {
            earlySignalInFlight = false;
          }
        }, 5000);
      }
    }

    if (!global.tradeQualityBacktestSchedulerStarted) {
      global.tradeQualityBacktestSchedulerStarted = true;
      console.log('[TRADE_QUALITY] scheduler registered (every 10 minutes)');

      setInterval(() => {
        try {
          updateOutcomes();
          runTQI();
          runBacktest();
        } catch (error) {
          console.error('[TRADE_QUALITY] scheduled run error', error.message);
        }
      }, 600000);
    }

    if (!global.systemGuardSchedulerStarted) {
      global.systemGuardSchedulerStarted = true;
      console.log('[SYSTEM_GUARD] scheduler registered (every 5 minutes)');

      // Fire-and-forget guard run; startup remains non-blocking.
      (async () => {
        if (systemGuardInFlight) return;
        systemGuardInFlight = true;
        try {
          await systemGuard();
        } catch (error) {
          console.error('[SYSTEM_GUARD] startup run error', error.message);
        } finally {
          systemGuardInFlight = false;
        }
      })();

      setInterval(async () => {
        if (systemGuardInFlight) return;
        systemGuardInFlight = true;
        try {
          await systemGuard();
        } catch (error) {
          console.error('[SYSTEM_GUARD] scheduled run error', error.message);
        } finally {
          systemGuardInFlight = false;
        }
      }, 300000);
    }

    // ── Data recovery engine: every 2 minutes, only runs when systemBlocked ──
    if (!global.dataRecoverySchedulerStarted) {
      global.dataRecoverySchedulerStarted = true;
      console.log('[RECOVERY] scheduler registered (every 2 minutes)');
      setInterval(async () => {
        try {
          await runDataRecoveryEngine();
        } catch (err) {
          console.error('[RECOVERY] scheduler error:', err.message);
        }
      }, 120_000);
    }

    // ── Central data orchestrator: every 60s ─────────────────────────────────
    if (!global.dataOrchestratorStarted) {
      global.dataOrchestratorStarted = true;
      console.log('[ORCHESTRATOR] scheduler registered (every 60s)');
      setInterval(async () => {
        try {
          await runDataOrchestrator();
        } catch (err) {
          console.error('[ORCHESTRATOR] scheduler error:', err.message);
        }
      }, 60_000);
    }

    // ── Validation log purge: daily (keeps data_validation_log small) ────────
    if (!global.validationLogPurgeStarted) {
      global.validationLogPurgeStarted = true;
      setTimeout(() => {
        purgeOldValidationLogs().catch(() => {});
        setInterval(() => purgeOldValidationLogs().catch(() => {}), 24 * 60 * 60 * 1000);
      }, 30_000);
    }

    // ── Validation metrics flush: every 5 minutes ─────────────────────────────
    if (!global.validationMetricsFlushStarted) {
      global.validationMetricsFlushStarted = true;
      console.log('[VALIDATION] metrics flush registered (every 5 min)');
      setInterval(() => flushValidationMetrics().catch(() => {}), 5 * 60 * 1000);
    }

    // ── Learning engine: every 15 minutes ─────────────────────────────────────
    if (!global.learningEngineStarted) {
      global.learningEngineStarted = true;
      console.log('[LEARNING] engine registered (every 15 min)');
      // Delay first run 30s so signal engines have started before we read outcomes
      setTimeout(() => {
        const { runLearningEngine } = require('../engines/learningEngine');
        runLearningEngine().catch(() => {});
      }, 30_000);
      setInterval(() => {
        const { runLearningEngine } = require('../engines/learningEngine');
        runLearningEngine().catch(() => {});
      }, 15 * 60 * 1000);
    }

    // ── Snapshot engine: every 5 minutes (market hours only) ──────────────────
    // Reads strategy_signals + opportunities_v2, applies confidence caps +
    // data completeness scoring, writes ONE consistent batch to signal_snapshots.
    // Skips automatically when market is closed.
    if (!global.snapshotEngineStarted) {
      global.snapshotEngineStarted = true;
      console.log('[SNAPSHOT] engine registered (every 5 min, market hours only)');
      // First run 60s after startup so signal engines have produced fresh data
      setTimeout(() => {
        const { runSnapshotEngine } = require('../engines/snapshotEngine');
        runSnapshotEngine().catch(err => console.warn('[SNAPSHOT] startup run failed:', err.message));
      }, 60_000);
      setInterval(() => {
        const { runSnapshotEngine } = require('../engines/snapshotEngine');
        runSnapshotEngine().catch(err => console.warn('[SNAPSHOT] scheduled run failed:', err.message));
      }, 5 * 60 * 1000);
    }

    console.log('[Engine] All engines started successfully');
  } catch (err) {
    console.error('[Engine] Startup failure', err);
  }
}

// ─── Signal outcomes bootstrap seeding ───────────────────────────────────────
// If signal_outcomes is empty (fresh DB or after wipe), seed it from signal_log
// so the learning pipeline has data to evaluate immediately.
// Runs once at startup; idempotent — safe to call multiple times.
async function seedSignalOutcomesFromLog() {
  try {
    const { queryWithTimeout: qwt } = require('../db/pg');

    const countResult = await qwt(
      `SELECT COUNT(*)::int AS n FROM signal_outcomes`,
      [],
      { timeoutMs: 5000, label: 'seed.signal_outcomes.count', maxRetries: 0 }
    );
    const existingRows = Number(countResult.rows?.[0]?.n || 0);

    if (existingRows > 0) {
      console.log(`[SEED] signal_outcomes already has ${existingRows} rows — skipping seed`);
      return;
    }

    const logCount = await qwt(
      `SELECT COUNT(*)::int AS n FROM signal_log WHERE entry_price > 0 AND symbol IS NOT NULL`,
      [],
      { timeoutMs: 5000, label: 'seed.signal_log.count', maxRetries: 0 }
    );
    const logRows = Number(logCount.rows?.[0]?.n || 0);

    if (logRows === 0) {
      console.log('[SEED] signal_log has no eligible rows — cannot seed signal_outcomes');
      return;
    }

    const insertResult = await qwt(
      `INSERT INTO signal_outcomes
         (symbol, signal_ts, setup_type, trade_class, entry_price, expected_move_pct)
       SELECT
         sl.symbol,
         sl.timestamp                        AS signal_ts,
         sl.setup_type,
         CASE
           WHEN sl.score >= 80 THEN 'A'
           WHEN sl.score >= 60 THEN 'B'
           WHEN sl.score >= 40 THEN 'C'
           ELSE 'D'
         END                                 AS trade_class,
         sl.entry_price,
         sl.expected_move                    AS expected_move_pct
       FROM signal_log sl
       WHERE sl.entry_price > 0
         AND sl.symbol IS NOT NULL
         AND TRIM(sl.symbol) <> ''
       ORDER BY sl.timestamp DESC
       LIMIT 500`,
      [],
      { timeoutMs: 30000, label: 'seed.signal_outcomes.insert', maxRetries: 0 }
    );

    const seeded = insertResult?.rowCount || 0;
    console.log(`[SEED] signal_outcomes seeded with ${seeded} rows from signal_log`);
  } catch (err) {
    console.warn('[SEED] signal_outcomes seeding failed (non-fatal):', err.message);
  }
}

const startEngines = startEnginesSequentially;

module.exports = { startEngines, seedSignalOutcomesFromLog };
