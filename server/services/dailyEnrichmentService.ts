// @ts-nocheck
const axios = require('axios');

const FMP_BASE = 'https://financialmodelingprep.com';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_CONCURRENCY = 6;
const BATCH_SIZE = 25;

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
  const open = toNum(row?.open);
  const high = toNum(row?.high);
  const low = toNum(row?.low);
  const close = toNum(row?.close ?? row?.adjClose ?? row?.price);
  const volume = toNum(row?.volume);

  if (!Number.isFinite(time)) return null;
  if (![open, high, low, close].every(Number.isFinite)) return null;

  return { time, open, high, low, close, volume: Number.isFinite(volume) ? volume : null };
}

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.historical)) return payload.historical;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function average(values) {
  const valid = (values || []).filter((v) => Number.isFinite(v));
  if (!valid.length) return null;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

function latestValue(series) {
  if (!Array.isArray(series) || !series.length) return null;
  const value = Number(series[series.length - 1]?.value);
  return Number.isFinite(value) ? value : null;
}

function computeSMA(candles, period) {
  if (!Array.isArray(candles) || candles.length < period) return null;
  const closes = candles.slice(-period).map((c) => toNum(c?.close));
  if (closes.some((v) => !Number.isFinite(v))) return null;
  return average(closes);
}

function computeRSI(candles, period = 14) {
  const closes = (candles || []).map((c) => toNum(c?.close)).filter(Number.isFinite);
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
    const d = deltas[i];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? Math.abs(d) : 0;

    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    const time = candles[i + 1]?.time;
    out.push({ time, value: rsi });
  }

  return out;
}

function computeATR(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return [];

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

  const seed = average(trueRanges.slice(0, period));
  if (!Number.isFinite(seed)) return [];

  let atr = seed;
  const out = [];
  for (let i = period; i < trueRanges.length; i++) {
    atr = ((atr * (period - 1)) + trueRanges[i]) / period;
    out.push({ time: candles[i + 1]?.time, value: atr });
  }

  return out;
}

function toPositiveOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toFiniteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toNonZeroOrNull(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n === 0 ? null : n;
}

function normalizePercentDecimal(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return null;
  if (Math.abs(n) > 1) return n / 100;
  return n;
}

function firstRow(payload) {
  if (Array.isArray(payload)) return payload[0] || null;
  if (Array.isArray(payload?.data)) return payload.data[0] || null;
  if (Array.isArray(payload?.historical)) return payload.historical[0] || null;
  return payload && typeof payload === 'object' ? payload : null;
}

async function fetchJson(urlPath) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) throw new Error('FMP_API_KEY missing');

  const response = await axios.get(`${FMP_BASE}${urlPath}`, {
    params: { apikey: apiKey },
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) return null;
  return response.data;
}

function extractFundamentalMetrics(profile, keyMetrics, ratios) {
  const pe = toNonZeroOrNull(
    ratios?.priceToEarningsRatio
    ?? keyMetrics?.priceToEarningsRatio
    ?? keyMetrics?.peRatio
  );

  const forwardPE = toNonZeroOrNull(
    ratios?.forwardPE
    ?? ratios?.forwardPriceToEarningsRatio
    ?? keyMetrics?.forwardPE
  );

  const peg = toNonZeroOrNull(
    ratios?.priceToEarningsGrowthRatio
    ?? ratios?.pegRatio
    ?? keyMetrics?.pegRatio
  );

  const priceToSales = toNonZeroOrNull(
    ratios?.priceToSalesRatio
    ?? profile?.priceToSalesRatio
  );

  const priceToBook = toNonZeroOrNull(
    ratios?.priceToBookRatio
    ?? profile?.priceToBookRatio
  );

  const roe = normalizePercentDecimal(
    keyMetrics?.returnOnEquity
    ?? keyMetrics?.returnOnEquityTTM
    ?? ratios?.returnOnEquity
  );

  const roa = normalizePercentDecimal(
    keyMetrics?.returnOnAssets
    ?? keyMetrics?.returnOnAssetsTTM
    ?? ratios?.returnOnAssets
  );

  const roic = normalizePercentDecimal(
    keyMetrics?.returnOnInvestedCapital
    ?? keyMetrics?.returnOnCapitalEmployed
    ?? ratios?.returnOnCapitalEmployed
  );

  const grossMargin = normalizePercentDecimal(
    keyMetrics?.grossProfitMargin
    ?? keyMetrics?.grossProfitMarginTTM
    ?? ratios?.grossProfitMargin
  );

  const operatingMargin = normalizePercentDecimal(
    keyMetrics?.operatingProfitMargin
    ?? keyMetrics?.operatingProfitMarginTTM
    ?? ratios?.operatingProfitMargin
    ?? ratios?.ebitMargin
  );

  const netProfitMargin = normalizePercentDecimal(
    keyMetrics?.netProfitMargin
    ?? keyMetrics?.netProfitMarginTTM
    ?? ratios?.netProfitMargin
    ?? ratios?.bottomLineProfitMargin
  );

  const revenueGrowth = normalizePercentDecimal(
    keyMetrics?.revenueGrowth
    ?? keyMetrics?.revenueGrowthTTM
  );

  const epsGrowth = normalizePercentDecimal(
    keyMetrics?.epsGrowth
    ?? keyMetrics?.epsGrowthTTM
  );

  const insiderOwnership = normalizePercentDecimal(
    profile?.insiderOwnership
    ?? profile?.insiderOwnershipPercent
    ?? keyMetrics?.insiderOwnership
  );

  const institutionalOwnership = normalizePercentDecimal(
    profile?.institutionalOwnership
    ?? profile?.institutionalOwnershipPercent
    ?? keyMetrics?.institutionalOwnership
  );

  return {
    pe,
    forwardPE,
    peg,
    priceToSales,
    priceToBook,
    roe,
    roa,
    roic,
    grossMargin,
    operatingMargin,
    netProfitMargin,
    revenueGrowth,
    epsGrowth,
    insiderOwnership,
    institutionalOwnership,
  };
}

async function fetchDailyCandles(symbol) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) throw new Error('FMP_API_KEY missing');

  const end = new Date();
  const start = new Date(end.getTime() - (500 * 24 * 60 * 60 * 1000));
  const from = start.toISOString().slice(0, 10);
  const to = end.toISOString().slice(0, 10);

  const endpoints = [
    ['/stable/historical-chart/1day', { symbol }],
    ['/stable/historical-price-eod/full', { symbol, from, to }],
    ['/stable/historical-price-eod/light', { symbol, from, to }],
  ];

  for (const [endpoint, params] of endpoints) {
    const response = await axios.get(`${FMP_BASE}${endpoint}`, {
      params: { ...params, apikey: apiKey },
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) continue;

    const candles = asArray(response.data)
      .map(normalizeCandle)
      .filter(Boolean)
      .sort((a, b) => a.time - b.time);

    if (candles.length >= 60) return candles;
  }

  return [];
}

async function enrichOne(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return null;

  const [candles, profilePayload, keyMetricsPayload, ratiosPayload] = await Promise.all([
    fetchDailyCandles(sym),
    fetchJson(`/stable/profile?symbol=${encodeURIComponent(sym)}`).then(firstRow).catch(() => null),
    fetchJson(`/stable/key-metrics?symbol=${encodeURIComponent(sym)}&limit=1`).then(firstRow).catch(() => null),
    fetchJson(`/stable/ratios?symbol=${encodeURIComponent(sym)}&limit=1`).then(firstRow).catch(() => null),
  ]);

  const fundamentalMetrics = extractFundamentalMetrics(profilePayload, keyMetricsPayload, ratiosPayload);

  if (candles.length < 15) {
    return {
      symbol: sym,
      avgVolume: null,
      atr: null,
      atrPercent: null,
      rsi14: null,
      sma20: null,
      sma50: null,
      sma200: null,
      high52Week: null,
      low52Week: null,
      ...fundamentalMetrics,
    };
  }

  const avgVolume = average(candles.slice(-20).map((c) => toNum(c?.volume)).filter((v) => Number.isFinite(v) && v > 0));
  const atrSeries = computeATR(candles, 14);
  const atr = latestValue(atrSeries);
  const close = toNum(candles[candles.length - 1]?.close);
  const atrPercent = Number.isFinite(atr) && Number.isFinite(close) && close > 0
    ? (atr / close) * 100
    : null;
  const rsi14 = latestValue(computeRSI(candles, 14));

  const trailing252 = candles.slice(-252);
  const highs = trailing252.map((c) => toNum(c?.high)).filter(Number.isFinite);
  const lows = trailing252.map((c) => toNum(c?.low)).filter(Number.isFinite);

  return {
    symbol: sym,
    avgVolume: toPositiveOrNull(avgVolume),
    atr: toPositiveOrNull(atr),
    atrPercent: toPositiveOrNull(atrPercent),
    rsi14: Number.isFinite(rsi14) ? rsi14 : null,
    sma20: toPositiveOrNull(computeSMA(candles, 20)),
    sma50: toPositiveOrNull(computeSMA(candles, 50)),
    sma200: toPositiveOrNull(computeSMA(candles, 200)),
    high52Week: highs.length ? toPositiveOrNull(Math.max(...highs)) : null,
    low52Week: lows.length ? toPositiveOrNull(Math.min(...lows)) : null,
    ...fundamentalMetrics,
  };
}

async function runWithConcurrency(items, worker, concurrency = MAX_CONCURRENCY) {
  const out = new Array(items.length);
  let next = 0;

  async function runWorker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        out[index] = await worker(items[index], index);
      } catch {
        out[index] = null;
      }
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker());
  await Promise.all(runners);
  return out;
}

async function enrichDailyMetrics(symbols = []) {
  const uniqueSymbols = Array.from(new Set(
    (Array.isArray(symbols) ? symbols : [])
      .map((s) => String(s || '').trim().toUpperCase())
      .filter(Boolean)
  ));

  const allRows = [];

  for (let start = 0; start < uniqueSymbols.length; start += BATCH_SIZE) {
    const batch = uniqueSymbols.slice(start, start + BATCH_SIZE);
    const rows = await runWithConcurrency(batch, (symbol) => enrichOne(symbol));
    allRows.push(...rows.filter(Boolean));
  }

  return allRows;
}

module.exports = {
  enrichDailyMetrics,
};
