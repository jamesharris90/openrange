const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { fmpFetch } = require('../services/fmpClient');

const FMP_API_KEY = process.env.FMP_API_KEY;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeTrend(avgChange) {
  const value = Number(avgChange || 0);
  if (value >= 0.5) return 'bullish';
  if (value <= -0.5) return 'bearish';
  return 'neutral';
}

function normalizeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function fetchPendingCatalystEvents(limit = 500) {
  const { rows } = await queryWithTimeout(
    `SELECT
       ce.news_id,
       ce.symbol,
       ce.catalyst_type,
       ce.provider_count,
       ce.freshness_minutes,
       ce.sentiment_score,
       tu.sector,
       COALESCE(mm.float_shares, 0)::numeric AS float_size,
       COALESCE(mm.short_float, 0)::numeric AS short_interest,
       COALESCE(sh.avg_change, 0)::numeric AS sector_avg_change,
       COALESCE(ms.market_avg_change, 0)::numeric AS market_avg_change,
       cp.historical_move_avg,
       cp.sample_size,
       cp.success_rate
     FROM catalyst_events ce
     LEFT JOIN ticker_universe tu ON tu.symbol = ce.symbol
     LEFT JOIN market_metrics mm ON mm.symbol = ce.symbol
     LEFT JOIN sector_heatmap sh ON sh.sector = tu.sector
     LEFT JOIN (
       SELECT AVG(avg_change)::numeric AS market_avg_change
       FROM sector_heatmap
     ) ms ON TRUE
     LEFT JOIN catalyst_precedent cp
       ON cp.symbol = ce.symbol
      AND cp.catalyst_type = ce.catalyst_type
     ORDER BY COALESCE(ce.published_at, ce.created_at) DESC
     LIMIT $1`,
    [limit],
    { timeoutMs: 12000, label: 'catalyst_intelligence.fetch_pending', maxRetries: 1 }
  );

  return rows;
}

async function fetchFmpOwnershipMetrics(symbol) {
  if (!FMP_API_KEY) {
    return {
      float_size: null,
      short_interest: null,
      institutional_ownership: null,
    };
  }

  try {
    const payload = await fmpFetch('/profile', { symbol });
    const row = Array.isArray(payload) ? payload[0] : null;

    return {
      float_size: normalizeNumber(row?.floatShares ?? row?.sharesOutstanding),
      short_interest: normalizeNumber(row?.shortPercentFloat ?? row?.shortFloat),
      institutional_ownership: normalizeNumber(row?.institutionalOwnership ?? row?.heldPercentInstitutions),
    };
  } catch (_error) {
    return {
      float_size: null,
      short_interest: null,
      institutional_ownership: null,
    };
  }
}

function computeExpectedMoveAndConfidence(input) {
  const providerCount = Number(input.provider_count || 0);
  const freshnessMinutes = Number(input.freshness_minutes || 0);
  const sentimentScore = Number(input.sentiment_score || 0);
  const shortInterest = Number(input.short_interest || 0);
  const floatSize = Number(input.float_size || 0);
  const sectorTrendValue = Number(input.sector_avg_change || 0);
  const marketTrendValue = Number(input.market_avg_change || 0);
  const historicalMoveAvg = Number(input.historical_move_avg || 0);
  const historicalSuccess = Number(input.success_rate || 0);
  const sampleSize = Number(input.sample_size || 0);

  const freshnessFactor = clamp(1 - (freshnessMinutes / 240), 0, 1);
  const providerFactor = clamp(providerCount / 5, 0, 1);
  const sentimentFactor = clamp((sentimentScore + 1) / 2, 0, 1);
  const trendFactor = clamp(((sectorTrendValue + marketTrendValue) / 4) + 0.5, 0, 1);
  const shortInterestFactor = clamp(shortInterest / 35, 0, 1);
  const floatFactor = floatSize > 0 ? clamp(1 - (Math.log10(floatSize + 1) / 10), 0, 1) : 0.5;
  const precedentFactor = sampleSize > 0
    ? clamp((Math.abs(historicalMoveAvg) * 2) + (historicalSuccess * 0.5), 0, 1)
    : 0.4;

  const confidenceScore = clamp(
    (providerFactor * 0.2)
    + (freshnessFactor * 0.2)
    + (sentimentFactor * 0.15)
    + (trendFactor * 0.15)
    + (precedentFactor * 0.2)
    + (shortInterestFactor * 0.05)
    + (floatFactor * 0.05),
    0,
    1
  );

  const baseExpectedMove = clamp(
    (Math.abs(sentimentScore) * 0.7)
    + (providerCount * 0.35)
    + (precedentFactor * 1.2)
    + (shortInterestFactor * 0.8)
    + (floatFactor * 0.6),
    0.3,
    12
  );

  const low = Number((baseExpectedMove * 0.7).toFixed(3));
  const high = Number((baseExpectedMove * (1.1 + (confidenceScore * 0.5))).toFixed(3));

  return {
    expected_move_low: low,
    expected_move_high: high,
    confidence_score: Number(confidenceScore.toFixed(4)),
  };
}

async function insertCatalystIntelligence(row) {
  await queryWithTimeout(
    `INSERT INTO catalyst_intelligence (
       news_id,
       symbol,
       catalyst_type,
       sector,
       sector_trend,
       market_trend,
       float_size,
       short_interest,
       institutional_ownership,
       provider_count,
       freshness_minutes,
       sentiment_score,
       expected_move_low,
       expected_move_high,
       confidence_score,
       created_at,
       narrative
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9,
       $10, $11, $12, $13, $14, $15, NOW(), NULL
     )
     ON CONFLICT (news_id) WHERE news_id IS NOT NULL DO UPDATE SET
       symbol = EXCLUDED.symbol,
       catalyst_type = EXCLUDED.catalyst_type,
       sector = EXCLUDED.sector,
       sector_trend = EXCLUDED.sector_trend,
       market_trend = EXCLUDED.market_trend,
       float_size = EXCLUDED.float_size,
       short_interest = EXCLUDED.short_interest,
       institutional_ownership = EXCLUDED.institutional_ownership,
       provider_count = EXCLUDED.provider_count,
       freshness_minutes = EXCLUDED.freshness_minutes,
       sentiment_score = EXCLUDED.sentiment_score,
       expected_move_low = EXCLUDED.expected_move_low,
       expected_move_high = EXCLUDED.expected_move_high,
       confidence_score = EXCLUDED.confidence_score,
       created_at = NOW()`,
    [
      row.news_id,
      row.symbol,
      row.catalyst_type,
      row.sector,
      row.sector_trend,
      row.market_trend,
      row.float_size,
      row.short_interest,
      row.institutional_ownership,
      row.provider_count,
      row.freshness_minutes,
      row.sentiment_score,
      row.expected_move_low,
      row.expected_move_high,
      row.confidence_score,
    ],
    { timeoutMs: 8000, label: 'catalyst_intelligence.insert', maxRetries: 0 }
  );
}

async function runCatalystIntelligenceEngine() {
  try {
    const rows = await fetchPendingCatalystEvents();
    let inserted = 0;

    for (const row of rows) {
      const fmpMetrics = await fetchFmpOwnershipMetrics(row.symbol);
      const sectorTrend = normalizeTrend(row.sector_avg_change);
      const marketTrend = normalizeTrend(row.market_avg_change);

      const floatSize = normalizeNumber(fmpMetrics.float_size) ?? normalizeNumber(row.float_size) ?? 0;
      const shortInterest = normalizeNumber(fmpMetrics.short_interest) ?? normalizeNumber(row.short_interest) ?? 0;
      const institutionalOwnership = normalizeNumber(fmpMetrics.institutional_ownership);

      const expectedMove = computeExpectedMoveAndConfidence({
        ...row,
        float_size: floatSize,
        short_interest: shortInterest,
      });

      await insertCatalystIntelligence({
        news_id: row.news_id,
        symbol: row.symbol,
        catalyst_type: row.catalyst_type,
        sector: row.sector || 'Unknown',
        sector_trend: sectorTrend,
        market_trend: marketTrend,
        float_size: floatSize,
        short_interest: shortInterest,
        institutional_ownership: institutionalOwnership,
        provider_count: row.provider_count,
        freshness_minutes: row.freshness_minutes,
        sentiment_score: row.sentiment_score,
        expected_move_low: expectedMove.expected_move_low,
        expected_move_high: expectedMove.expected_move_high,
        confidence_score: expectedMove.confidence_score,
      });

      inserted += 1;
    }

    const result = {
      scanned: rows.length,
      inserted,
    };
    logger.info('[CATALYST_INTELLIGENCE] completed', result);
    return result;
  } catch (error) {
    logger.error('[CATALYST_INTELLIGENCE] failed', { error: error.message });
    throw error;
  }
}

module.exports = {
  runCatalystIntelligenceEngine,
};
