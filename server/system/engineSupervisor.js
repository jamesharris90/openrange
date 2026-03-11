const engines = {};
const restartAttempts = {};

function registerEngine(name, fn) {
  engines[name] = fn;
  restartAttempts[name] = 0;
}

async function runEngine(name) {
  try {
    if (typeof engines[name] !== 'function') {
      throw new Error(`Engine not registered: ${name}`);
    }

    console.log(`[ENGINE RUN] ${name}`);
    await engines[name]();
    restartAttempts[name] = 0;
  } catch (err) {
    console.error(`[ENGINE FAIL] ${name}`, err.message);
    restartAttempts[name] = (restartAttempts[name] || 0) + 1;

    if (restartAttempts[name] < 5) {
      console.log(`[ENGINE RESTART] ${name}`);
      setTimeout(() => {
        runEngine(name);
      }, 5000);
    }
  }
}

function startAllEngines() {
  for (const name of Object.keys(engines)) {
    runEngine(name);
  }
}

module.exports = {
  registerEngine,
  startAllEngines,
  runEngine,
};
