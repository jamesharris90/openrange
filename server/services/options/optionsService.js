const provider = require('./index');
const expectedMoveService = require('../expectedMoveService');

const MAX_SYMBOLS_PER_MINUTE = 10;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function getCachedExpectedMove(symbol) {
  return expectedMoveService.getLatestCacheBySymbol(symbol);
}

function getLatestCacheBySymbol(symbol) {
  return expectedMoveService.getLatestCacheBySymbol(symbol);
}

async function getExpectedMove(symbol, earningsDate) {
  const safeSymbol = normalizeSymbol(symbol);
  if (!safeSymbol) {
    return { data: null, reason: 'invalid_symbol' };
  }

  const isoDate = earningsDate ? new Date(earningsDate).toISOString() : null;
  const result = await expectedMoveService.getExpectedMove(safeSymbol, isoDate, 'research');

  if (!result?.data) {
    return { data: null, source: result?.source || 'provider', reason: result?.reason || 'unavailable' };
  }

  return {
    data: {
      symbol: result.data.symbol,
      atmIV: result.data.iv,
      expectedMovePct: result.data.impliedMovePct,
      expectedMoveDollar: result.data.impliedMoveDollar,
      expiration: result.data.expiration,
      daysToExpiry: result.data.daysToExpiry,
      strike: result.data.strike,
      fetchedAt: result.data.fetchedAt,
    },
    source: result.source,
    reason: result.reason || null,
  };
}

async function getATMContract(symbol) {
  const safeSymbol = normalizeSymbol(symbol);
  if (!safeSymbol) return null;
  return provider.getATMContract(safeSymbol);
}

async function processSymbolsInBatches(items = [], worker) {
  const list = Array.isArray(items) ? items : [];
  const runWorker = typeof worker === 'function' ? worker : async () => null;

  const results = [];
  for (let i = 0; i < list.length; i += MAX_SYMBOLS_PER_MINUTE) {
    const chunk = list.slice(i, i + MAX_SYMBOLS_PER_MINUTE);
    const chunkResults = await Promise.all(chunk.map((item) => runWorker(item)));
    results.push(...chunkResults);

    const hasMore = i + MAX_SYMBOLS_PER_MINUTE < list.length;
    if (hasMore) {
      await delay(60 * 1000);
    }
  }

  return results;
}

module.exports = {
  getExpectedMove,
  getATMContract,
  getCachedExpectedMove,
  getLatestCacheBySymbol,
  processSymbolsInBatches,
};