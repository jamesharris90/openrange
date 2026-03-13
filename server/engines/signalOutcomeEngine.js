const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

async function runSignalOutcomeEngine() {
  console.log('[SIGNAL ENGINE] Evaluating signals');
  try {
    const result = await queryWithTimeout(
      `SELECT evaluate_signal_outcomes()`,
      [],
      { timeoutMs: 30000, label: 'signal_outcome_engine.evaluate', maxRetries: 0, poolType: 'write' }
    );

    const rows = result?.rows || [];
    const evaluated = rows.length > 0 ? rows[0].evaluate_signal_outcomes : null;
    console.log('[SIGNAL ENGINE] evaluation complete', evaluated !== null ? { evaluated } : '');
  } catch (err) {
    console.error('[SIGNAL ENGINE ERROR]', err.message || err);
    throw err;
  }
}

module.exports = {
  runSignalOutcomeEngine,
};
