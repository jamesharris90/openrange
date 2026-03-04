const { pool } = require('../db/pg');
const logger = require('../logger');

async function insertSetupEvents() {
  const query = `
    INSERT INTO opportunity_stream (symbol, event_type, headline, score, source)
    SELECT
      s.symbol,
      'setup' AS event_type,
      COALESCE(NULLIF(TRIM(s.setup), ''), 'Setup detected') AS headline,
      s.score,
      'strategy_engine' AS source
    FROM trade_setups s
    WHERE s.symbol IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM opportunity_stream os
        WHERE os.symbol = s.symbol
          AND os.event_type = 'setup'
          AND os.headline = COALESCE(NULLIF(TRIM(s.setup), ''), 'Setup detected')
          AND os.source = 'strategy_engine'
          AND os.created_at > NOW() - INTERVAL '24 hours'
      )
    ORDER BY s.score DESC NULLS LAST
    LIMIT 100
    RETURNING id
  `;

  const result = await pool.query(query);
  return result.rowCount || 0;
}

async function insertCatalystEvents() {
  const query = `
    INSERT INTO opportunity_stream (symbol, event_type, headline, score, source)
    SELECT
      c.symbol,
      'catalyst' AS event_type,
      COALESCE(NULLIF(TRIM(c.headline), ''), 'Catalyst detected') AS headline,
      c.score,
      'catalyst_engine' AS source
    FROM trade_catalysts c
    WHERE c.symbol IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM opportunity_stream os
        WHERE os.symbol = c.symbol
          AND os.event_type = 'catalyst'
          AND os.headline = COALESCE(NULLIF(TRIM(c.headline), ''), 'Catalyst detected')
          AND os.source = 'catalyst_engine'
          AND os.created_at > NOW() - INTERVAL '24 hours'
      )
    ORDER BY c.published_at DESC NULLS LAST
    LIMIT 100
    RETURNING id
  `;

  const result = await pool.query(query);
  return result.rowCount || 0;
}

async function insertMarketEvents() {
  const query = `
    INSERT INTO opportunity_stream (symbol, event_type, headline, score, source)
    SELECT
      m.symbol,
      'market' AS event_type,
      'Unusual volume or gap detected' AS headline,
      GREATEST(COALESCE(m.relative_volume, 0), COALESCE(m.gap_percent, 0))::numeric AS score,
      'market_metrics_engine' AS source
    FROM market_metrics m
    WHERE m.symbol IS NOT NULL
      AND (
        COALESCE(m.relative_volume, 0) > 3
        OR COALESCE(m.gap_percent, 0) > 4
      )
      AND NOT EXISTS (
        SELECT 1
        FROM opportunity_stream os
        WHERE os.symbol = m.symbol
          AND os.event_type = 'market'
          AND os.headline = 'Unusual volume or gap detected'
          AND os.source = 'market_metrics_engine'
          AND os.created_at > NOW() - INTERVAL '60 minutes'
      )
    ORDER BY GREATEST(COALESCE(m.relative_volume, 0), COALESCE(m.gap_percent, 0)) DESC
    LIMIT 100
    RETURNING id
  `;

  const result = await pool.query(query);
  return result.rowCount || 0;
}

async function runOpportunityStreamCycle() {
  const [setupCount, catalystCount, marketCount] = await Promise.all([
    insertSetupEvents(),
    insertCatalystEvents(),
    insertMarketEvents(),
  ]);

  const inserted = setupCount + catalystCount + marketCount;

  logger.info('Opportunity stream cycle complete', {
    setupInserted: setupCount,
    catalystInserted: catalystCount,
    marketInserted: marketCount,
    inserted,
  });

  return {
    setupInserted: setupCount,
    catalystInserted: catalystCount,
    marketInserted: marketCount,
    inserted,
  };
}

module.exports = {
  runOpportunityStreamCycle,
};
