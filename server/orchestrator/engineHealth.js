const engines = require('./engineRegistry');

function getEngineHealth() {
  const now = Date.now();

  return {
    engines: Object.values(engines).map((engine) => {
      const lagSeconds = engine.lastRun
        ? Math.max(0, Math.floor((now - engine.lastRun) / 1000))
        : null;

      return {
        key: engine.key,
        name: engine.name,
        status: engine.status || 'unknown',
        lastRun: engine.lastRun,
        lagSeconds,
        error: engine.error || null,
      };
    }),
  };
}

module.exports = {
  getEngineHealth,
};
