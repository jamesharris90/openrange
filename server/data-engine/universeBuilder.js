const axios = require('axios');

const EXCHANGES = ['NASDAQ', 'NYSE', 'AMEX'];
const PAGE_LIMIT = 1000;
const MAX_PAGES = 25;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, attempts = 5, baseDelay = 400) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await axios.get(url, { timeout: 30000, validateStatus: () => true });
      if (response.status === 429) {
        await sleep(baseDelay * 2 ** i);
        continue;
      }
      if (response.status >= 200 && response.status < 300) return response.data;
      throw new Error(`FMP request failed (${response.status})`);
    } catch (err) {
      lastError = err;
      await sleep(baseDelay * 2 ** i);
    }
  }
  throw lastError || new Error('FMP request failed after retries');
}

function isLikelySpac(name = '') {
  const n = String(name).toLowerCase();
  return n.includes('acquisition corp') || n.includes('blank check') || n.includes('spac');
}

function hasBlockedSuffix(symbol = '') {
  const s = String(symbol).toUpperCase();
  return s.endsWith('W') || s.endsWith('U') || s.endsWith('R') || s.includes('-P');
}

function normalizeRow(row) {
  return {
    symbol: String(row.symbol || '').toUpperCase(),
    companyName: row.companyName || row.name || '',
    exchange: String(row.exchangeShortName || row.exchange || '').toUpperCase(),
    sector: row.sector || null,
    industry: row.industry || null,
    marketCap: Number.isFinite(Number(row.marketCap)) ? Number(row.marketCap) : null,
    sharesOutstanding: Number.isFinite(Number(row.sharesOutstanding)) ? Number(row.sharesOutstanding) : null,
    float: Number.isFinite(Number(row.floatShares || row.float)) ? Number(row.floatShares || row.float) : null,
    country: row.country || null,
    assetType: String(row.type || 'stock').toLowerCase(),
    isEtf: Boolean(row.isEtf),
    isFund: Boolean(row.isFund),
  };
}

async function fetchExchangePage(apiKey, exchange, page) {
  const params = new URLSearchParams({
    exchange,
    limit: String(PAGE_LIMIT),
    page: String(page),
    apikey: apiKey,
  });
  const url = `https://financialmodelingprep.com/stable/company-screener?${params.toString()}`;
  return fetchWithRetry(url);
}

async function fetchBaseStockUniverse(apiKey, logger = console) {
  const rawRows = [];

  for (const exchange of EXCHANGES) {
    let previousFirst = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const rows = await fetchExchangePage(apiKey, exchange, page);
      if (!Array.isArray(rows) || rows.length === 0) break;

      const firstSymbol = rows[0]?.symbol || null;
      if (firstSymbol && firstSymbol === previousFirst) break;
      previousFirst = firstSymbol;

      rawRows.push(...rows);
      if (rows.length < PAGE_LIMIT) break;
      await sleep(200);
    }
  }

  const seen = new Set();
  const clean = [];
  for (const raw of rawRows) {
    const row = normalizeRow(raw);
    if (!row.symbol) continue;
    if (seen.has(row.symbol)) continue;

    const isCommon = row.assetType === 'stock';
    const inExchange = EXCHANGES.includes(row.exchange);
    const notEtf = !row.isEtf && !row.isFund;
    const notSpac = !isLikelySpac(row.companyName);
    const notWarrant = !hasBlockedSuffix(row.symbol);

    if (isCommon && inExchange && notEtf && notSpac && notWarrant) {
      seen.add(row.symbol);
      clean.push(row);
    }
  }

  logger.info('Universe builder complete', {
    rawRows: rawRows.length,
    cleanRows: clean.length,
  });

  return clean;
}

module.exports = {
  fetchWithRetry,
  fetchBaseStockUniverse,
  normalizeRow,
  hasBlockedSuffix,
};
