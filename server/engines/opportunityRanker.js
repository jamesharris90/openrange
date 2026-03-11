const { queryWithTimeout } = require('../db/pg');
const logger = require('../logger');

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

async function runOpportunityRanker() {
  const { rows } = await queryWithTimeout(
    `SELECT
       m.symbol,
       COALESCE(m.gap_percent, 0) AS gap_percent,
       COALESCE(m.relative_volume, 0) AS relative_volume,
       COALESCE(ts.score, 0) AS strategy_score,
       COALESCE(tc.score, 0) AS catalyst_score,
       COALESCE(m.sector_strength, 0) AS sector_strength
     FROM market_metrics m
     LEFT JOIN LATERAL (
       SELECT score
       FROM trade_setups s
       WHERE s.symbol = m.symbol
       ORDER BY COALESCE(updated_at, created_at, NOW()) DESC
       LIMIT 1
     ) ts ON TRUE
     LEFT JOIN LATERAL (
       SELECT score
       FROM trade_catalysts c
       WHERE c.symbol = m.symbol
       ORDER BY published_at DESC NULLS LAST
       LIMIT 1
     ) tc ON TRUE
     WHERE m.symbol IS NOT NULL
     LIMIT 500`,
    [],
    { timeoutMs: 3500, label: 'engines.opportunity_ranker.select', maxRetries: 0 }
  );

  const ranked = rows.map((row) => {
    const gapScore = clamp01(toNum(row.gap_percent) / 10);
    const rvolScore = clamp01(toNum(row.relative_volume) / 10);
    const strategyScore = clamp01(toNum(row.strategy_score) / 100);
    const catalystScore = clamp01(toNum(row.catalyst_score) / 100);
    const sectorStrength = clamp01((toNum(row.sector_strength) + 5) / 10);

    const score = Number((
      0.25 * gapScore +
      0.25 * rvolScore +
      0.20 * strategyScore +
      0.15 * catalystScore +
      0.15 * sectorStrength
    ).toFixed(6));

    return {
      symbol: row.symbol,
      score,
      headline: `Opportunity ranker score ${score.toFixed(3)}`,
      source: 'opportunity_ranker',
    };
  }).filter((row) => row.symbol);

  for (const item of ranked.slice(0, 100)) {
    await queryWithTimeout(
      `INSERT INTO opportunity_stream (symbol, event_type, headline, score, source, created_at)
       VALUES ($1, 'ranked_opportunity', $2, $3, $4, NOW())`,
      [item.symbol, item.headline, item.score, item.source],
      { timeoutMs: 1500, label: 'engines.opportunity_ranker.insert', maxRetries: 0 }
    );
  }

  const result = { ranked: ranked.length, generated_at: new Date().toISOString() };
  logger.info('[OPPORTUNITY_RANKER] run complete', result);
  return result;
}

module.exports = {
  runOpportunityRanker,
};
