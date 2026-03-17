const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

async function getSourceSymbols(sql, label) {
  const { rows } = await queryWithTimeout(sql, [], {
    timeoutMs: 10000,
    label,
    maxRetries: 0,
    poolType: 'read',
  });

  return (rows || [])
    .map((row) => String(row.symbol || '').toUpperCase().trim())
    .filter(Boolean);
}

async function runDynamicUniverseEngine() {
  try {
    const [stocksInPlay, earningsHorizon, catalystSmallMid, newsVelocity, catalystSource] = await Promise.all([
      getSourceSymbols(
        `SELECT DISTINCT symbol
         FROM catalyst_signals
         WHERE created_at > NOW() - INTERVAL '6 hours'`,
        'dynamic_universe.source.stocks_in_play'
      ),
      getSourceSymbols(
        `SELECT DISTINCT symbol
         FROM earnings_events
         WHERE earnings_date BETWEEN CURRENT_DATE
         AND CURRENT_DATE + INTERVAL '10 days'`,
        'dynamic_universe.source.earnings_horizon'
      ),
      getSourceSymbols(
        `SELECT DISTINCT ci.symbol
         FROM catalyst_intelligence ci
         JOIN company_profiles cp
         ON ci.symbol = cp.symbol
         JOIN LATERAL (
           SELECT i.close AS last_price
           FROM intraday_1m i
           WHERE i.symbol = ci.symbol
             AND COALESCE(i.close, 0) > 0
           ORDER BY i.timestamp DESC
           LIMIT 1
         ) px ON true
         WHERE
           cp.market_cap BETWEEN 300000000 AND 10000000000
           AND px.last_price BETWEEN 5 AND 40
           AND ci.freshness_minutes < 180`,
        'dynamic_universe.source.catalyst_small_mid'
      ),
      getSourceSymbols(
        `SELECT DISTINCT symbol
         FROM news_articles
         WHERE published_at > NOW() - INTERVAL '3 hours'`,
        'dynamic_universe.source.news_velocity'
      ),
      getSourceSymbols(
        `SELECT DISTINCT symbol
         FROM catalyst_events
         WHERE created_at > NOW() - INTERVAL '12 hours'`,
        'dynamic_universe.source.catalyst_events'
      ),
    ]);

    const priorityBySymbol = new Map();
    const applyPriority = (symbols, priority) => {
      for (const symbol of symbols) {
        const prev = priorityBySymbol.get(symbol) || 0;
        if (priority > prev) priorityBySymbol.set(symbol, priority);
      }
    };

    applyPriority(stocksInPlay, 6);
    applyPriority(earningsHorizon, 5);
    applyPriority(catalystSmallMid, 5);
    applyPriority(newsVelocity, 4);
    applyPriority(catalystSource, 7);

    const mergedRanked = Array.from(priorityBySymbol.entries())
      .map(([symbol, priority]) => ({ symbol, priority }))
      .sort((a, b) => b.priority - a.priority || a.symbol.localeCompare(b.symbol));

    const universeGuardApplied = mergedRanked.length > 900;
    const finalSelection = universeGuardApplied ? mergedRanked.slice(0, 800) : mergedRanked;
    const mergedSymbols = finalSelection.map((row) => row.symbol);

    let inserted = 0;
    for (const entry of finalSelection) {
      const result = await queryWithTimeout(
        `INSERT INTO tracked_universe
           (symbol, source, priority, added_at, active)
         VALUES ($1, 'dynamic_universe', $2, NOW(), true)
         ON CONFLICT(symbol) DO UPDATE
         SET active = true,
             priority = GREATEST(tracked_universe.priority, EXCLUDED.priority)`,
        [entry.symbol, entry.priority],
        {
          timeoutMs: 6000,
          label: 'dynamic_universe.insert_symbol',
          maxRetries: 0,
          poolType: 'write',
        }
      );

      inserted += Number(result?.rowCount || 0);
    }

    if (universeGuardApplied) {
      await queryWithTimeout(
        `UPDATE tracked_universe
         SET active = false
         WHERE source = 'dynamic_universe'
           AND active = true`,
        [],
        {
          timeoutMs: 8000,
          label: 'dynamic_universe.guard.reset_dynamic',
          maxRetries: 0,
          poolType: 'write',
        }
      );

      for (const entry of finalSelection) {
        await queryWithTimeout(
          `INSERT INTO tracked_universe
             (symbol, source, priority, added_at, active)
           VALUES ($1, 'dynamic_universe', $2, NOW(), true)
           ON CONFLICT(symbol) DO UPDATE
           SET source = 'dynamic_universe',
               active = true,
               priority = GREATEST(tracked_universe.priority, EXCLUDED.priority)`,
          [entry.symbol, entry.priority],
          {
            timeoutMs: 6000,
            label: 'dynamic_universe.guard.reactivate_top',
            maxRetries: 0,
            poolType: 'write',
          }
        );
      }
    }

    const cleanupResult = await queryWithTimeout(
      `UPDATE tracked_universe
       SET active = false
       WHERE symbol NOT IN (
         SELECT symbol FROM catalyst_signals
         WHERE created_at > NOW() - INTERVAL '1 day'
       )
       AND added_at < NOW() - INTERVAL '1 day'`,
      [],
      {
        timeoutMs: 10000,
        label: 'dynamic_universe.cleanup',
        maxRetries: 0,
        poolType: 'write',
      }
    );

    const trackedResult = await queryWithTimeout(
      `SELECT COUNT(*)::int AS tracked_universe_size
       FROM tracked_universe
       WHERE active = true`,
      [],
      {
        timeoutMs: 5000,
        label: 'dynamic_universe.tracked_size',
        maxRetries: 0,
        poolType: 'read',
      }
    );

    const trackedUniverseSize = trackedResult?.rows?.[0]?.tracked_universe_size ?? 0;

    logger.info('[DYNAMIC_UNIVERSE] cycle complete', {
      sourceCounts: {
        stocksInPlay: stocksInPlay.length,
        earningsHorizon: earningsHorizon.length,
        catalystSmallMid: catalystSmallMid.length,
        newsVelocity: newsVelocity.length,
        catalystSource: catalystSource.length,
      },
      mergedCount: mergedRanked.length,
      selectedCount: finalSelection.length,
      universeGuardApplied,
      inserted,
      deactivated: Number(cleanupResult?.rowCount || 0),
      trackedUniverseSize,
    });

    return {
      sourceCounts: {
        stocksInPlay: stocksInPlay.length,
        earningsHorizon: earningsHorizon.length,
        catalystSmallMid: catalystSmallMid.length,
        newsVelocity: newsVelocity.length,
        catalystSource: catalystSource.length,
      },
      mergedCount: mergedRanked.length,
      selectedCount: finalSelection.length,
      universeGuardApplied,
      inserted,
      deactivated: Number(cleanupResult?.rowCount || 0),
      trackedUniverseSize,
    };
  } catch (error) {
    logger.error('[DYNAMIC_UNIVERSE] cycle failed', { error: error.message });
    throw error;
  }
}

module.exports = {
  runDynamicUniverseEngine,
};