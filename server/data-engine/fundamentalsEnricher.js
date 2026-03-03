const axios = require('axios');

const fundamentalsCache = new Map();
const FUNDAMENTALS_TTL_MS = 24 * 60 * 60 * 1000;

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

async function fetchProfileBatch(apiKey, symbols) {
  const symbolParam = encodeURIComponent(symbols.join(','));
  const url = `https://financialmodelingprep.com/stable/quote?symbol=${symbolParam}&apikey=${apiKey}`;
  const response = await axios.get(url, { timeout: 30000, validateStatus: () => true });
  if (response.status === 429) throw new Error('Fundamentals rate limited (429)');
  if (response.status < 200 || response.status >= 300) return [];
  return Array.isArray(response.data) ? response.data : [];
}

function mapToFundamentals(row) {
  return {
    pe: null,
    forwardPe: null,
    peg: null,
    priceToSales: null,
    priceToBook: null,
    evToEbitda: null,
    roe: null,
    roa: null,
    grossMargin: null,
    operatingMargin: null,
    netMargin: null,
    debtToEquity: null,
    insiderOwnershipPercent: null,
    institutionalOwnershipPercent: null,
    dividendYield: null,
    salesGrowth: null,
    epsGrowth: null,
    marketCap: Number.isFinite(Number(row.marketCap)) ? Number(row.marketCap) : null,
  };
}

async function enrichFundamentals(universe, apiKey, logger = console) {
  const symbols = universe.map((r) => r.symbol).filter(Boolean);
  const out = new Map();

  const now = Date.now();
  const missing = [];
  for (const symbol of symbols) {
    const cached = fundamentalsCache.get(symbol);
    if (cached && now - cached.ts < FUNDAMENTALS_TTL_MS) {
      out.set(symbol, cached.data);
    } else {
      missing.push(symbol);
    }
  }

  const groups = chunk(missing, 50);
  for (const g of groups) {
    try {
      const rows = await fetchProfileBatch(apiKey, g);
      rows.forEach((row) => {
        const symbol = String(row.symbol || '').toUpperCase();
        if (!symbol) return;
        const data = mapToFundamentals(row);
        fundamentalsCache.set(symbol, { ts: Date.now(), data });
        out.set(symbol, data);
      });

      g.forEach((symbol) => {
        if (!out.has(symbol)) {
          const data = mapToFundamentals({});
          fundamentalsCache.set(symbol, { ts: Date.now(), data });
          out.set(symbol, data);
        }
      });
    } catch (err) {
      logger.warn('Fundamentals batch failed', { size: g.length, error: err.message });
    }
  }

  logger.info('Fundamentals enricher complete', { symbols: out.size });
  return out;
}

module.exports = {
  enrichFundamentals,
};
