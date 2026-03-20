function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '../../logs/trade-outcomes.json');
const OUT = path.join(__dirname, '../../logs/trade-quality.json');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function gradeFromScore(score) {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}

function confidenceFromScore(score) {
  if (score >= 90) return 'Very High';
  if (score >= 80) return 'High';
  if (score >= 70) return 'Moderate';
  return 'Low';
}

function calculateTradeScore(stock = {}) {
  const rvol = toNumber(stock.relative_volume ?? stock.rvol);
  const volume = toNumber(stock.volume);
  const price = toNumber(stock.price);
  const floatShares = toNumber(stock.float_shares);
  const hasNews = Boolean(stock.catalyst_headline || stock.news?.headline);
  const trendAligned = Boolean(stock.trendAligned ?? stock.marketTrendAligned ?? stock.price_change_percent >= 0);

  const strategyWinRate = toNumber(stock.strategyStats?.winRate ?? stock.strategyStats?.win_rate, 55);
  const setupReliability = clamp((strategyWinRate / 100) * 20, 0, 20);
  const rvolScore = clamp((rvol / 6) * 30, 0, 30);
  const newsScore = hasNews ? 18 : 6;
  const trendScore = trendAligned ? 16 : 8;

  const dollarLiquidity = volume * price;
  const liquidityScore = clamp((dollarLiquidity / 25000000) * 10, 0, 10);
  const floatScore = floatShares > 0
    ? clamp((1 - Math.min(floatShares, 300000000) / 300000000) * 16, 4, 16)
    : 8;

  const total = clamp(rvolScore + newsScore + setupReliability + trendScore + liquidityScore + floatScore, 0, 100);
  const score = Math.round(total);

  return {
    score,
    grade: gradeFromScore(score),
    confidence: confidenceFromScore(score),
  };
}

function runTQI() {
  if (!fs.existsSync(FILE)) return;

  const trades = JSON.parse(fs.readFileSync(FILE));

  const buckets = {
    high: [],
    medium: [],
    low: []
  };

  trades.forEach((t) => {
    if (t.outcome === 'pending') return;

    if (t.confidence >= 80) buckets.high.push(t);
    else if (t.confidence >= 60) buckets.medium.push(t);
    else buckets.low.push(t);
  });

  function stats(arr) {
    if (!arr.length) return { winRate: 0, count: 0 };

    const wins = arr.filter((t) => t.outcome === 'win').length;

    return {
      winRate: (wins / arr.length) * 100,
      count: arr.length
    };
  }

  const result = {
    high: stats(buckets.high),
    medium: stats(buckets.medium),
    low: stats(buckets.low),
    timestamp: new Date().toISOString()
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
}

module.exports = {
  calculateTradeScore,
  runTQI,
};
