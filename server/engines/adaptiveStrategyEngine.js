const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

async function updateStrategyWeights() {
  const startedAt = Date.now();
  logger.info('[ENGINE_START] adaptiveStrategyEngine');

  try {
    await queryWithTimeout('SELECT update_strategy_weights();', [], {
      timeoutMs: 15000,
      label: 'adaptive.update_strategy_weights',
      maxRetries: 0,
    });

    const countResult = await queryWithTimeout(
      'SELECT COUNT(*)::int AS count FROM strategy_weights',
      [],
      {
        timeoutMs: 8000,
        label: 'adaptive.strategy_weights_count',
        maxRetries: 0,
      }
    );

    const strategiesUpdated = Number(countResult?.rows?.[0]?.count || 0);
    const runtimeMs = Date.now() - startedAt;
    logger.info(`[ENGINE_COMPLETE] adaptiveStrategyEngine rows_processed=${strategiesUpdated}`);

    return { ok: true, strategiesUpdated, runtimeMs };
  } catch (error) {
    const runtimeMs = Date.now() - startedAt;
    logger.error(`[ENGINE_ERROR] adaptiveStrategyEngine error=${error.message}`);
    return { ok: false, strategiesUpdated: 0, runtimeMs, error: error.message };
  }
}

module.exports = {
  updateStrategyWeights,
};
