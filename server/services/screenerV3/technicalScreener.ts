// @ts-nocheck
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { getDailyMetricsMap } = require(path.join(__dirname, '..', 'dailyMetricsCache.ts'));
const { getQuote } = require(path.join(__dirname, '..', 'liveQuotesCache.js'));
const { classifyRow } = require(path.join(__dirname, '..', '..', 'data-engine', 'structureClassifier.js'));

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

/**
 * Merge a universe row with:
 *  1. Daily metrics (RSI, ATR, SMA, fundamentals) from the 12h cache
 *  2. Live quote data (price, changePercent, gapPercent) refreshed every 3 min
 *  3. Structure classification (deterministic, runs inline)
 */
function mergeRow(row, dailyMetricsMap) {
  const symbol = String(row?.symbol || '').trim().toUpperCase();
  const daily  = dailyMetricsMap.get(symbol) || null;
  const live   = getQuote(symbol) || {};

  // --- Price / volume ---
  const price   = toFinite(live.price   ?? row.price);
  const volume  = toPositiveOrNull(live.volume  ?? row.volume);
  const dayHigh = toFinite(live.dayHigh  ?? row.dayHigh);
  const dayLow  = toFinite(live.dayLow   ?? row.dayLow);
  const open    = toFinite(live.open     ?? row.open);
  const prevClose = toFinite(live.previousClose ?? row.previousClose);

  // --- Change / gap ---
  const changePercent  = toFinite(live.changePercent ?? row.changePercent ?? row.changesPercentage);
  const change         = toFinite(live.change ?? row.change);
  const gapPercent     = toFinite(live.gapPercent ?? row.gapPercent);

  // --- Volume averages ---
  const avgVolume = toPositiveOrNull(daily?.avgVolume ?? live.avgVolume ?? row.avgVolume);

  // --- Relative volume: compute if we have both; fall back to directory value ---
  const relativeVolume = (volume != null && avgVolume != null && avgVolume > 0)
    ? volume / avgVolume
    : toFinite(row.relativeVolume ?? row.rvol);

  // --- Dollar volume ---
  const dollarVolume = (price != null && volume != null) ? price * volume : null;

  // --- Intraday derived ---
  const intradayMoveFromOpenPercent = (price != null && open != null && open > 0)
    ? ((price - open) / open) * 100
    : null;
  const intradayMoveFromHighPercent = (price != null && dayHigh != null && dayHigh > 0)
    ? ((price - dayHigh) / dayHigh) * 100
    : null;
  const intradayMoveFromLowPercent = (price != null && dayLow != null && dayLow > 0)
    ? ((price - dayLow) / dayLow) * 100
    : null;
  const aboveVwap = (price != null && row.vwap != null) ? price > Number(row.vwap) : null;
  const vwapDistancePercent = (price != null && row.vwap != null && Number(row.vwap) > 0)
    ? ((price - Number(row.vwap)) / Number(row.vwap)) * 100
    : null;

  const merged = {
    ...row,

    // Live overrides
    price,
    volume,
    dayHigh,
    dayLow,
    open,
    previousClose: prevClose,
    change,
    changePercent,
    changesPercentage: changePercent,
    gapPercent,
    avgVolume,
    relativeVolume,
    rvol: relativeVolume,
    dollarVolume,

    // Intraday derived
    intradayMoveFromOpenPercent,
    intradayMoveFromHighPercent,
    intradayMoveFromLowPercent,
    aboveVwap,
    vwapDistancePercent,

    // Daily metrics (RSI, ATR, SMA, fundamentals)
    atr:               toPositiveOrNull(daily?.atr),
    atrPercent:        toPositiveOrNull(daily?.atrPercent),
    rsi14:             toFinite(daily?.rsi14),
    sma20:             toPositiveOrNull(daily?.sma20),
    sma50:             toPositiveOrNull(daily?.sma50),
    sma200:            toPositiveOrNull(daily?.sma200),
    high52Week:        toPositiveOrNull(daily?.high52Week),
    low52Week:         toPositiveOrNull(daily?.low52Week),
    pe:                toFinite(daily?.pe),
    forwardPE:         toFinite(daily?.forwardPE),
    forwardPe:         toFinite(daily?.forwardPE),
    peg:               toFinite(daily?.peg),
    priceToSales:      toFinite(daily?.priceToSales),
    ps:                toFinite(daily?.priceToSales),
    priceToBook:       toFinite(daily?.priceToBook),
    pb:                toFinite(daily?.priceToBook),
    roe:               toFinite(daily?.roe),
    roa:               toFinite(daily?.roa),
    roic:              toFinite(daily?.roic),
    grossMargin:       toFinite(daily?.grossMargin),
    operatingMargin:   toFinite(daily?.operatingMargin),
    netProfitMargin:   toFinite(daily?.netProfitMargin),
    netMargin:         toFinite(daily?.netProfitMargin),
    revenueGrowth:     toFinite(daily?.revenueGrowth),
    epsGrowth:         toFinite(daily?.epsGrowth),
    insiderOwnership:  toFinite(daily?.insiderOwnership),
    institutionalOwnership: toFinite(daily?.institutionalOwnership),
  };

  // --- Structure classification (fast, inline, deterministic) ---
  try {
    const structResult = classifyRow(merged);
    merged.structure          = structResult.structure;
    merged.structureLabel     = structResult.structureLabel;
    merged.structureSide      = structResult.structureSide;
    merged.structureGrade     = structResult.grade;
    merged.structureScore     = structResult.score;
    merged.structureExplanation = structResult.explanation;
  } catch {
    // never block screener on classification error
    merged.structure      = null;
    merged.structureGrade = null;
    merged.structureScore = 0;
  }

  return merged;
}

function includeByExchange(exchange, filters) {
  if (!filters.exchange || !filters.exchange.length) return true;
  return filters.exchange.includes(String(exchange || '').toUpperCase());
}

function includeByRange(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    // null values: skip filter if we can't evaluate
    if (min != null || max != null) return true;
  }
  if (min != null && n < min) return false;
  if (max != null && n > max) return false;
  return true;
}

function applyFilters(rows, filters) {
  return rows.filter((row) => {
    if (!includeByExchange(row.exchange, filters)) return false;
    if (!includeByRange(row.price,      filters.priceMin,     filters.priceMax))     return false;
    if (!includeByRange(row.marketCap,  filters.marketCapMin, filters.marketCapMax)) return false;
    if (!includeByRange(row.rvol,       filters.rvolMin,      filters.rvolMax))      return false;
    if (!includeByRange(row.gapPercent, filters.gapMin,       filters.gapMax))       return false;
    if (filters.volumeMin != null && Number(row.volume) < filters.volumeMin) return false;
    return true;
  });
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const ra = Number(a.rvol) || 0;
    const rb = Number(b.rvol) || 0;
    if (rb !== ra) return rb - ra;
    const va = Number(a.volume) || 0;
    const vb = Number(b.volume) || 0;
    if (vb !== va) return vb - va;
    return (Number(b.changePercent) || 0) - (Number(a.changePercent) || 0);
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
  const dailyMetricsMap   = getDailyMetricsMap();

  const universe = canonicalUniverse
    .filter((item) => allowedSymbols.has(String(item?.symbol || '').trim().toUpperCase()))
    .map((item) => mergeRow(item, dailyMetricsMap));

  const symbolSearch = String(filters.symbolSearch || '').trim().toUpperCase();
  const scopedUniverse = symbolSearch
    ? universe.filter((item) => String(item?.symbol || '').toUpperCase().includes(symbolSearch))
    : universe;

  const filtered = applyFilters(scopedUniverse, filters);
  const sorted   = sortRows(filtered);

  console.log('[screenerV3/technical] completed', {
    universeCount:  universe.length,
    filteredCount:  filtered.length,
    resultCount:    sorted.length,
  });

  return sorted;
}

module.exports = {
  runTechnicalScreener,
};
