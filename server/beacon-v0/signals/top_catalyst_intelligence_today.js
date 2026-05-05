const {
  buildUniverseClause,
  createResultMap,
  queryWithTimeout,
  toNumber,
} = require('./_helpers');

const SIGNAL_NAME = 'top_catalyst_intelligence_today';
const CATEGORY = 'catalyst';
const RUN_MODE = 'leaderboard';
const FORWARD_LOOKING = false;
const TOP_N = 100;
const LOOKBACK_HOURS = 24;
const FRESHNESS_WINDOW_MINUTES = 12 * 60;

async function detect(universe = [], options = {}) {
  const topN = Number(options.topN || TOP_N);
  const lookbackHours = Number(options.lookbackHours || LOOKBACK_HOURS);
  const freshnessWindowMinutes = Number(options.freshnessWindowMinutes || FRESHNESS_WINDOW_MINUTES);
  const universeFilter = buildUniverseClause(universe, 4);

  const result = await queryWithTimeout(
    `
      WITH ranked_catalysts AS (
        SELECT
          UPPER(symbol) AS symbol,
          MAX(
            ((COALESCE(sentiment_score, 0) * 0.4)
             + (COALESCE(confidence_score, 0) * 0.4)
             + (GREATEST(0, 1 - (COALESCE(freshness_minutes, $2) / $2::numeric)) * 0.2))
            * SQRT(GREATEST(1, COALESCE(provider_count, 1)))
          ) AS score,
          MAX(confidence_score) AS top_confidence,
          MAX(sentiment_score) AS top_sentiment,
          MIN(freshness_minutes) AS min_freshness,
          MAX(provider_count) AS max_providers,
          COUNT(*)::int AS catalyst_count,
          MAX(created_at) AS latest_at
        FROM catalyst_intelligence
        WHERE symbol IS NOT NULL
          AND created_at >= NOW() - ($1::int * INTERVAL '1 hour')
          ${universeFilter.clause}
        GROUP BY UPPER(symbol)
      )
      SELECT
        symbol,
        score::numeric(10,4) AS score,
        top_confidence,
        top_sentiment,
        min_freshness,
        max_providers,
        catalyst_count,
        latest_at
      FROM ranked_catalysts
      WHERE score > 0
      ORDER BY score DESC, latest_at DESC
      LIMIT $3
    `,
    [lookbackHours, freshnessWindowMinutes, topN, ...universeFilter.params],
    {
      label: 'beacon_v0.signal.top_catalyst_intelligence_today',
      timeoutMs: 15000,
      slowQueryMs: 1000,
      poolType: 'read',
      maxRetries: 1,
    },
  );

  return createResultMap(result.rows, (row, index) => {
    const score = toNumber(row.score) || 0;
    const confidenceScore = toNumber(row.top_confidence);
    const sentimentScore = toNumber(row.top_sentiment);
    const freshnessMinutes = toNumber(row.min_freshness);
    const providerCount = toNumber(row.max_providers) || 1;
    const catalystCount = toNumber(row.catalyst_count) || 0;

    return {
      symbol: row.symbol,
      signal: SIGNAL_NAME,
      rank: index + 1,
      score,
      metadata: {
        confidence_score: confidenceScore,
        sentiment_score: sentimentScore,
        freshness_minutes: freshnessMinutes,
        provider_count: providerCount,
        catalyst_count: catalystCount,
        latest_at: row.latest_at,
        lookback_hours: lookbackHours,
        cluster: 'CATALYST_INTELLIGENCE',
        score,
      },
      reasoning: `Catalyst intelligence rank ${index + 1}: confidence ${(confidenceScore ?? 0).toFixed(2)}, sentiment ${(sentimentScore ?? 0).toFixed(2)}, ${providerCount} source${providerCount === 1 ? '' : 's'}, ${freshnessMinutes ?? '?'}min fresh`,
    };
  });
}

function summarize(metadata = {}) {
  const providerCount = toNumber(metadata.provider_count);
  const freshnessMinutes = toNumber(metadata.freshness_minutes);
  const confidenceScore = toNumber(metadata.confidence_score);
  if (providerCount == null && freshnessMinutes == null && confidenceScore == null) return null;
  return `catalyst intelligence ${providerCount ?? '?'} source${providerCount === 1 ? '' : 's'}, ${freshnessMinutes ?? '?'}m fresh, confidence ${(confidenceScore ?? 0).toFixed(2)}`;
}

module.exports = {
  CATEGORY,
  FORWARD_LOOKING,
  FRESHNESS_WINDOW_MINUTES,
  LOOKBACK_HOURS,
  RUN_MODE,
  SIGNAL_NAME,
  TOP_N,
  detect,
  summarize,
};