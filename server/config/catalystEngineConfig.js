const SIGNAL_THRESHOLDS = Object.freeze({
  confidence_threshold: 0.35,
  freshness_threshold_minutes: 180,
  provider_threshold: 1,
});

const SIGNAL_SCORING_WEIGHTS = Object.freeze({
  provider_count: 0.16,
  freshness: 0.16,
  sentiment: 0.17,
  float_size: 0.09,
  short_interest: 0.12,
  sector_trend: 0.1,
  market_trend: 0.1,
  confidence: 0.1,
});

const SIGNAL_TYPES = Object.freeze({
  bullish: 'bullish_catalyst',
  bearish: 'bearish_catalyst',
  watchlist: 'watchlist_catalyst',
});

function clamp(value, min = 0, max = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

module.exports = {
  SIGNAL_THRESHOLDS,
  SIGNAL_SCORING_WEIGHTS,
  SIGNAL_TYPES,
  clamp,
};
