const { queryWithTimeout } = require('../db/pg');
const logger = require('../logger');

function normalizeClass(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'A' || raw.endsWith(' A')) return 'A';
  if (raw === 'B' || raw.endsWith(' B')) return 'B';
  if (raw === 'C' || raw.endsWith(' C')) return 'C';
  return null;
}

/**
 * Fetch aggregated radar data from Supabase views.
 * @returns {{ market_summary, stocks_in_play, momentum_leaders, news_catalysts, a_plus_setups }}
 */
async function fetchRadarData() {
  logger.info('[ENGINE_START] radar_engine');

  const safeQuery = async (label, sql) => {
    try {
      const { rows } = await queryWithTimeout(sql, [], {
        label,
        timeoutMs: 7000,
        maxRetries: 0,
      });
      return Array.isArray(rows) ? rows : [];
    } catch (err) {
      logger.error(`[ENGINE_ERROR] radar_engine error=${err.message}`, { label });
      return [];
    }
  };

  const [market_summary, stocks_in_play, momentum_leaders, news_catalysts, a_plus_setups] =
    await Promise.all([
      safeQuery('radar.market_summary', 'SELECT * FROM radar_market_summary'),
      safeQuery('radar.stocks_in_play', 'SELECT * FROM radar_stocks_in_play'),
      safeQuery('radar.momentum', 'SELECT * FROM radar_momentum'),
      safeQuery('radar.news', 'SELECT * FROM radar_news'),
      safeQuery('radar.a_setups', 'SELECT * FROM radar_a_setups'),
    ]);

  const totalRows =
    market_summary.length +
    stocks_in_play.length +
    momentum_leaders.length +
    news_catalysts.length +
    a_plus_setups.length;

  logger.info(`[ENGINE_COMPLETE] radar_engine rows_processed=${totalRows}`);

  return { market_summary, stocks_in_play, momentum_leaders, news_catalysts, a_plus_setups };
}

async function runRadarEngine() {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT *
       FROM strategy_signals
       WHERE updated_at >= NOW() - INTERVAL '15 minutes'`,
      [],
      { label: 'radar.engine.strategy_signals', timeoutMs: 7000, maxRetries: 0 }
    );

    const ranked = (Array.isArray(rows) ? rows : [])
      .filter((row) => Number(row?.score) >= 70)
      .sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0));

    const radar = { A: [], B: [], C: [] };

    for (const row of ranked) {
      const cls = normalizeClass(row?.class);
      if (!cls) continue;
      radar[cls].push(row);
    }

    return radar;
  } catch (error) {
    logger.error('[ENGINE ERROR] radar run failed', { error: error.message });
    return { A: [], B: [], C: [], error: error.message };
  }
}

module.exports = runRadarEngine;
module.exports.fetchRadarData = fetchRadarData;
