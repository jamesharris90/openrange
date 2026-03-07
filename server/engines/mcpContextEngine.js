const db = require('../db');

async function buildContext(headline) {
  console.log('[MCP] building context');

  const radarSignals = await db.query(
    `SELECT symbol, strategy, score
     FROM strategy_signals
     WHERE updated_at >= NOW() - INTERVAL '2 hours'
     ORDER BY score DESC
     LIMIT 10`
  );

  const marketMetrics = await db.query(
    `SELECT symbol, close, change_percent
     FROM market_metrics
     WHERE symbol IN ('SPY', 'QQQ', 'IWM', 'VIX')
     ORDER BY symbol`
  );

  const sectorPerformance = await db.query(
    `SELECT sector,
            AVG(change_percent) AS avg_change_percent,
            COUNT(*) AS symbols
     FROM market_metrics
     WHERE updated_at >= NOW() - INTERVAL '1 day'
       AND sector IS NOT NULL
     GROUP BY sector
     ORDER BY avg_change_percent DESC NULLS LAST
     LIMIT 10`
  );

  const recentStrategySignals = await db.query(
    `SELECT symbol, strategy, score, updated_at
     FROM strategy_signals
     WHERE updated_at >= NOW() - INTERVAL '24 hours'
     ORDER BY updated_at DESC
     LIMIT 20`
  );

  return {
    headline,
    signals: radarSignals.rows,
    market: marketMetrics.rows,
    sectorPerformance: sectorPerformance.rows,
    recentStrategySignals: recentStrategySignals.rows,
  };
}

module.exports = { buildContext };
