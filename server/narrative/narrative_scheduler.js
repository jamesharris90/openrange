const logger = require('../logger');
const { generateAndStoreMarketNarrative } = require('./narrative_engine');

const NARRATIVE_INTERVAL_MS = 5 * 60 * 1000;
let narrativeTimer = null;
let inFlight = false;

async function tickNarrative() {
  if (inFlight) return;
  inFlight = true;
  try {
    await generateAndStoreMarketNarrative();
  } catch (err) {
    logger.error('Narrative scheduler tick failed', { error: err.message });
  } finally {
    inFlight = false;
  }
}

function startNarrativeScheduler() {
  if (narrativeTimer) return narrativeTimer;

  logger.info('Starting market narrative scheduler', { intervalMs: NARRATIVE_INTERVAL_MS });
  tickNarrative();
  narrativeTimer = setInterval(tickNarrative, NARRATIVE_INTERVAL_MS);
  return narrativeTimer;
}

module.exports = {
  startNarrativeScheduler,
  tickNarrative,
};
