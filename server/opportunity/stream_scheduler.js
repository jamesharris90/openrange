const logger = require('../logger');
const { runOpportunityStreamCycle } = require('./stream_engine');

const OPPORTUNITY_STREAM_INTERVAL_MS = 60 * 1000;
let opportunityStreamTimer = null;
let inFlight = false;

async function tickOpportunityStream() {
  if (inFlight) return;
  inFlight = true;

  try {
    await runOpportunityStreamCycle();
  } catch (err) {
    logger.error('Opportunity stream scheduler tick failed', { error: err.message });
  } finally {
    inFlight = false;
  }
}

function startOpportunityStreamScheduler() {
  if (opportunityStreamTimer) {
    return opportunityStreamTimer;
  }

  logger.info('Starting opportunity stream scheduler', {
    intervalMs: OPPORTUNITY_STREAM_INTERVAL_MS,
  });

  tickOpportunityStream();
  opportunityStreamTimer = setInterval(tickOpportunityStream, OPPORTUNITY_STREAM_INTERVAL_MS);
  return opportunityStreamTimer;
}

module.exports = {
  startOpportunityStreamScheduler,
  tickOpportunityStream,
};
