let baseUniverse = [];
let enrichedUniverse = [];

const datasets = {
  baseUniverse: { data: baseUniverse, updatedAt: null },
  enrichedUniverse: { data: enrichedUniverse, updatedAt: null },
  fundamentals: { data: new Map(), updatedAt: null },
  technicals: { data: new Map(), updatedAt: null },
  news: { data: new Map(), updatedAt: null },
  catalysts: { data: new Map(), updatedAt: null },
  earnings: { data: new Map(), updatedAt: null },
  analysts: { data: new Map(), updatedAt: null },
  strategy: { data: new Map(), updatedAt: null },
  computed: { data: new Map(), updatedAt: null },
  // Phase-aware additions
  operationalUniverse: { data: [], updatedAt: null },
  quotes: { data: new Map(), updatedAt: null },
  // OpenRange Screener Engine v1
  historical:  { data: new Map(), updatedAt: null },
  structures:  { data: new Map(), updatedAt: null },
  spyState:    { data: null,      updatedAt: null },
};

const ttl = {
  baseUniverse: 24 * 60 * 60 * 1000,
  enrichedUniverse: 2 * 60 * 1000,
  fundamentals: 24 * 60 * 60 * 1000,
  technicals: 2 * 60 * 1000,
  news: 5 * 60 * 1000,
  catalysts: 5 * 60 * 1000,
  earnings: 24 * 60 * 60 * 1000,
  analysts: 24 * 60 * 60 * 1000,
  strategy: 2 * 60 * 1000,
  computed: 2 * 60 * 1000,
  operationalUniverse: 5 * 60 * 1000,
  quotes:              2 * 60 * 1000,
  historical:          24 * 60 * 60 * 1000,
  structures:          2 * 60 * 1000,
  spyState:            5 * 60 * 1000,
};

// ---------------------------------------------------------------------------
// API call metrics (shared across services)
// ---------------------------------------------------------------------------

const _apiMetrics = {
  totalCalls: 0,
  callsThisWindow: 0,
  windowStart: Date.now(),
};

function recordApiCall() {
  _apiMetrics.totalCalls++;
  const now = Date.now();
  if (now - _apiMetrics.windowStart > 60_000) {
    _apiMetrics.callsThisWindow = 0;
    _apiMetrics.windowStart = now;
  }
  _apiMetrics.callsThisWindow++;
}

function getApiMetrics() {
  return { ..._apiMetrics };
}

function isFresh(name, customTtl) {
  const node = datasets[name];
  if (!node || !node.updatedAt) return false;
  const maxAge = customTtl ?? ttl[name] ?? 0;
  return Date.now() - node.updatedAt < maxAge;
}

function setDataset(name, data) {
  if (!(name in datasets)) return;
  if (data == null) return;
  datasets[name].data = data;
  datasets[name].updatedAt = Date.now();
  if (name === 'baseUniverse') baseUniverse = Array.isArray(data) ? data : [];
  if (name === 'enrichedUniverse') enrichedUniverse = Array.isArray(data) ? data : [];
}

function getDataset(name) {
  return datasets[name]?.data;
}

function setBaseUniverse(data) {
  if (!Array.isArray(data)) return;
  baseUniverse = data;
  datasets.baseUniverse.data = data;
  datasets.baseUniverse.updatedAt = Date.now();
}

function getBaseUniverse() {
  return Array.isArray(baseUniverse) ? baseUniverse : [];
}

function setEnrichedUniverse(data) {
  if (!Array.isArray(data)) return;
  enrichedUniverse = data;
  datasets.enrichedUniverse.data = data;
  datasets.enrichedUniverse.updatedAt = Date.now();
}

function getEnrichedUniverse() {
  return Array.isArray(enrichedUniverse) ? enrichedUniverse : [];
}

function getLastUpdated(name) {
  return datasets[name]?.updatedAt ?? null;
}

function getMetadata() {
  const meta = {};
  Object.keys(datasets).forEach((k) => {
    meta[k] = datasets[k].updatedAt;
  });
  return meta;
}

function mergeMasterDataset() {
  const base = getBaseUniverse();
  if (base.length === 0) {
    setEnrichedUniverse([]);
    return [];
  }

  const getBySymbol = (name, symbol) => {
    const m = datasets[name].data;
    if (m instanceof Map) return m.get(symbol) || {};
    return {};
  };

  const merged = base.map((row) => {
    const symbol = row.symbol;
    // Normalize raw FMP quote fields before spreading.
    // FMP /stable/quote returns changesPercentage (with 's') and avgVolume.
    const qRaw = getBySymbol('quotes', symbol);
    const hasQuote = Object.keys(qRaw).length > 0;
    const _prevClose = qRaw.previousClose ?? qRaw.prevClose ?? null;
    const _open      = qRaw.open ?? null;
    const q = hasQuote ? {
      ...qRaw,
      // Unified changePercent (FMP returns changesPercentage with 's')
      changePercent:  qRaw.changePercent ?? qRaw.changesPercentage ?? qRaw.changePercentage ?? null,
      // Relative volume from FMP avgVolume
      relativeVolume: (qRaw.volume > 0 && qRaw.avgVolume > 0)
        ? Math.round((qRaw.volume / qRaw.avgVolume) * 100) / 100
        : null,
      // Normalize FMP OHLC field names
      high:      qRaw.high ?? qRaw.dayHigh ?? null,
      low:       qRaw.low  ?? qRaw.dayLow  ?? null,
      prevClose: _prevClose,
      // 52-week range
      high52w: qRaw.high52w ?? qRaw.yearHigh ?? null,
      low52w:  qRaw.low52w  ?? qRaw.yearLow  ?? null,
      // Gap % from open vs prev close (engines may override with more precise value)
      ...(_open != null && _prevClose != null && _prevClose !== 0 ? {
        gapPercent: Math.round(((_open - _prevClose) / _prevClose) * 10000) / 100,
      } : {}),
    } : {};
    // Historical scalar fields (floatShares, avgVolume30d, opening range, vwap)
    const histMap = datasets.historical.data;
    const hist = (histMap instanceof Map) ? (histMap.get(symbol) || {}) : {};
    const histScalars = {
      floatShares:      hist.floatShares      ?? null,
      avgVolume30d:     hist.avgVolume30d      ?? null,
      openingRangeHigh: hist.openingRangeHigh  ?? null,
      openingRangeLow:  hist.openingRangeLow   ?? null,
      // vwap from intraday bars takes precedence over quote-derived vwap
      vwap: hist.vwap ?? null,
    };

    // Structure classification result
    const structMap = datasets.structures.data;
    const structResult = (structMap instanceof Map) ? (structMap.get(symbol) || {}) : {};
    const structFields = {
      structure:           structResult.structure           ?? null,
      structureLabel:      structResult.structureLabel      ?? null,
      structureSide:       structResult.structureSide       ?? null,
      structureGrade:      structResult.grade               ?? null,
      structureScore:      structResult.score               ?? 0,
      structureExplanation:structResult.explanation         ?? null,
    };

    // Merge all data layers into a single object
    const base_ = {
      ...row,
      ...q,
      ...getBySymbol('fundamentals', symbol),
      ...histScalars,
      ...getBySymbol('technicals', symbol),
      ...getBySymbol('news', symbol),
      ...getBySymbol('catalysts', symbol),
      ...getBySymbol('earnings', symbol),
      ...getBySymbol('analysts', symbol),
      ...getBySymbol('strategy', symbol),
      ...getBySymbol('computed', symbol),
      ...structFields,
    };

    // Post-merge normalizations.
    // Raw FMP quote fields (dayHigh, yearHigh, previousClose, etc.) survive the spread
    // even when derived aliases (high, prevClose, etc.) are null from technicals running
    // on base rows that lacked quote data. We apply final values here so the enriched
    // row is always correct regardless of which engine ran first.
    const rOpen    = base_.open           ?? null;
    const rPrev    = base_.previousClose  ?? null;
    const rHigh    = base_.dayHigh        ?? null;
    const rLow     = base_.dayLow         ?? null;
    const rYear52H = base_.yearHigh       ?? null;
    const rYear52L = base_.yearLow        ?? null;
    const rPrice   = typeof base_.price === 'number' ? base_.price : null;
    const rVol     = typeof base_.volume === 'number' ? base_.volume : null;
    // Prefer Yahoo Finance 30-day avg volume over FMP's avgVolume (which FMP stable quote doesn't provide)
    const rAvgVol  = typeof base_.avgVolume30d === 'number' && base_.avgVolume30d > 0
      ? base_.avgVolume30d
      : (typeof base_.avgVolume === 'number' ? base_.avgVolume : null);

    // Percent change helper: rounds to 2dp, returns null on bad input
    const _pct = (a, b) =>
      (a != null && b != null && b !== 0)
        ? Math.round(((a - b) / b) * 10000) / 100
        : null;

    return {
      ...base_,
      // Field name aliases (raw FMP → clean names)
      high:     base_.high     ?? rHigh,
      low:      base_.low      ?? rLow,
      prevClose:base_.prevClose ?? rPrev,
      high52w:  base_.high52w  ?? rYear52H,
      low52w:   base_.low52w   ?? rYear52L,
      // Derived metrics — applied AFTER all spreads so technicals null doesn't win
      gapPercent:    base_.gapPercent    != null ? base_.gapPercent    : _pct(rOpen, rPrev),
      return1D:      base_.return1D      != null ? base_.return1D      : _pct(rPrice, rPrev),
      dollarVolume:  base_.dollarVolume  != null ? base_.dollarVolume  : (rVol != null && rPrice != null ? rVol * rPrice : null),
      relativeVolume:base_.relativeVolume != null ? base_.relativeVolume : (rVol != null && rAvgVol > 0 ? Math.round((rVol / rAvgVol) * 100) / 100 : null),
      distanceFrom52wHighPercent: base_.distanceFrom52wHighPercent != null ? base_.distanceFrom52wHighPercent : _pct(rPrice, rYear52H),
      distanceFrom52wLowPercent:  base_.distanceFrom52wLowPercent  != null ? base_.distanceFrom52wLowPercent  : _pct(rPrice, rYear52L),
      intradayMoveFromOpenPercent:base_.intradayMoveFromOpenPercent != null ? base_.intradayMoveFromOpenPercent : _pct(rPrice, rOpen),
      intradayMoveFromHighPercent:base_.intradayMoveFromHighPercent != null ? base_.intradayMoveFromHighPercent : _pct(rPrice, rHigh),
      intradayMoveFromLowPercent: base_.intradayMoveFromLowPercent  != null ? base_.intradayMoveFromLowPercent  : _pct(rPrice, rLow),
      // EMA 50/200 fallback: FMP quote includes 50/200-day price averages (SMAs).
      // Used when full EMA calculation is unavailable (requires closeSeries history).
      ema50:  base_.ema50  != null ? base_.ema50  : (base_.priceAvg50  ?? null),
      ema200: base_.ema200 != null ? base_.ema200 : (base_.priceAvg200 ?? null),
      // marketCap: preserve base screener value when fundamentals layer returns null.
      // fundamentalsEnricher.mapToFundamentals() returns marketCap:null for failed batch
      // calls, silently destroying the good value already in the base universe row.
      marketCap: (base_.marketCap != null && Number.isFinite(base_.marketCap))
        ? base_.marketCap
        : (Number.isFinite(Number(row.marketCap)) ? Number(row.marketCap) : null),
    };
  });

  // Never filter during enrichment merge; preserve base row count.
  setEnrichedUniverse(merged);
  return merged;
}

module.exports = {
  isFresh,
  setDataset,
  getDataset,
  setBaseUniverse,
  getBaseUniverse,
  setEnrichedUniverse,
  getEnrichedUniverse,
  getLastUpdated,
  getMetadata,
  mergeMasterDataset,
  recordApiCall,
  getApiMetrics,
  ttl,
};
