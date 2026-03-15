const fs = require('fs');
const path = require('path');

const engines = require('./engineRegistry');
const { scheduleEngine } = require('./engineScheduler');
const { monitorEngines } = require('./engineMonitor');
const { getEngineHealth } = require('./engineHealth');
const { queryWithTimeout } = require('../db/pg');

const runRadarEngine = require('../engines/radarEngine');
const { runSignalCaptureEngine } = require('../engines/signalCaptureEngine');
const { runOpportunityEngine } = require('../engines/opportunityEngine');
const { runCatalystEngine } = require('../engines/catalystEngine');
const { runExpectedMoveEngine } = require('../engines/expectedMoveEngine');
const { runMarketContextEngine } = require('../engines/marketContextEngine');

const LOG_FILE = path.resolve(__dirname, '..', 'logs', 'engine-orchestrator.log');

const controllers = {};
let monitorController = null;
let started = false;

function writeLog(level, event, meta = {}) {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${event} ${JSON.stringify(meta)}\n`;

  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch (_error) {
    // Keep orchestrator non-fatal if file logging cannot write.
  }

  if (level === 'error') {
    console.error('[ENGINE_ORCHESTRATOR]', event, meta);
  } else if (level === 'warn') {
    console.warn('[ENGINE_ORCHESTRATOR]', event, meta);
  } else {
    console.log('[ENGINE_ORCHESTRATOR]', event, meta);
  }
}

async function validateRowsWritten(engine) {
  const tableName = String(engine.tableName || '').trim();
  const timestampColumn = String(engine.timestampColumn || '').trim();
  const windowMinutes = Number(engine.validationWindowMinutes || 5);

  if (!tableName || !timestampColumn) {
    return true;
  }

  try {
    const { rows } = await queryWithTimeout(
      `SELECT COUNT(*)::int AS count
       FROM ${tableName}
       WHERE ${timestampColumn} > NOW() - ($1::int * INTERVAL '1 minute')`,
      [windowMinutes],
      {
        timeoutMs: 6000,
        maxRetries: 0,
        label: `orchestrator.validate.${tableName}`,
      }
    );

    const count = Number(rows?.[0]?.count || 0);
    return count > 0;
  } catch (error) {
    writeLog('error', 'engine_output_validation_failed', {
      engine: engine.key,
      tableName,
      timestampColumn,
      error: error.message,
    });
    return false;
  }
}

function getRunnerMap() {
  return {
    radarEngine: runRadarEngine,
    signalEngine: runSignalCaptureEngine,
    opportunityEngine: runOpportunityEngine,
    catalystEngine: runCatalystEngine,
    chartEngine: runExpectedMoveEngine,
    breadthEngine: runMarketContextEngine,
  };
}

function startOrchestrator() {
  if (started) {
    return;
  }

  started = true;
  writeLog('info', 'orchestrator_starting');
  console.log('OpenRange Engine Orchestrator starting');

  const runnerMap = getRunnerMap();

  Object.entries(engines).forEach(([engineKey, engine]) => {
    const runner = runnerMap[engineKey];

    if (typeof runner !== 'function') {
      engine.status = 'error';
      engine.error = 'Runner not configured';
      writeLog('error', 'engine_runner_missing', { engine: engineKey });
      return;
    }

    controllers[engineKey] = scheduleEngine(engine, runner, {
      validateOutput: validateRowsWritten,
      logger: writeLog,
      runOnStart: true,
    });
  });

  monitorController = monitorEngines(engines, {
    logger: writeLog,
    onStalled: async (engine) => {
      const controller = controllers[engine.key];
      if (!controller) return;
      writeLog('warn', 'engine_restart_triggered', { engine: engine.key });
      await controller.restart();
    },
  });

  writeLog('info', 'orchestrator_started', {
    engines: Object.keys(engines),
  });
}

function stopOrchestrator() {
  Object.values(controllers).forEach((controller) => {
    if (controller && typeof controller.stop === 'function') {
      controller.stop();
    }
  });

  if (monitorController && typeof monitorController.stop === 'function') {
    monitorController.stop();
  }

  writeLog('info', 'orchestrator_stopped');
}

module.exports = {
  startOrchestrator,
  stopOrchestrator,
  getEngineHealth,
};
