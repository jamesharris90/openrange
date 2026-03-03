// @ts-nocheck
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function loadNamedExportTs(filePath, exportName) {
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filePath,
  }).outputText;

  const moduleLike = { exports: {} };
  const exportsLike = moduleLike.exports;
  const fn = new Function('require', 'module', 'exports', '__dirname', '__filename', transpiled);
  fn(require, moduleLike, exportsLike, path.dirname(filePath), filePath);

  const loaded = moduleLike.exports?.[exportName];
  if (typeof loaded !== 'function') {
    throw new Error(`${exportName} not found in ${filePath}`);
  }

  return loaded;
}

function loadGetUniverse() {
  return loadNamedExportTs(path.join(__dirname, '..', 'universeBuilderV3.ts'), 'getUniverse');
}

const getUniverse = loadGetUniverse();
const getBatchQuotes = loadNamedExportTs(path.join(__dirname, 'quoteService.ts'), 'getBatchQuotes');

const NEWS_URL = 'https://financialmodelingprep.com/stable/news/stock-latest';
const NEWS_TIMEOUT_MS = 30_000;

function toFinite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function computeChangePercent(quote, fallbackPrice) {
  const direct = toFinite(quote.changePercentage);
  if (direct != null) return direct;

  const price = toFinite(quote.price) ?? fallbackPrice;
  const previousClose = toFinite(quote.previousClose);
  if (price == null || previousClose == null || previousClose === 0) return 0;
  return ((price - previousClose) / previousClose) * 100;
}

function computeRvol(volume, avgVolume) {
  if (volume == null || avgVolume == null || avgVolume <= 0) return 0;
  return volume / avgVolume;
}

function parsePublishedDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function extractHeadlineSymbols(headline) {
  const matches = String(headline || '').toUpperCase().match(/\b[A-Z]{1,5}\b/g) || [];
  return Array.from(new Set(matches));
}

async function fetchNewsItems() {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return [];

  const response = await axios.get(NEWS_URL, {
    params: { apikey: apiKey },
    timeout: NEWS_TIMEOUT_MS,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    console.warn('[screenerV3/news] news fetch failed', { status: response.status });
    return [];
  }

  return Array.isArray(response.data) ? response.data : [];
}

function includeByNewsFilters(row, universeStock, filters) {
  if (filters.exchanges?.length && !filters.exchanges.includes(universeStock.exchange)) {
    return false;
  }
  if (filters.minMarketCap != null) {
    const marketCap = toFinite(universeStock.marketCap) ?? 0;
    if (marketCap < filters.minMarketCap) return false;
  }
  if (filters.minRvol != null && row.rvol < filters.minRvol) {
    return false;
  }
  return true;
}

async function runNewsScreener(filters = {}) {
  const universe = await getUniverse();
  const universeBySymbol = new Map(
    universe.map((stock) => [stock.symbol, stock])
  );

  const newsItems = await fetchNewsItems();
  const nowMs = Date.now();
  const hoursBack = filters.hoursBack != null ? filters.hoursBack : 24;
  const cutoffMs = nowMs - hoursBack * 60 * 60 * 1000;

  const validatedItems = newsItems
    .map((item) => {
      const explicitSymbol = String(item.symbol || '').trim().toUpperCase();
      const fallbackSymbols = extractHeadlineSymbols(String(item.title || ''));
      const resolvedSymbol = explicitSymbol || fallbackSymbols.find((s) => universeBySymbol.has(s)) || '';
      const publishedMs = parsePublishedDate(item.publishedDate);
      return {
        symbol: resolvedSymbol,
        headline: String(item.title || ''),
        publishedDate: String(item.publishedDate || ''),
        source: String(item.site || 'FMP'),
        publishedMs,
      };
    })
    .filter((item) => item.symbol && universeBySymbol.has(item.symbol))
    .filter((item) => item.publishedMs != null && item.publishedMs >= cutoffMs);

  const uniqueSymbols = Array.from(new Set(validatedItems.map((item) => item.symbol)));
  const quoteMap = await getBatchQuotes(uniqueSymbols);

  const enriched = validatedItems
    .map((item) => {
      const universeStock = universeBySymbol.get(item.symbol);
      if (!universeStock) return null;

      const fallbackQuote = quoteMap.get(item.symbol) || {};
      const price = toFinite(fallbackQuote.price) ?? toFinite(universeStock.price) ?? 0;
      const changePercent = computeChangePercent(fallbackQuote, universeStock.price);
      const volume = toFinite(fallbackQuote.volume) ?? toFinite(universeStock.volume);
      const avgVolume = toFinite(universeStock.avgVolume);
      const rvol = computeRvol(volume, avgVolume);

      const row = {
        symbol: item.symbol,
        headline: item.headline,
        publishedDate: item.publishedDate,
        source: item.source,
        price,
        changePercent,
        rvol,
      };

      if (!includeByNewsFilters(row, universeStock, filters)) return null;
      return row;
    })
    .filter((row) => Boolean(row));

  const sorted = enriched.sort((a, b) => {
    if (b.rvol !== a.rvol) return b.rvol - a.rvol;
    return b.changePercent - a.changePercent;
  });

  console.log('[screenerV3/news] completed', {
    newsCount: newsItems.length,
    validatedCount: validatedItems.length,
    uniqueSymbols: uniqueSymbols.length,
    quoteCount: quoteMap.size,
    resultCount: sorted.length,
  });

  return sorted;
}

module.exports = {
  runNewsScreener,
};
