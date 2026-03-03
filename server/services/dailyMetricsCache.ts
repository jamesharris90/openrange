// @ts-nocheck
const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'daily-metrics-cache.json');
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

let loaded = false;
let metricsMap = new Map();
let meta = {
  refreshedAt: null,
  count: 0,
};
let loadedFileMtimeMs = null;

function ensureDataDir() {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
}

function toNum(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readFromDisk() {
  ensureDataDir();
  if (!fs.existsSync(CACHE_FILE)) {
    loaded = true;
    metricsMap = new Map();
    meta = { refreshedAt: null, count: 0 };
    loadedFileMtimeMs = null;
    return;
  }

  const stat = fs.statSync(CACHE_FILE);
  loadedFileMtimeMs = Number.isFinite(stat?.mtimeMs) ? stat.mtimeMs : null;

  const raw = fs.readFileSync(CACHE_FILE, 'utf8');
  const parsed = JSON.parse(raw || '{}');
  const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
  const next = new Map();

  for (const row of rows) {
    const symbol = String(row?.symbol || '').trim().toUpperCase();
    if (!symbol) continue;
    next.set(symbol, {
      symbol,
      avgVolume: toNum(row?.avgVolume),
      atr: toNum(row?.atr),
      atrPercent: toNum(row?.atrPercent),
      rsi14: toNum(row?.rsi14),
      sma20: toNum(row?.sma20),
      sma50: toNum(row?.sma50),
      sma200: toNum(row?.sma200),
      high52Week: toNum(row?.high52Week),
      low52Week: toNum(row?.low52Week),
      pe: toNum(row?.pe),
      forwardPE: toNum(row?.forwardPE),
      peg: toNum(row?.peg),
      priceToSales: toNum(row?.priceToSales),
      priceToBook: toNum(row?.priceToBook),
      roe: toNum(row?.roe),
      roa: toNum(row?.roa),
      roic: toNum(row?.roic),
      grossMargin: toNum(row?.grossMargin),
      operatingMargin: toNum(row?.operatingMargin),
      netProfitMargin: toNum(row?.netProfitMargin),
      revenueGrowth: toNum(row?.revenueGrowth),
      epsGrowth: toNum(row?.epsGrowth),
      insiderOwnership: toNum(row?.insiderOwnership),
      institutionalOwnership: toNum(row?.institutionalOwnership),
    });
  }

  metricsMap = next;
  meta = {
    refreshedAt: Number.isFinite(Number(parsed?.refreshedAt)) ? Number(parsed.refreshedAt) : null,
    count: next.size,
  };
  loaded = true;
}

function maybeReloadFromDisk() {
  ensureDataDir();
  if (!fs.existsSync(CACHE_FILE)) {
    if (loadedFileMtimeMs != null || loaded === false) {
      readFromDisk();
    }
    return;
  }

  const stat = fs.statSync(CACHE_FILE);
  const mtimeMs = Number.isFinite(stat?.mtimeMs) ? stat.mtimeMs : null;

  if (!loaded || loadedFileMtimeMs == null || (mtimeMs != null && mtimeMs !== loadedFileMtimeMs)) {
    readFromDisk();
  }
}

function ensureLoaded() {
  maybeReloadFromDisk();
}

function getDailyMetricsMeta() {
  ensureLoaded();
  return { ...meta };
}

function isDailyMetricsFresh(maxAgeMs = MAX_AGE_MS) {
  ensureLoaded();
  if (!Number.isFinite(meta.refreshedAt)) return false;
  return (Date.now() - meta.refreshedAt) <= maxAgeMs;
}

function getDailyMetricsMap() {
  ensureLoaded();
  return metricsMap;
}

function getDailyMetricsForSymbols(symbols = []) {
  ensureLoaded();
  const out = new Map();
  for (const symbolRaw of symbols) {
    const symbol = String(symbolRaw || '').trim().toUpperCase();
    if (!symbol) continue;
    if (metricsMap.has(symbol)) {
      out.set(symbol, metricsMap.get(symbol));
    }
  }
  return out;
}

function persistDailyMetrics(rows = []) {
  ensureDataDir();

  const normalizedRows = [];
  const nextMap = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const symbol = String(row?.symbol || '').trim().toUpperCase();
    if (!symbol) continue;

    const normalized = {
      symbol,
      avgVolume: toNum(row?.avgVolume),
      atr: toNum(row?.atr),
      atrPercent: toNum(row?.atrPercent),
      rsi14: toNum(row?.rsi14),
      sma20: toNum(row?.sma20),
      sma50: toNum(row?.sma50),
      sma200: toNum(row?.sma200),
      high52Week: toNum(row?.high52Week),
      low52Week: toNum(row?.low52Week),
      pe: toNum(row?.pe),
      forwardPE: toNum(row?.forwardPE),
      peg: toNum(row?.peg),
      priceToSales: toNum(row?.priceToSales),
      priceToBook: toNum(row?.priceToBook),
      roe: toNum(row?.roe),
      roa: toNum(row?.roa),
      roic: toNum(row?.roic),
      grossMargin: toNum(row?.grossMargin),
      operatingMargin: toNum(row?.operatingMargin),
      netProfitMargin: toNum(row?.netProfitMargin),
      revenueGrowth: toNum(row?.revenueGrowth),
      epsGrowth: toNum(row?.epsGrowth),
      insiderOwnership: toNum(row?.insiderOwnership),
      institutionalOwnership: toNum(row?.institutionalOwnership),
    };

    normalizedRows.push(normalized);
    nextMap.set(symbol, normalized);
  }

  const payload = {
    refreshedAt: Date.now(),
    count: nextMap.size,
    rows: normalizedRows,
  };

  const tempFile = `${CACHE_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2));
  fs.renameSync(tempFile, CACHE_FILE);

  metricsMap = nextMap;
  meta = {
    refreshedAt: payload.refreshedAt,
    count: payload.count,
  };
  loaded = true;

  return { ...meta };
}

module.exports = {
  getDailyMetricsMeta,
  isDailyMetricsFresh,
  getDailyMetricsMap,
  getDailyMetricsForSymbols,
  persistDailyMetrics,
};
