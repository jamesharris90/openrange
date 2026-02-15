const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const cache = require('../utils/cache');
const { withRetry } = require('../utils/retry');

const QUOTE_TTL = 30 * 1000;
const HIST_TTL = 5 * 60 * 1000;

function mapQuote(q) {
  if (!q) return null;
  const avgVol = q.averageDailyVolume10Day || q.averageDailyVolume3Month || null;
  return {
    symbol: q.symbol,
    shortName: q.shortName || '',
    price: q.regularMarketPrice ?? null,
    change: q.regularMarketChange != null ? +Number(q.regularMarketChange).toFixed(2) : null,
    changePercent: q.regularMarketChangePercent != null ? +Number(q.regularMarketChangePercent).toFixed(2) : null,
    marketCap: q.marketCap ?? null,
    avgVolume: avgVol,
    volume: q.regularMarketVolume ?? null,
    rvol: avgVol && q.regularMarketVolume ? +(q.regularMarketVolume / avgVol).toFixed(2) : null,
    preMarketPrice: q.preMarketPrice ?? null,
    preMarketChange: q.preMarketChange != null ? +Number(q.preMarketChange).toFixed(2) : null,
    preMarketChangePercent: q.preMarketChangePercent != null ? +Number(q.preMarketChangePercent).toFixed(2) : null,
    fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? null,
    twoHundredDayAverage: q.twoHundredDayAverage ?? null,
    floatShares: q.floatShares ?? null,
    sharesShort: q.sharesShort ?? null,
    shortPercentOfFloat: q.shortPercentOfFloat != null ? +(q.shortPercentOfFloat * 100).toFixed(2) : null,
  };
}

async function getQuotes(symbols = []) {
  const list = Array.isArray(symbols) ? symbols : String(symbols).split(',');
  const results = [];
  for (const sym of list) {
    const key = `yq:${sym}`;
    const cached = cache.get(key);
    if (cached) { results.push(cached); continue; }
    const quote = await withRetry(() => yahooFinance.quote(sym));
    const mapped = mapQuote(quote);
    if (mapped) cache.set(key, mapped, QUOTE_TTL);
    if (mapped) results.push(mapped);
  }
  return results;
}

async function getHistorical(symbol, { interval = '1d', range = '1mo' } = {}) {
  const key = `yh:${symbol}:${interval}:${range}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const hist = await withRetry(() => yahooFinance.chart(symbol, { period1: undefined, period2: undefined, interval, range }));
  cache.set(key, hist, HIST_TTL);
  return hist;
}

module.exports = {
  name: 'yahoo',
  getQuotes,
  getHistorical,
};
