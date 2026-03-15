function runWithTimeout(runner, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.resolve().then(() => runner());
  }

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(`Engine run timed out after ${timeoutMs}ms`);
      err.code = 'ENGINE_RUN_TIMEOUT';
      reject(err);
    }, timeoutMs);
  });

  return Promise.race([
    Promise.resolve().then(() => runner()),
    timeoutPromise,
  ]).finally(() => clearTimeout(timeoutId));
}

function scheduleEngine(engine, runner, options = {}) {
  const {
    validateOutput,
    runOnStart = true,
    logger = () => {},
  } = options;

  let timer = null;
  let running = false;

  const executeRun = async (reason = 'scheduled') => {
    if (running) {
      return false;
    }

    running = true;
    engine.status = 'running';
    engine.lastStart = Date.now();
    engine.error = null;

    logger('info', 'engine_run_started', { engine: engine.key, reason });

    try {
      const timeoutMs = Math.max(engine.interval * 2000, 15000);
      await runWithTimeout(runner, timeoutMs);

      engine.lastRun = Date.now();

      if (typeof validateOutput === 'function') {
        const hasOutput = await validateOutput(engine);
        if (!hasOutput) {
          engine.status = 'no output';
          logger('warn', 'engine_no_output', { engine: engine.key });
        } else {
          engine.status = 'healthy';
          engine.lastOutputAt = Date.now();
        }
      } else {
        engine.status = 'healthy';
      }

      logger('info', 'engine_run_complete', {
        engine: engine.key,
        status: engine.status,
        lastRun: engine.lastRun,
      });
    } catch (err) {
      engine.status = 'error';
      engine.error = err.message;
      logger('error', 'engine_run_error', {
        engine: engine.key,
        error: err.message,
      });
    } finally {
      running = false;
    }

    return true;
  };

  const startTimer = () => {
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      executeRun('scheduled').catch(() => null);
    }, engine.interval * 1000);
  };

  startTimer();

  if (runOnStart) {
    executeRun('startup').catch(() => null);
  }

  return {
    triggerNow: () => executeRun('manual'),
    restart: async () => {
      startTimer();
      return executeRun('restart');
    },
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

module.exports = {
  scheduleEngine,
};
