// @ts-nocheck
const axios = require('axios');
const path = require('path');
const cacheManager = require('../data-engine/cacheManager');
const { getStocksByBuckets } = require(path.join(__dirname, 'directoryServiceV1.ts'));

const FMP_BASE = 'https://financialmodelingprep.com';
const REQUEST_TIMEOUT_MS = 30000;
const REQUEST_MIN_GAP_MS = 120;

const TTL_INTRADAY_MS = 5 * 60 * 1000;
const TTL_DAILY_MS = 60 * 60 * 1000;
const TTL_FUNDAMENTALS_MS = 6 * 60 * 60 * 1000;
const TTL_SNAPSHOT_MS = 60 * 1000;
const TTL_UNIVERSE_MS = 2 * 60 * 1000;
const DOLLAR_VOLUME_MIN = 10_000_000;

const caches = {
  intraday: new Map(),
  daily: new Map(),
  fundamentals: new Map(),
  snapshot: new Map(),
  universe: new Map(),
};

interface CanonicalStock {
  symbol: string;
  name: string | null;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
  country: string | null;
  bucket: string | null;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  changesPercentage: number | null;
  volume: number | null;
  avgVolume: number | null;
  marketCap: number | null;
  relativeVolume: number | null;
  rvol: number | null;
  dollarVolume: number | null;
  gapPercent: number | null;
  atr: number | null;
  atrPercent: number | null;
  vwap: number | null;
  rsi14: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema9: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  pe: number | null;
  forwardPE: number | null;
  pegRatio: number | null;
  priceToSales: number | null;
  priceToBook: number | null;
  roe: number | null;
  roa: number | null;
  roic: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netProfitMargin: number | null;
  epsGrowthThisYear: number | null;
  epsGrowthNextYear: number | null;
  epsGrowthTTM: number | null;
  salesGrowthQoq: number | null;
  salesGrowthTTM: number | null;
  insiderOwnership: number | null;
  institutionalOwnership: number | null;
  shortFloat: number | null;
  analystRating: number | null;
  high52Week: number | null;
  low52Week: number | null;
  highAllTime: number | null;
  lowAllTime: number | null;
  structure: string | null;
  structureType: string | null;
  structureConfidence: number | null;
  liquidityQualified: boolean | null;
  structureGrade: string | null;
}

let requestChain = Promise.resolve();
let lastRequestAt = 0;

function now() {
  return Date.now();
}

function readCache(map, key, ttlMs) {
  const hit = map.get(key);
  if (!hit) return null;
  if (now() - hit.ts > ttlMs) {
    map.delete(key);
    return null;
  }
  return hit.value;
}

function writeCache(map, key, value) {
  map.set(key, { ts: now(), value });
  return value;
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toSecTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  const parsed = Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed / 1000);
}

function normalizeCandle(row) {
  const time = toSecTime(row?.date || row?.datetime || row?.timestamp || row?.time);
  if (!Number.isFinite(time)) return null;

  const close = toNum(row?.close) ?? toNum(row?.adjClose) ?? toNum(row?.price);
  const open = toNum(row?.open) ?? close;
  const high = toNum(row?.high) ?? close;
  const low = toNum(row?.low) ?? close;
  const volume = toNum(row?.volume) ?? null;

  if ([open, high, low, close].some((v) => v == null)) return null;

  return {
    time,
    open,
    high,
    low,
    close,
    volume,
  };
}

function sortCandles(candles) {
  return [...candles].sort((a, b) => a.time - b.time);
}

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.historical)) return payload.historical;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const valid = values.filter((v) => Number.isFinite(v));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function runRateLimited(task) {
  requestChain = requestChain.catch(() => undefined).then(async () => {
    const elapsed = now() - lastRequestAt;
    const waitMs = Math.max(0, REQUEST_MIN_GAP_MS - elapsed);
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    const out = await task();
    lastRequestAt = now();
    return out;
  });
  return requestChain;
}

async function fetchStable(endpoint, params = {}) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    throw new Error('FMP_API_KEY missing');
  }

  return runRateLimited(async () => {
    const response = await axios.get(`${FMP_BASE}${endpoint}`, {
      params: { ...params, apikey: apiKey },
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`FMP ${endpoint} failed with status ${response.status}`);
    }

    return response.data;
  });
}

async function fetchSnapshot(symbols) {
  const list = Array.isArray(symbols) ? symbols : [symbols];
  const cleaned = list.map((s) => String(s || '').trim().toUpperCase()).filter(Boolean);
  if (!cleaned.length) return new Map();

  const key = cleaned.join(',');
  const cached = readCache(caches.snapshot, key, TTL_SNAPSHOT_MS);
  if (cached) return cached;
  const map = new Map();

  const groups = chunk(cleaned, 200);
  for (const group of groups) {
    let rows = [];
    try {
      rows = asArray(await fetchStable('/stable/batch-quote', { symbols: group.join(',') }));
    } catch {
      rows = [];
    }
    for (const row of rows) {
      const symbol = String(row?.symbol || '').trim().toUpperCase();
      if (symbol) map.set(symbol, row);
    }
  }

  return writeCache(caches.snapshot, key, map);
}

async function fetchFundamentals(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return { keyMetrics: null, ratios: null, profile: null };

  const cached = readCache(caches.fundamentals, sym, TTL_FUNDAMENTALS_MS);
  if (cached) return cached;

  const [keyMetricsRaw, ratiosRaw, profileRaw] = await Promise.all([
    fetchStable('/stable/key-metrics', { symbol: sym }),
    fetchStable('/stable/ratios', { symbol: sym }),
    fetchStable('/stable/profile', { symbol: sym }),
  ]);

  const out = {
    keyMetrics: asArray(keyMetricsRaw)[0] || null,
    ratios: asArray(ratiosRaw)[0] || null,
    profile: asArray(profileRaw)[0] || null,
  };

  return writeCache(caches.fundamentals, sym, out);
}

async function fetchDailyCandles(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return [];

  const cached = readCache(caches.daily, sym, TTL_DAILY_MS);
  if (cached) return cached;

  const end = new Date();
  const start = new Date(end.getTime() - (540 * 24 * 60 * 60 * 1000));
  const from = start.toISOString().slice(0, 10);
  const to = end.toISOString().slice(0, 10);

  let raw;
  try {
    raw = await fetchStable('/stable/historical-chart/1day', { symbol: sym });
  } catch {
    try {
      raw = await fetchStable('/stable/historical-price-eod/full', { symbol: sym, from, to });
    } catch {
      try {
        raw = await fetchStable('/stable/historical-price-eod/light', { symbol: sym, from, to });
      } catch {
          raw = await fetchStable('/stable/historical-price-eod/full', { symbol: sym, from, to });
      }
    }
  }
  const rawRows = asArray(raw);
  const rows = rawRows.map(normalizeCandle).filter(Boolean);
  const candles = sortCandles(rows);
  return writeCache(caches.daily, sym, candles);
}

async function fetchIntradayCandles(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return [];

  const cached = readCache(caches.intraday, sym, TTL_INTRADAY_MS);
  if (cached) return cached;

  let raw;
  try {
    raw = await fetchStable('/stable/historical-chart/1min', { symbol: sym });
  } catch {
    raw = await fetchStable('/stable/historical-chart/5min', { symbol: sym });
  }
  const rawRows = asArray(raw);
  const rows = rawRows.map(normalizeCandle).filter(Boolean);
  const candles = sortCandles(rows);
  return writeCache(caches.intraday, sym, candles);
}

function aggregateCandles(candles, minutes) {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  if (!Number.isFinite(minutes) || minutes <= 1) return candles;

  const bucketSec = minutes * 60;
  const buckets = new Map();

  for (const candle of candles) {
    const bucket = Math.floor(candle.time / bucketSec) * bucketSec;
    const existing = buckets.get(bucket);
    if (!existing) {
      buckets.set(bucket, {
        time: bucket,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      });
      continue;
    }

    existing.high = Math.max(existing.high, candle.high);
    existing.low = Math.min(existing.low, candle.low);
    existing.close = candle.close;
    existing.volume += Number.isFinite(candle.volume) ? candle.volume : 0;
  }

  return sortCandles(Array.from(buckets.values()));
}

function computeEMA(candles, period) {
  const k = 2 / (period + 1);
  const out = [];
  let prev = null;

  for (let i = 0; i < candles.length; i++) {
    const close = candles[i].close;
    if (!Number.isFinite(close)) continue;

    if (prev == null) {
      prev = close;
    } else {
      prev = (close * k) + (prev * (1 - k));
    }

    out.push({ time: candles[i].time, value: prev });
  }

  return out;
}

function computeRSI(candles, period = 14) {
  const closes = candles.map((c) => c.close);
  if (closes.length <= period) return [];

  const deltas = [];
  for (let i = 1; i < closes.length; i++) {
    deltas.push(closes[i] - closes[i - 1]);
  }

  let gains = 0;
  let losses = 0;
  for (let i = 0; i < period; i++) {
    const d = deltas[i];
    if (d >= 0) gains += d;
    else losses += Math.abs(d);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  const out = [];

  for (let i = period; i < deltas.length; i++) {
    const delta = deltas[i];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;

    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    out.push({ time: candles[i + 1].time, value: rsi });
  }

  return out;
}

function computeATR(candles, period = 14) {
  if (candles.length < period + 1) return [];

  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
    trueRanges.push(tr);
  }

  let atr = average(trueRanges.slice(0, period));
  const out = [];
  if (!Number.isFinite(atr)) return out;

  for (let i = period; i < trueRanges.length; i++) {
    atr = ((atr * (period - 1)) + trueRanges[i]) / period;
    out.push({ time: candles[i + 1].time, value: atr });
  }

  return out;
}

function computeVWAP(intradayCandles) {
  let cumulativePV = 0;
  let cumulativeVolume = 0;
  const out = [];

  for (const candle of intradayCandles) {
    const price = candle.close;
    const volume = Number.isFinite(candle.volume) ? candle.volume : 0;
    if (!Number.isFinite(price) || volume <= 0) {
      continue;
    }

    cumulativePV += price * volume;
    cumulativeVolume += volume;
    if (cumulativeVolume <= 0) continue;

    out.push({
      time: candle.time,
      value: cumulativePV / cumulativeVolume,
    });
  }

  return out;
}

function computeAtrPercent(candles, atrSeries) {
  const closeByTime = new Map(candles.map((c) => [c.time, c.close]));
  return atrSeries
    .map((p) => {
      const close = closeByTime.get(p.time);
      if (!Number.isFinite(close) || close === 0) return null;
      return { time: p.time, value: (p.value / close) * 100 };
    })
    .filter(Boolean);
}

function computeRelativeVolume(snapshotRow, dailyCandles, intradayCandles) {
  const currentDay = last(intradayCandles);
  const currentDayKey = currentDay ? Math.floor(currentDay.time / 86400) : null;
  const intradayByDay = new Map();
  for (const candle of intradayCandles || []) {
    if (!Number.isFinite(candle?.time)) continue;
    const dayKey = Math.floor(candle.time / 86400);
    const prior = intradayByDay.get(dayKey) ?? 0;
    const vol = toNum(candle.volume);
    intradayByDay.set(dayKey, prior + (Number.isFinite(vol) ? vol : 0));
  }

  const currentIntradayVolume = currentDayKey != null ? (intradayByDay.get(currentDayKey) ?? null) : null;

  const currentVolume = toNum(snapshotRow?.volume)
    ?? currentIntradayVolume
    ?? (toNum(intradayCandles[intradayCandles.length - 1]?.volume) ?? null);

  let avgVolume = toNum(snapshotRow?.avgVolume)
    ?? toNum(snapshotRow?.avgVolume3m)
    ?? toNum(snapshotRow?.averageVolume)
    ?? toNum(snapshotRow?.volumeAvg)
    ?? null;

  if (!Number.isFinite(avgVolume) || avgVolume <= 0) {
    const recent20 = Array.isArray(dailyCandles) ? dailyCandles.slice(-20) : [];
    const vols = recent20
      .map((c) => toNum(c?.volume))
      .filter((v) => Number.isFinite(v) && v > 0);
    avgVolume = average(vols);
  }

  if (!Number.isFinite(avgVolume) || avgVolume <= 0) {
    const derived = Array.from(intradayByDay.entries())
      .filter(([day]) => day !== currentDayKey)
      .map(([, vol]) => vol)
      .filter((v) => Number.isFinite(v) && v > 0)
      .slice(-20);
    avgVolume = average(derived);
  }

  if (!Number.isFinite(currentVolume) || !Number.isFinite(avgVolume) || avgVolume <= 0) {
    return { relativeVolume: null, avgVolume: Number.isFinite(avgVolume) && avgVolume > 0 ? avgVolume : null, currentVolume: Number.isFinite(currentVolume) ? currentVolume : null };
  }

  return {
    relativeVolume: currentVolume / avgVolume,
    avgVolume,
    currentVolume,
  };
}

function last(arr) {
  return Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null;
}

function toNull(value) {
  return value == null ? null : value;
}

function toFiniteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fallbackNumber(...values) {
  for (const value of values) {
    const n = toFiniteOrNull(value);
    if (n != null) return n;
  }
  return null;
}

function chunk(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function latestValue(series) {
  const point = last(series);
  return toFiniteOrNull(point?.value);
}

function computeSma(candles, period) {
  if (!Array.isArray(candles) || candles.length < period) return null;
  const closeSlice = candles.slice(-period).map((c) => toFiniteOrNull(c?.close)).filter(Number.isFinite);
  if (closeSlice.length < period) return null;
  return average(closeSlice);
}

function cleanMissingFundamental(value) {
  const n = toFiniteOrNull(value);
  return n == null ? null : n;
}

function buildFundamentalFromSources({ profile, ratios, keyMetrics }) {
  return {
    pe: cleanMissingFundamental(profile?.pe ?? ratios?.priceEarningsRatio),
    forwardPE: cleanMissingFundamental(profile?.forwardPE ?? profile?.forwardPe ?? ratios?.forwardPE),
    pegRatio: cleanMissingFundamental(profile?.peg ?? profile?.pegRatio ?? ratios?.pegRatio),
    priceToSales: cleanMissingFundamental(ratios?.priceToSalesRatio ?? keyMetrics?.priceToSales),
    priceToBook: cleanMissingFundamental(ratios?.priceToBookRatio ?? keyMetrics?.pbRatio),
    roe: cleanMissingFundamental(ratios?.returnOnEquity ?? keyMetrics?.roe),
    roa: cleanMissingFundamental(ratios?.returnOnAssets ?? keyMetrics?.roa),
    roic: cleanMissingFundamental(ratios?.returnOnCapitalEmployed ?? keyMetrics?.roic),
    grossMargin: cleanMissingFundamental(ratios?.grossProfitMargin ?? keyMetrics?.grossProfitMargin),
    operatingMargin: cleanMissingFundamental(ratios?.operatingProfitMargin ?? keyMetrics?.operatingMargin),
    netProfitMargin: cleanMissingFundamental(ratios?.netProfitMargin ?? keyMetrics?.netProfitMargin),
  };
}

async function fetchBatchedStableMap(endpoint, symbols, keyName = 'symbol') {
  const out = new Map();
  const groups = chunk(symbols, 100);
  for (const group of groups) {
    if (!group.length) continue;
    let rows = [];
    try {
      rows = asArray(await fetchStable(endpoint, { symbol: group.join(',') }));
    } catch {
      rows = [];
    }
    for (const row of rows) {
      const sym = String(row?.[keyName] || row?.symbol || '').trim().toUpperCase();
      if (!sym) continue;
      out.set(sym, row);
    }
  }
  return out;
}

function normalizeStock(raw = {}): CanonicalStock {
  const price = fallbackNumber(raw.price, raw.snapshot?.price);
  const volume = fallbackNumber(raw.volume, raw.snapshot?.volume);
  const avgVolume = fallbackNumber(raw.avgVolume, raw.snapshot?.avgVolume, raw.snapshot?.avgVolume3m, raw.snapshot?.averageVolume);
  const marketCap = fallbackNumber(raw.marketCap, raw.snapshot?.marketCap, raw.profile?.marketCap);
  const changePercent = fallbackNumber(raw.changePercent, raw.changesPercentage, raw.snapshot?.changePercent, raw.snapshot?.changesPercentage, raw.snapshot?.changePercentage);
  const change = fallbackNumber(raw.change, raw.snapshot?.change);
  const previousClose = fallbackNumber(raw.previousClose, raw.snapshot?.previousClose, raw.prevClose);
  const open = fallbackNumber(raw.open, raw.snapshot?.open);
  const atr = fallbackNumber(raw.atr, raw.atr14, raw.snapshot?.atr, raw.snapshot?.atr14);
  const relativeVolume = fallbackNumber(raw.relativeVolume, raw.rvol, (volume != null && avgVolume != null && avgVolume > 0) ? volume / avgVolume : null);
  const dollarVolume = fallbackNumber(raw.dollarVolume, (price != null && volume != null) ? price * volume : null);
  const gapPercent = fallbackNumber(raw.gapPercent, (open != null && previousClose != null && previousClose !== 0) ? ((open - previousClose) / previousClose) * 100 : null);
  const atrPercent = fallbackNumber(raw.atrPercent, (atr != null && price != null && price > 0) ? (atr / price) * 100 : null);
  const liquidityQualified = typeof raw.liquidityQualified === 'boolean'
    ? raw.liquidityQualified
    : (Number.isFinite(dollarVolume) ? dollarVolume >= DOLLAR_VOLUME_MIN : null);
  const structureType = raw.structureType ?? raw.structure ?? null;
  const structureConfidence = fallbackNumber(raw.structureConfidence, raw.structureScore, raw.score);

  return {
    symbol: String(raw.symbol || '').toUpperCase(),
    name: toNull(raw.name),
    exchange: toNull(raw.exchange),
    sector: toNull(raw.sector),
    industry: toNull(raw.industry),
    country: toNull(raw.country),
    bucket: toNull(raw.directoryBucket ?? raw.bucket),

    price,
    change,
    changePercent,
    changesPercentage: changePercent,
    volume,
    avgVolume,
    marketCap,

    relativeVolume,
    rvol: relativeVolume,
    dollarVolume,
    gapPercent,
    atr,
    atrPercent,
    vwap: fallbackNumber(raw.vwap),

    rsi14: fallbackNumber(raw.rsi14),
    sma20: fallbackNumber(raw.sma20),
    sma50: fallbackNumber(raw.sma50, raw.priceAvg50),
    sma200: fallbackNumber(raw.sma200, raw.priceAvg200),
    ema9: fallbackNumber(raw.ema9),
    ema20: fallbackNumber(raw.ema20),
    ema50: fallbackNumber(raw.ema50),
    ema200: fallbackNumber(raw.ema200),

    pe: cleanMissingFundamental(raw.pe),
    forwardPE: cleanMissingFundamental(raw.forwardPE ?? raw.forwardPe),
    pegRatio: cleanMissingFundamental(raw.pegRatio ?? raw.peg),
    priceToSales: cleanMissingFundamental(raw.priceToSales ?? raw.ps),
    priceToBook: cleanMissingFundamental(raw.priceToBook ?? raw.pb),
    roe: cleanMissingFundamental(raw.roe),
    roa: cleanMissingFundamental(raw.roa),
    roic: cleanMissingFundamental(raw.roic),
    grossMargin: cleanMissingFundamental(raw.grossMargin),
    operatingMargin: cleanMissingFundamental(raw.operatingMargin),
    netProfitMargin: cleanMissingFundamental(raw.netProfitMargin ?? raw.netMargin),

    epsGrowthThisYear: cleanMissingFundamental(raw.epsGrowthThisYear ?? raw.epsGrowth),
    epsGrowthNextYear: cleanMissingFundamental(raw.epsGrowthNextYear),
    epsGrowthTTM: cleanMissingFundamental(raw.epsGrowthTTM ?? raw.epsGrowth),
    salesGrowthQoq: cleanMissingFundamental(raw.salesGrowthQoq ?? raw.salesGrowth),
    salesGrowthTTM: cleanMissingFundamental(raw.salesGrowthTTM ?? raw.salesGrowth),

    insiderOwnership: cleanMissingFundamental(raw.insiderOwnership ?? raw.insiderOwnershipPercent),
    institutionalOwnership: cleanMissingFundamental(raw.institutionalOwnership ?? raw.institutionalOwnershipPercent),
    shortFloat: cleanMissingFundamental(raw.shortFloat ?? raw.shortPercentOfFloat),
    analystRating: cleanMissingFundamental(raw.analystRating ?? raw.consensusRating),

    high52Week: fallbackNumber(raw.high52Week, raw.high52w, raw.yearHigh),
    low52Week: fallbackNumber(raw.low52Week, raw.low52w, raw.yearLow),
    highAllTime: fallbackNumber(raw.highAllTime, raw.allTimeHigh),
    lowAllTime: fallbackNumber(raw.lowAllTime, raw.allTimeLow),

    structure: toNull(structureType),
    structureType: toNull(structureType),
    structureConfidence,
    liquidityQualified,
    structureGrade: toNull(raw.structureGrade ?? raw.grade ?? null),
  };
}

async function getEnrichedUniverse(): Promise<CanonicalStock[]> {
  const cached = readCache(caches.universe, 'all', TTL_UNIVERSE_MS);
  if (cached) return cached;

  const buckets = ['common', 'etf', 'adr', 'preferred', 'other'];
  const directoryRows = await getStocksByBuckets(buckets);

  const cacheRows = new Map(
    (Array.isArray(cacheManager.getEnrichedUniverse()) ? cacheManager.getEnrichedUniverse() : [])
      .map((row) => [String(row?.symbol || '').trim().toUpperCase(), row])
  );

  const normalized = [];

  for (const base of directoryRows) {
    const symbol = String(base?.symbol || '').trim().toUpperCase();
    if (!symbol) continue;

    const snapshot = null;
    const profile = null;
    const ratios = null;
    const keyMetrics = null;
    const fundamentals = buildFundamentalFromSources({ profile, ratios, keyMetrics });
    const cachedRow = cacheRows.get(symbol) || {};

    const merged = {
      ...base,
      ...cachedRow,
      ...fundamentals,
      snapshot,
      profile,
      ratios,
      keyMetrics,
      symbol,
      name: base?.name ?? cachedRow?.name ?? snapshot?.name ?? null,
      exchange: base?.exchange ?? cachedRow?.exchange ?? snapshot?.exchange ?? base?.exchangeShortName ?? null,
      marketCap: fallbackNumber(snapshot?.marketCap, profile?.marketCap, cachedRow?.marketCap, base?.marketCap),
      price: fallbackNumber(snapshot?.price, cachedRow?.price, base?.price),
      volume: fallbackNumber(snapshot?.volume, cachedRow?.volume, base?.volume),
      avgVolume: fallbackNumber(snapshot?.avgVolume, snapshot?.avgVolume3m, cachedRow?.avgVolume, base?.avgVolume),
      change: fallbackNumber(snapshot?.change, cachedRow?.change),
      changePercent: fallbackNumber(snapshot?.changesPercentage, snapshot?.changePercentage, cachedRow?.changePercent, cachedRow?.changesPercentage),
      open: fallbackNumber(snapshot?.open, cachedRow?.open, base?.open),
      previousClose: fallbackNumber(snapshot?.previousClose, cachedRow?.previousClose, base?.previousClose),
      atr: fallbackNumber(cachedRow?.atr, cachedRow?.atr14),
    };

    const cachedCloseSeries = Array.isArray(cachedRow?.closeSeries)
      ? cachedRow.closeSeries.map((close, index) => ({
        time: index,
        open: Number(close),
        high: Number(close),
        low: Number(close),
        close: Number(close),
        volume: null,
      })).filter((c) => Number.isFinite(c.close))
      : [];

    if (cachedCloseSeries.length >= 20) {
      merged.sma20 = fallbackNumber(merged.sma20, computeSma(cachedCloseSeries, 20));
      merged.sma50 = fallbackNumber(merged.sma50, computeSma(cachedCloseSeries, 50));
      merged.sma200 = fallbackNumber(merged.sma200, computeSma(cachedCloseSeries, 200));
      merged.rsi14 = fallbackNumber(merged.rsi14, latestValue(computeRSI(cachedCloseSeries, 14)));
      merged.ema9 = fallbackNumber(merged.ema9, latestValue(computeEMA(cachedCloseSeries, 9)));
      merged.ema20 = fallbackNumber(merged.ema20, latestValue(computeEMA(cachedCloseSeries, 20)));
      merged.ema50 = fallbackNumber(merged.ema50, latestValue(computeEMA(cachedCloseSeries, 50)));
      merged.ema200 = fallbackNumber(merged.ema200, latestValue(computeEMA(cachedCloseSeries, 200)));
      merged.atr = fallbackNumber(merged.atr, latestValue(computeATR(cachedCloseSeries, 14)));
    }

    const canonical = normalizeStock(merged);
    if (!canonical.symbol) continue;
    normalized.push(canonical);
  }

  return writeCache(caches.universe, 'all', normalized);
}

async function getChartMarketData(symbol, interval = '1min', options = {}) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) throw new Error('symbol is required');

  const [snapshotMap, fundamentals, dailyCandles] = await Promise.all([
    fetchSnapshot([sym]),
    fetchFundamentals(sym),
    fetchDailyCandles(sym),
  ]);

  const intradayCandles = Array.isArray(options?.intradayCandlesOverride)
    ? options.intradayCandlesOverride
    : options?.skipIntraday
      ? []
      : await fetchIntradayCandles(sym);

  const snapshot = snapshotMap.get(sym) || {};

  let candles;
  if (interval === '1day') {
    candles = dailyCandles.slice(-250);
  } else if (interval === '5min') {
    candles = aggregateCandles(intradayCandles, 5);
  } else {
    candles = intradayCandles;
  }

  const ema9 = computeEMA(candles, 9);
  const ema20 = computeEMA(candles, 20);
  const ema50 = computeEMA(candles, 50);
  const ema200 = computeEMA(candles, 200);
  const rsi14 = computeRSI(candles, 14);
  const atr = computeATR(candles, 14);
  const atrPercent = computeAtrPercent(candles, atr);
  const vwap = computeVWAP(intradayCandles);

  const rv = computeRelativeVolume(snapshot, dailyCandles, intradayCandles);
  const lastCandle = candles[candles.length - 1] || null;
  const lastClose = toNum(lastCandle?.close);
  const lastVolume = toNum(lastCandle?.volume);
  const dollarVolume = Number.isFinite(lastClose) && Number.isFinite(lastVolume)
    ? (lastClose * lastVolume)
    : null;

  return {
    symbol: sym,
    interval,
    candles,
    intradayCandles,
    dailyCandles,
    snapshot,
    fundamentals,
    indicators: {
      ema9,
      ema20,
      ema50,
      ema200,
      rsi14,
      atr,
      atrPercent,
      vwap,
    },
    metrics: {
      relativeVolume: rv.relativeVolume,
      avgVolume: rv.avgVolume,
      currentVolume: rv.currentVolume,
      dollarVolume,
    },
  };
}

module.exports = {
  getEnrichedUniverse,
  normalizeStock,
  getChartMarketData,
  computeEMA,
  computeRSI,
  computeATR,
  computeVWAP,
  aggregateCandles,
};
