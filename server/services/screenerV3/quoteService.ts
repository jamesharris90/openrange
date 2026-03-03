const axios = require('axios');

const BATCH_QUOTE_URL = 'https://financialmodelingprep.com/stable/batch-quote';
const QUOTE_CACHE_TTL_MS = 30_000;
const CHUNK_SIZE = 200;
const REQUEST_TIMEOUT_MS = 30_000;

let quoteCache = new Map();
let quoteCacheTimeMs = 0;

function chunk(arr, size) {
  const out = [];
  for (let index = 0; index < arr.length; index += size) {
    out.push(arr.slice(index, index + size));
  }
  return out;
}

function toSymbolSet(symbols) {
  return Array.from(
    new Set(
      (Array.isArray(symbols) ? symbols : [])
        .map((symbol) => String(symbol || '').trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

function getCacheSubset(symbols) {
  const subset = new Map();
  for (const symbol of symbols) {
    const cached = quoteCache.get(symbol);
    if (cached) subset.set(symbol, cached);
  }
  return subset;
}

function hasFreshCache() {
  return Date.now() - quoteCacheTimeMs < QUOTE_CACHE_TTL_MS;
}

async function getBatchQuotes(symbols) {
  const cleanSymbols = toSymbolSet(symbols);
  if (!cleanSymbols.length) return new Map();

  if (hasFreshCache()) {
    const cached = getCacheSubset(cleanSymbols);
    if (cached.size === cleanSymbols.length) {
      return cached;
    }
  }

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    console.warn('[screenerV3/quoteService] FMP_API_KEY missing; returning cache subset only');
    return getCacheSubset(cleanSymbols);
  }

  const quoteMap = new Map<string, BatchQuote>();
  const symbolChunks = chunk(cleanSymbols, CHUNK_SIZE);

  console.log('[screenerV3/quoteService] quote batch fetch start', {
    symbolCount: cleanSymbols.length,
    chunkSize: CHUNK_SIZE,
    chunkCount: symbolChunks.length,
  });

  for (let index = 0; index < symbolChunks.length; index += 1) {
    const chunkSymbols = symbolChunks[index];
    try {
      const response = await axios.get(BATCH_QUOTE_URL, {
        params: {
          symbols: chunkSymbols.join(','),
          apikey: apiKey,
        },
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: () => true,
      });

      if (response.status < 200 || response.status >= 300) {
        console.warn('[screenerV3/quoteService] chunk failed', {
          index,
          status: response.status,
          chunkSymbols: chunkSymbols.length,
        });
        continue;
      }

      const rows = Array.isArray(response.data) ? response.data : [];
      rows.forEach((row) => {
        const symbol = String(row?.symbol || '').trim().toUpperCase();
        if (!symbol) return;
        quoteMap.set(symbol, row);
      });
    } catch (error) {
      console.warn('[screenerV3/quoteService] chunk request error', {
        index,
        chunkSymbols: chunkSymbols.length,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (quoteMap.size > 0) {
    quoteCache = quoteMap;
    quoteCacheTimeMs = Date.now();
    return getCacheSubset(cleanSymbols);
  }

  console.warn('[screenerV3/quoteService] all chunks failed; serving cache subset');
  return getCacheSubset(cleanSymbols);
}

module.exports = {
  getBatchQuotes,
};
