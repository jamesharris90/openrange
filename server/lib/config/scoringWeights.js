/**
 * Scoring Weights Configuration — Market-Adjusted Expected Move Engine
 * 
 * Each category has a max score. Total composite = 100.
 * Adjust weights here to rebalance the scoring model.
 * 
 * Certainty Tiers:
 *   80-100  → High Expansion Probability
 *   60-79   → Conditional / Tradeable
 *   40-59   → Low Edge
 *    0-39   → Avoid
 */

module.exports = {
  // Category max scores — must sum to 100
  categories: {
    liquidity:    { max: 15, label: 'Liquidity' },
    volatility:   { max: 20, label: 'Volatility Context' },
    catalyst:     { max: 25, label: 'Catalyst Strength' },
    marketRegime: { max: 15, label: 'Market Regime' },
    sector:       { max: 10, label: 'Sector & Relative Strength' },
    technical:    { max: 10, label: 'Technical Alignment' },
    historical:   { max:  5, label: 'Historical Behaviour' },
  },

  // Certainty tier thresholds
  tiers: [
    { min: 80, label: 'High Expansion Probability', tier: 'high',        color: '#22c55e' },
    { min: 60, label: 'Conditional / Tradeable',     tier: 'conditional', color: '#f59e0b' },
    { min: 40, label: 'Low Edge',                    tier: 'low',         color: '#ef4444' },
    { min:  0, label: 'Avoid',                       tier: 'avoid',       color: '#6b7280' },
  ],

  // Liquidity thresholds
  liquidity: {
    oi: { excellent: 5000, good: 1000, fair: 500 },
    bidAskSpread: { tight: 0.05, moderate: 0.15, wide: 0.30 },
    volumeOiRatio: { active: 0.5, moderate: 0.2 },
    marketCap: { large: 10e9, mid: 2e9, small: 500e6 },
  },

  // Volatility thresholds
  volatility: {
    ivRank: { high: 70, elevated: 50, normal: 30 },
    ivHvSpread: { significant: 0.15, moderate: 0.05 },
    earningsCrush: { daysThreshold: 7 },
  },

  // Catalyst thresholds
  catalyst: {
    earningsProximity: { imminent: 3, near: 7, approaching: 14 },
    newsFreshness: { breaking: 30, veryFresh: 60, fresh: 360 },  // minutes
    volumeSpike: { extreme: 3.0, elevated: 1.5 },  // vs 20-day avg
  },

  // Market regime thresholds
  marketRegime: {
    vix: { panic: 30, elevated: 20, cautious: 16, calm: 12 },
    trendStrength: { strong: 3, moderate: 2 },  // count of MAs above
  },

  // Sector thresholds
  sectorMap: {
    'Technology':        'XLK',
    'Financial Services':'XLF',
    'Energy':            'XLE',
    'Healthcare':        'XLV',
    'Consumer Cyclical': 'XLY',
    'Consumer Defensive':'XLP',
    'Industrials':       'XLI',
    'Real Estate':       'XLRE',
    'Utilities':         'XLU',
    'Basic Materials':   'XLB',
    'Communication Services': 'XLC',
  },
};
