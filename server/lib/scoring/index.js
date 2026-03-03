/**
 * Composite Score Aggregator — Market-Adjusted Expected Move Engine
 *
 * Orchestrates all 7 scoring modules and produces the final composite
 * confidence score (0–100) with full category breakdowns.
 *
 * Handles missing data by normalizing over available categories only.
 * If fewer than 3 categories have data, returns { composite: null, tier: 'insufficient' }.
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
 * @returns {Object}     { composite, tier, categories, weights, availableCategories }
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

  // Sum only available categories; normalize if some are missing
  const availableEntries = Object.entries(results).filter(([, r]) => r.available !== false);
  const rawSum = availableEntries.reduce((sum, [, r]) => sum + r.score, 0);
  const availableMax = availableEntries.reduce((sum, [, r]) => sum + r.max, 0);

  // If fewer than 3 categories have data, mark as insufficient
  if (availableEntries.length < 3) {
    return {
      composite: null,
      tier: { label: 'Insufficient Data', tier: 'insufficient', color: '#6b7280' },
      categories: buildCategories(results),
      weights: buildWeights(),
      availableCategories: availableEntries.length,
    };
  }

  // Normalize: scale raw sum to 100 based on available max
  const normalized = availableMax > 0 ? Math.round((rawSum / availableMax) * 100) : 0;
  const clamped = Math.min(100, Math.max(0, normalized));

  // Determine tier
  const tier = weights.tiers.find(t => clamped >= t.min) || weights.tiers[weights.tiers.length - 1];

  return {
    composite: clamped,
    tier: { label: tier.label, tier: tier.tier, color: tier.color },
    categories: buildCategories(results),
    weights: buildWeights(),
    availableCategories: availableEntries.length,
  };
}

function buildCategories(results) {
  const categories = {};
  for (const [key, result] of Object.entries(results)) {
    categories[key] = {
      label: weights.categories[key].label,
      score: result.score,
      max: result.max,
      pct: result.max > 0 ? Math.round((result.score / result.max) * 100) : 0,
      breakdown: result.breakdown,
      available: result.available !== false,
    };
  }
  return categories;
}

function buildWeights() {
  return Object.fromEntries(
    Object.entries(weights.categories).map(([k, v]) => [k, { label: v.label, max: v.max }])
  );
}

module.exports = { computeComposite };
