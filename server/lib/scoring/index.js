/**
 * Composite Score Aggregator — Market-Adjusted Expected Move Engine
 * 
 * Orchestrates all 7 scoring modules and produces the final composite
 * confidence score (0–100) with full category breakdowns.
 */

const weights = require('../config/scoringWeights');
const liquidityScore = require('./liquidityScore');
const volatilityScore = require('./volatilityScore');
const catalystScore = require('./catalystScore');
const marketRegimeScore = require('./marketRegimeScore');
const sectorScore = require('./sectorScore');
const technicalScore = require('./technicalScore');
const historicalScore = require('./historicalScore');

/**
 * Compute composite confidence score from all data sources.
 * 
 * @param {Object} data  All enriched data for a ticker
 * @returns {Object}     { composite, tier, categories, breakdown }
 */
function computeComposite(data) {
  const results = {
    liquidity:    liquidityScore.score(data),
    volatility:   volatilityScore.score(data),
    catalyst:     catalystScore.score(data),
    marketRegime: marketRegimeScore.score(data),
    sector:       sectorScore.score(data),
    technical:    technicalScore.score(data),
    historical:   historicalScore.score(data),
  };

  // Sum composite
  const composite = Object.values(results).reduce((sum, r) => sum + r.score, 0);
  const clamped = Math.min(100, Math.max(0, composite));

  // Determine tier
  const tier = weights.tiers.find(t => clamped >= t.min) || weights.tiers[weights.tiers.length - 1];

  // Build category summary
  const categories = {};
  for (const [key, result] of Object.entries(results)) {
    categories[key] = {
      label: weights.categories[key].label,
      score: result.score,
      max: result.max,
      pct: result.max > 0 ? Math.round((result.score / result.max) * 100) : 0,
      breakdown: result.breakdown,
    };
  }

  return {
    composite: clamped,
    tier: {
      label: tier.label,
      tier: tier.tier,
      color: tier.color,
    },
    categories,
    weights: Object.fromEntries(
      Object.entries(weights.categories).map(([k, v]) => [k, { label: v.label, max: v.max }])
    ),
  };
}

module.exports = { computeComposite };
