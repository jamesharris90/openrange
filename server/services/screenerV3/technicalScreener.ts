// @ts-nocheck
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { getDailyMetricsMap } = require(path.join(__dirname, '..', 'dailyMetricsCache.ts'));

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

const getEnrichedUniverse = loadNamedExportTs(path.join(__dirname, '..', 'marketDataEngineV1.ts'), 'getEnrichedUniverse');
const getStocksByBuckets = loadNamedExportTs(path.join(__dirname, '..', 'directoryServiceV1.ts'), 'getStocksByBuckets');

function toFinite(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toPositiveOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function mergeWithDailyMetrics(row, dailyMetricsMap) {
  const symbol = String(row?.symbol || '').trim().toUpperCase();
  const daily = dailyMetricsMap.get(symbol) || null;

  const volume = toPositiveOrNull(row?.volume);
  const avgVolume = toPositiveOrNull(daily?.avgVolume);
  const relativeVolume = Number.isFinite(volume) && Number.isFinite(avgVolume) && avgVolume > 0
    ? volume / avgVolume
    : null;

  return {
    ...row,
    avgVolume,
    atr: toPositiveOrNull(daily?.atr),
    atrPercent: toPositiveOrNull(daily?.atrPercent),
    rsi14: toFinite(daily?.rsi14),
    sma20: toPositiveOrNull(daily?.sma20),
    sma50: toPositiveOrNull(daily?.sma50),
    sma200: toPositiveOrNull(daily?.sma200),
    high52Week: toPositiveOrNull(daily?.high52Week),
    low52Week: toPositiveOrNull(daily?.low52Week),
    pe: toFinite(daily?.pe),
    forwardPE: toFinite(daily?.forwardPE),
    forwardPe: toFinite(daily?.forwardPE),
    peg: toFinite(daily?.peg),
    priceToSales: toFinite(daily?.priceToSales),
    ps: toFinite(daily?.priceToSales),
    priceToBook: toFinite(daily?.priceToBook),
    pb: toFinite(daily?.priceToBook),
    roe: toFinite(daily?.roe),
    roa: toFinite(daily?.roa),
    roic: toFinite(daily?.roic),
    grossMargin: toFinite(daily?.grossMargin),
    operatingMargin: toFinite(daily?.operatingMargin),
    netProfitMargin: toFinite(daily?.netProfitMargin),
    netMargin: toFinite(daily?.netProfitMargin),
    revenueGrowth: toFinite(daily?.revenueGrowth),
    epsGrowth: toFinite(daily?.epsGrowth),
    insiderOwnership: toFinite(daily?.insiderOwnership),
    institutionalOwnership: toFinite(daily?.institutionalOwnership),
    relativeVolume,
    rvol: relativeVolume,
  };
}

function includeByExchange(exchange, filters) {
  if (!filters.exchange || !filters.exchange.length) return true;
  return filters.exchange.includes(exchange);
}

function includeByRange(value, min, max) {
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
}

function applyFilters(rows, filters) {
  return rows.filter((row) => {
    if (!includeByExchange(row.exchange, filters)) return false;

    if (!includeByRange(row.price, filters.priceMin, filters.priceMax)) return false;
    if (!includeByRange(row.marketCap, filters.marketCapMin, filters.marketCapMax)) return false;
    if (!includeByRange(row.rvol, filters.rvolMin, filters.rvolMax)) return false;
    if (filters.volumeMin != null && row.volume < filters.volumeMin) return false;
    if (!includeByRange(row.gapPercent, filters.gapMin, filters.gapMax)) return false;

    return true;
  });
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    if (b.rvol !== a.rvol) return b.rvol - a.rvol;
    if (b.volume !== a.volume) return b.volume - a.volume;
    return b.changePercent - a.changePercent;
  });
}

async function runTechnicalScreener(filters = {}) {
  const selectedBuckets = Array.isArray(filters.buckets) && filters.buckets.length
    ? filters.buckets
    : ['common'];

  const bucketStocks = await getStocksByBuckets(selectedBuckets);
  const allowedSymbols = new Set(
    bucketStocks
      .map((item) => String(item?.symbol || '').trim().toUpperCase())
      .filter(Boolean)
  );

  const canonicalUniverse = await getEnrichedUniverse();
  const dailyMetricsMap = getDailyMetricsMap();

  const universe = canonicalUniverse
    .filter((item) => allowedSymbols.has(String(item?.symbol || '').trim().toUpperCase()))
    .map((item) => mergeWithDailyMetrics(item, dailyMetricsMap));

  const symbolSearch = String(filters.symbolSearch || '').trim().toUpperCase();
  const scopedUniverse = symbolSearch
    ? universe.filter((item) => String(item?.symbol || '').toUpperCase().includes(symbolSearch))
    : universe;
  const filtered = applyFilters(scopedUniverse, filters);
  const sorted = sortRows(filtered);

  console.log('[screenerV3/technical] completed', {
    universeCount: universe.length,
    filteredCount: filtered.length,
    resultCount: sorted.length,
  });

  return sorted;
}

module.exports = {
  runTechnicalScreener,
};
