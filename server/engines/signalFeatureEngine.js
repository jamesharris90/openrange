'use strict';

const { queryWithTimeout } = require('../db/pg');

async function runSignalFeatureEngine() {
  const startedAt = Date.now();
  console.log('[SIGNAL FEATURE ENGINE] start');

  try {
    const result = await queryWithTimeout(
      `WITH candidates AS (
         SELECT
           sr.id AS signal_id,
           sr.symbol,
           sr.strategy,
           to_jsonb(mm) AS mm_json
         FROM signal_registry sr
         LEFT JOIN market_metrics mm ON mm.symbol = sr.symbol
         WHERE NOT EXISTS (
           SELECT 1 FROM signal_features sf WHERE sf.signal_id = sr.id
         )
         ORDER BY COALESCE(sr.entry_time, sr.created_at) DESC
         LIMIT 2000
       )
       INSERT INTO signal_features (
         signal_id,
         symbol,
         strategy,
         gap_percent,
         rvol,
         float_shares,
         short_interest_percent,
         market_cap,
         sector,
         relative_strength,
         volume_spike_ratio,
         catalyst_type,
         catalyst_score,
         days_to_event,
         news_sentiment,
         created_at
       )
       SELECT
         c.signal_id,
         c.symbol,
         c.strategy,
         NULLIF(c.mm_json->>'gap_percent', '')::numeric,
         COALESCE(NULLIF(c.mm_json->>'relative_volume', '')::numeric, NULLIF(c.mm_json->>'rvol', '')::numeric),
         NULLIF(c.mm_json->>'float_shares', '')::numeric,
         NULLIF(c.mm_json->>'short_interest_percent', '')::numeric,
         NULLIF(c.mm_json->>'market_cap', '')::numeric,
         COALESCE(c.mm_json->>'sector', 'Unknown'),
         COALESCE(NULLIF(c.mm_json->>'relative_strength', '')::numeric, NULLIF(c.mm_json->>'price_change_percent', '')::numeric),
         COALESCE(NULLIF(c.mm_json->>'volume_spike_ratio', '')::numeric, NULLIF(c.mm_json->>'relative_volume', '')::numeric),
         NULL,
         NULL,
         NULL,
         NULL,
         NOW()
       FROM candidates c
       RETURNING signal_id`,
      [],
      { timeoutMs: 20000, label: 'signal_features.insert', maxRetries: 0 }
    );

    const processed = Array.isArray(result?.rows) ? result.rows.length : 0;
    const runtimeMs = Date.now() - startedAt;
    console.log(`[SIGNAL FEATURE ENGINE] complete processed=${processed} runtime_ms=${runtimeMs}`);
    return { ok: true, processed, runtimeMs };
  } catch (error) {
    const runtimeMs = Date.now() - startedAt;
    console.error('[SIGNAL FEATURE ENGINE] error', error.message);
    return { ok: false, processed: 0, runtimeMs, error: error.message };
  }
}

module.exports = {
  runSignalFeatureEngine,
};
