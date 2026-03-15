function monitorEngines(engines, options = {}) {
  const {
    checkEverySeconds = 15,
    onStalled,
    logger = () => {},
  } = options;

  const timer = setInterval(() => {
    const now = Date.now();

    Object.values(engines).forEach((engine) => {
      if (!engine.lastRun) {
        return;
      }

      const lagMs = now - engine.lastRun;
      const delayedThresholdMs = engine.interval * 2000;
      const stalledThresholdMs = engine.interval * 3000;

      if (lagMs > stalledThresholdMs) {
        if (engine.status !== 'stalled') {
          engine.status = 'stalled';
          logger('warn', 'engine_stalled', {
            engine: engine.key,
            lagSeconds: Math.floor(lagMs / 1000),
          });
        }

        if (typeof onStalled === 'function') {
          Promise.resolve(onStalled(engine)).catch(() => null);
        }
        return;
      }

      if (lagMs > delayedThresholdMs && engine.status === 'healthy') {
        engine.status = 'delayed';
      }
    });
  }, checkEverySeconds * 1000);

  return {
    stop: () => clearInterval(timer),
  };
}

module.exports = {
  monitorEngines,
};
