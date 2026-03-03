const CATALYST_KEYWORDS = {
  earnings: ['earnings', 'q1', 'q2', 'q3', 'q4', 'quarterly', 'revenue', 'eps'],
  fda: ['fda', 'approval', 'clinical trial', 'phase', 'drug'],
  product: ['launches', 'unveils', 'introduces', 'new product', 'release'],
  merger: ['merger', 'acquisition', 'acquires', 'buys', 'takes over', 'm&a'],
  contract: ['wins contract', 'awarded', 'deal', 'partnership', 'agreement'],
  upgrade: ['upgrade', 'rating', 'initiated', 'target', 'buy', 'sell', 'downgrade'],
  offering: ['offering', 'ipo', 'secondary', 'raises', 'funding'],
  guidance: ['guidance', 'outlook', 'forecast', 'expects'],
};

export function parseTickers(value = '') {
  return value
    .split(/[\s,]+/)
    .map(t => t.trim().toUpperCase())
    .filter(Boolean);
}

export function detectCatalysts(title = '') {
  const titleLower = title.toLowerCase();
  const detected = [];
  Object.entries(CATALYST_KEYWORDS).forEach(([key, words]) => {
    if (words.some(w => titleLower.includes(w))) detected.push(key);
  });
  return detected.length ? detected : ['general'];
}

export function parseFinvizDate(dateString = '') {
  const withTz = `${dateString} EST`;
  const date = new Date(withTz);
  if (!Number.isNaN(date.getTime())) return date;
  const parts = dateString.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!parts) return new Date();
  const utc = new Date(Date.UTC(
    Number(parts[1]),
    Number(parts[2]) - 1,
    Number(parts[3]),
    Number(parts[4]),
    Number(parts[5]),
    Number(parts[6])
  ));
  return new Date(utc.getTime() + (5 * 60 * 60 * 1000));
}

export function getTimeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  const intervals = {
    year: 31536000,
    month: 2592000,
    week: 604800,
    day: 86400,
    hour: 3600,
    minute: 60,
  };
  for (const [unit, size] of Object.entries(intervals)) {
    const interval = Math.floor(seconds / size);
    if (interval >= 1) return `${interval} ${unit}${interval === 1 ? '' : 's'} ago`;
  }
  return 'Just now';
}

export function computeStockScore(stock) {
  if (!stock) return 0;
  const price = Number(stock.Price) || 0;
  const change = Number((stock.Change || '').replace('%', '')) || 0;
  const volume = Number(stock.Volume) || 0;
  const relVol = Number(stock['Rel Volume'] || stock['Relative Volume']) || 0;
  const atr = Number(stock.ATR || stock['ATR (14)']) || 0;
  let score = 0;
  score += Math.min(relVol * 10, 25);
  score += Math.min(change + 10, 20);
  score += Math.min((volume / 1_000_000) * 2, 20);
  score += Math.min(atr * 5, 15);
  if (price >= 5 && price <= 150) score += 10;
  return Math.max(0, Math.min(100, score));
}

export function buildBadges(catalysts, score, stock) {
  const badges = [];
  const relVol = Number(stock?.['Rel Volume'] || stock?.['Relative Volume']) || 0;
  const shortFloat = Number(stock?.['Short Float'] || stock?.['Short Float %'] || stock?.['Short Interest']) || 0;
  const daysToCover = Number(stock?.['Short Ratio'] || stock?.['Days to Cover']) || 0;
  if (score >= 75) badges.push({
    label: 'High Expansion Potential', cls: 'badge-expansion',
    desc: 'Score \u226575 \u2014 Strong confluence of volume, momentum, and price action signals',
    strategies: ['Momentum long entry on pullback to VWAP', 'Breakout continuation above pre-market high', 'Call options for leveraged upside if IV is reasonable'],
  });
  if (score >= 60 && relVol >= 2) badges.push({
    label: 'Momentum Continuation', cls: 'badge-momentum',
    desc: 'Score \u226560 with RelVol \u22652x \u2014 Price likely to continue in current direction',
    strategies: ['Trend-following entry with trailing stop', 'Add to position on dip to intraday moving average', 'Debit spread in direction of momentum'],
  });
  if (shortFloat >= 10 || daysToCover >= 3) badges.push({
    label: 'Squeeze Candidate', cls: 'badge-squeeze',
    desc: 'Short Float \u226510% or Days-to-Cover \u22653 \u2014 Potential short squeeze setup',
    strategies: ['Watch for volume spike above resistance for squeeze trigger', 'Call options before breakout for defined-risk squeeze play', 'Tight stop loss below recent support'],
  });
  if (catalysts.includes('earnings')) badges.push({
    label: 'Earnings Play', cls: 'badge-earnings',
    desc: 'Earnings catalyst detected \u2014 Consider straddles, strangles, or directional plays around the event',
    strategies: ['Straddle/strangle if expecting a large move', 'Iron condor if expecting a muted reaction', 'Directional debit spread if you have a thesis'],
  });
  if (catalysts.includes('guidance') || catalysts.includes('upgrade')) badges.push({
    label: 'Reversal Candidate', cls: 'badge-reversal',
    desc: 'Guidance or analyst action detected \u2014 Watch for trend reversal or continuation',
    strategies: ['Wait for confirmation candle before entry', 'Reversal entry at support/resistance level', 'Credit spread against the expected direction if fading'],
  });
  if (catalysts.includes('merger')) badges.push({
    label: 'M&A', cls: 'badge-ma',
    desc: 'Merger or acquisition activity \u2014 Watch for deal premium or spread',
    strategies: ['Merger arb: buy target, short acquirer if stock deal', 'Put spreads if deal may fall through', 'Monitor deal spread for convergence plays'],
  });
  return badges;
}

export function toCsvValue(value) {
  const safe = (value ?? '').toString().replace(/"/g, '""');
  return `"${safe}"`;
}

export { CATALYST_KEYWORDS };
