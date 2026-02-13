/**
 * Trade Suitability Score for Earnings Screener
 * Scores how suitable a stock is for post-earnings trading
 */

export function calcTradeScore(row) {
  let score = 0;

  // +2 if expected move % > 6 (or high historical vol indicator)
  if (row.rvol != null && row.rvol > 3) score += 2;
  else if (row.rvol != null && row.rvol > 2) score += 1;

  // +2 if RVOL > 2
  if (row.changePercent != null && Math.abs(row.changePercent) > 5) score += 2;
  else if (row.changePercent != null && Math.abs(row.changePercent) > 3) score += 1;

  // +1 if float < 50M shares
  if (row.floatShares != null && row.floatShares < 50e6) score += 1;

  // +1 if avg volume > 1M
  if (row.avgVolume != null && row.avgVolume > 1e6) score += 1;

  // +1 if short % of float > 10%
  if (row.shortPercentOfFloat != null && row.shortPercentOfFloat > 10) score += 1;

  // -2 if avg volume < 300k (illiquid)
  if (row.avgVolume != null && row.avgVolume < 300e3) score -= 2;

  // +1 if premarket has significant move
  if (row.preMarketChangePercent != null && Math.abs(row.preMarketChangePercent) > 3) score += 1;

  // +1 if near 52-week high (within 5%)
  if (row.dist52WH != null && row.dist52WH > -5) score += 1;

  return score;
}

export function getScoreColor(score) {
  if (score >= 5) return { bg: 'rgba(16, 185, 129, 0.2)', color: '#10b981' };  // green
  if (score >= 3) return { bg: 'rgba(234, 179, 8, 0.2)', color: '#eab308' };    // yellow
  if (score >= 1) return { bg: 'rgba(148, 163, 184, 0.15)', color: '#94a3b8' }; // grey
  return { bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' };                    // red
}

export function getScoreLabel(score) {
  if (score >= 5) return 'Strong';
  if (score >= 3) return 'Good';
  if (score >= 1) return 'Fair';
  return 'Weak';
}

// Default visible columns (user can toggle)
export const DEFAULT_VISIBLE_COLUMNS = [
  'select', 'score', 'symbol', 'companyName', 'hour', 'epsEstimate', 'epsActual',
  'surprisePercent', 'marketCap', 'price', 'changePercent', 'avgVolume', 'rvol',
  'floatShares', 'shortPercentOfFloat', 'preMarketChangePercent', 'dist52WH', 'watchlist',
];

// All available columns for toggle menu
export const ALL_COLUMN_KEYS = [
  'select', 'score', 'symbol', 'companyName', 'hour', 'epsEstimate', 'epsActual',
  'surprisePercent', 'revenueEstimate', 'revenueActual', 'marketCap', 'price',
  'changePercent', 'avgVolume', 'volume', 'rvol', 'floatShares', 'sharesShort',
  'shortPercentOfFloat', 'preMarketChangePercent', 'dist200MA', 'dist52WH',
  'analystRating', 'watchlist',
];
