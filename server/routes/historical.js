const express = require('express');
const axios = require('axios');
const market = require('../services/marketDataService');
const { computeEMA, computeRSI, computeATR } = require('../services/marketDataEngineV1.ts');
const router = express.Router();

const FMP_BASE = 'https://financialmodelingprep.com';

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
  const close = toNum(row?.close) ?? toNum(row?.adjClose) ?? toNum(row?.price);
  const open = toNum(row?.open) ?? close;
  const high = toNum(row?.high) ?? close;
  const low = toNum(row?.low) ?? close;
  const volume = toNum(row?.volume) ?? 0;

  if (!Number.isFinite(time)) return null;
  if (![open, high, low, close].every(Number.isFinite)) return null;
  return { time, open, high, low, close, volume };
}

function mapInterval(timeframeRaw) {
  const timeframe = String(timeframeRaw || '1m').trim().toLowerCase();
  if (timeframe === '15m') return '15min';
  if (timeframe === '1h') return '1hour';
  if (timeframe === '4h') return '4hour';
  if (timeframe === '1w') return '1week';
  if (timeframe === '5m') return '5min';
  if (timeframe === '1d') return '1day';
  return '1min';
}

function mapTimeframeLabel(value) {
  const raw = String(value || '1m').trim();
  if (raw === '1H' || raw.toLowerCase() === '1h') return '1h';
  if (raw === '1D' || raw.toLowerCase() === '1d') return '1d';
  if (raw === '1W' || raw.toLowerCase() === '1w') return '1w';
  if (raw.toLowerCase() === '15m') return '15m';
  if (raw.toLowerCase() === '5m') return '5m';
  return '1m';
}

function computeVWAP(candles = []) {
  let cumulativePV = 0;
  let cumulativeVol = 0;
  const out = [];
  for (const candle of candles) {
    const high = toNum(candle?.high);
    const low = toNum(candle?.low);
    const close = toNum(candle?.close);
    const volume = toNum(candle?.volume);
    if (![high, low, close, volume].every(Number.isFinite) || volume <= 0) continue;
    const typical = (high + low + close) / 3;
    cumulativePV += typical * volume;
    cumulativeVol += volume;
    if (cumulativeVol <= 0) continue;
    out.push({ time: candle.time, value: cumulativePV / cumulativeVol });
  }
  return out;
}

function computeSMAFromCandles(candles = [], period = 20, field = 'volume') {
  if (!Array.isArray(candles) || period < 1) return [];
  const out = [];
  const window = [];
  let running = 0;

  for (const candle of candles) {
    const value = toNum(candle?.[field]);
    if (!Number.isFinite(value)) continue;

    window.push(value);
    running += value;
    if (window.length > period) {
      running -= window.shift();
    }

    if (window.length === period && Number.isFinite(candle?.time)) {
      out.push({ time: candle.time, value: running / period });
    }
  }

  return out;
}

function getPreviousDailyLevel(daily = [], field) {
  if (!Array.isArray(daily) || !daily.length) return null;
  const idx = daily.length >= 2 ? daily.length - 2 : daily.length - 1;
  return toNum(daily[idx]?.[field]);
}

function computeOpeningRange(candles = [], width = 15) {
  if (!Array.isArray(candles) || !candles.length) {
    return { high: null, low: null, startTime: null, endTime: null };
  }
  const slice = candles.slice(0, Math.min(width, candles.length));
  if (!slice.length) return { high: null, low: null, startTime: null, endTime: null };

  const highs = slice.map((c) => toNum(c.high)).filter(Number.isFinite);
  const lows = slice.map((c) => toNum(c.low)).filter(Number.isFinite);
  return {
    high: highs.length ? Math.max(...highs) : null,
    low: lows.length ? Math.min(...lows) : null,
    startTime: toNum(slice[0]?.time),
    endTime: toNum(slice[slice.length - 1]?.time),
  };
}

async function fetchFmpSeries(symbol, interval) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) throw new Error('FMP_API_KEY missing');

  async function fetchAt(url, params) {
    const response = await axios.get(url, {
      params: { ...params, apikey: apiKey },
      timeout: 30000,
      validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300) return null;
    return response.data;
  }

  let payload = await fetchAt(`${FMP_BASE}/stable/historical-chart/${interval}`, { symbol });

  if (!payload && interval === '1day') {
    const end = new Date();
    const start = new Date(end.getTime() - (540 * 24 * 60 * 60 * 1000));
    const from = start.toISOString().slice(0, 10);
    const to = end.toISOString().slice(0, 10);

    payload = await fetchAt(`${FMP_BASE}/stable/historical-price-eod/full`, { symbol, from, to });
    if (!payload) payload = await fetchAt(`${FMP_BASE}/stable/historical-price-eod/light`, { symbol, from, to });
      if (!payload) payload = await fetchAt(`${FMP_BASE}/stable/historical-price-eod/full`, { symbol, from, to });
  }

  if (!payload) {
    throw new Error(`FMP historical endpoints failed for interval ${interval}`);
  }

  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.historical)
      ? payload.historical
      : [];

  return rows
    .map(normalizeCandle)
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
}

router.get('/api/candles', async (req, res) => {
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  const timeframe = String(req.query.timeframe || '1m').trim();
  const interval = mapInterval(timeframe);

  try {
    const [series, daily] = await Promise.all([
      fetchFmpSeries(symbol, interval),
      fetchFmpSeries(symbol, '1day'),
    ]);

    return res.json({
      symbol,
      timeframe,
      interval,
      candles: interval === '1day' ? daily.slice(-500) : series.slice(-2500),
      dailyCandles: daily.slice(-500),
      provider: 'fmp',
    });
  } catch (err) {
    return res.status(502).json({ error: 'Failed to fetch candles', detail: err.message });
  }
});

router.get('/api/yahoo/history', async (req, res) => {
  const symbol = (req.query.symbol || req.query.t || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  const interval = req.query.interval || '1d';
  const range = req.query.range || '1mo';
  try {
    const data = await market.getHistorical(symbol, { interval, range });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch history', detail: err.message });
  }
});

router.get('/api/indicators', async (req, res) => {
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  const timeframe = mapTimeframeLabel(req.query.timeframe || '1m');
  const interval = mapInterval(timeframe);

  try {
    const candles = await fetchFmpSeries(symbol, interval);
    const sliced = interval === '1day' ? candles.slice(-700) : candles.slice(-3000);

    const ema9 = computeEMA(sliced, 9);
    const ema10 = computeEMA(sliced, 10);
    const ema20 = computeEMA(sliced, 20);
    const ema50 = computeEMA(sliced, 50);
    const rsi14 = computeRSI(sliced, 14);
    const atr14 = computeATR(sliced, 14);
    const vwap = computeVWAP(sliced);
    const volumeMA20 = computeSMAFromCandles(sliced, 20, 'volume');

    const lastAtr = atr14.length ? toNum(atr14[atr14.length - 1]?.value) : null;
    const lastClose = sliced.length ? toNum(sliced[sliced.length - 1]?.close) : null;
    const atrPercent = Number.isFinite(lastAtr) && Number.isFinite(lastClose) && lastClose > 0
      ? (lastAtr / lastClose) * 100
      : null;

    return res.json({
      symbol,
      timeframe,
      indicators: {
        ema9,
        ema10,
        ema20,
        ema50,
        vwap,
        rsi14,
        atr14,
        volumeMA20,
      },
      stats: {
        atr: lastAtr,
        atrPercent,
      },
      provider: 'fmp',
    });
  } catch (err) {
    return res.status(502).json({ error: 'Failed to fetch indicators', detail: err.message });
  }
});

router.get('/api/levels', async (req, res) => {
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  const timeframe = mapTimeframeLabel(req.query.timeframe || '1m');
  const interval = mapInterval(timeframe);

  try {
    const [daily, intraday] = await Promise.all([
      fetchFmpSeries(symbol, '1day'),
      fetchFmpSeries(symbol, interval === '1day' ? '1min' : interval),
    ]);

    const pdh = getPreviousDailyLevel(daily, 'high');
    const pdl = getPreviousDailyLevel(daily, 'low');

    const orWindow = timeframe === '5m' ? 5 : 15;
    const openingRange = computeOpeningRange(intraday, orWindow);

    return res.json({
      symbol,
      timeframe,
      levels: {
        pdh,
        pdl,
        pmh: null,
        pml: null,
        orHigh: openingRange.high,
        orLow: openingRange.low,
        orStartTime: openingRange.startTime,
        orEndTime: openingRange.endTime,
      },
      provider: 'fmp',
    });
  } catch (err) {
    return res.status(502).json({ error: 'Failed to fetch levels', detail: err.message });
  }
});

router.get('/api/events', async (req, res) => {
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  try {
    const [newsRows, earningsResponse] = await Promise.all([
      market.getNews(symbol).catch(() => []),
      axios.get('https://financialmodelingprep.com/stable/earnings-calendar', {
        params: {
          symbol,
          limit: 8,
          apikey: process.env.FMP_API_KEY,
        },
        timeout: 30000,
        validateStatus: () => true,
      }).catch(() => ({ status: 500, data: [] })),
    ]);

    const newsEvents = (Array.isArray(newsRows) ? newsRows : [])
      .slice(0, 20)
      .map((row) => ({
        type: 'news',
        time: toSecTime(row?.datetime || row?.publishedAt || row?.time),
        title: row?.headline || row?.title || 'News',
        url: row?.url || null,
      }))
      .filter((row) => Number.isFinite(row.time));

    const earningsRows = earningsResponse.status >= 200 && earningsResponse.status < 300
      ? (Array.isArray(earningsResponse.data) ? earningsResponse.data : [])
      : [];

    const earningsEvents = earningsRows
      .slice(0, 8)
      .map((row) => ({
        type: 'earnings',
        time: toSecTime(row?.date || row?.reportDate),
        title: `${symbol} Earnings`,
        epsEstimate: toNum(row?.epsEstimated ?? row?.epsEstimate),
        epsActual: toNum(row?.eps ?? row?.epsActual),
      }))
      .filter((row) => Number.isFinite(row.time));

    return res.json({
      symbol,
      events: [...earningsEvents, ...newsEvents].sort((a, b) => a.time - b.time),
      provider: 'mixed',
    });
  } catch (err) {
    return res.status(502).json({ error: 'Failed to fetch events', detail: err.message });
  }
});

router.get('/api/yahoo/hv', async (req, res) => {
  const symbol = (req.query.symbol || req.query.t || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  const interval = req.query.interval || '1d';
  const range = req.query.range || '6mo';
  try {
    const data = await market.getHistorical(symbol, { interval, range });
    const quotes = (data.quotes || []).filter(q => q.close != null);
    if (!quotes.length) return res.status(404).json({ error: `No history for ${symbol}` });
    const closes = quotes.map(q => q.close);
    const hv = computeHVMetrics(closes);
    res.json({
      ticker: symbol,
      count: closes.length,
      ...(hv || { hvCurrent20: null, hvHigh52w: null, hvLow52w: null, hvRank: null }),
    });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch price history', detail: err.message });
  }
});

function computeHVMetrics(closes) {
  if (!closes || closes.length < 22) return null;
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > 0 && closes[i - 1] > 0) {
      returns.push(Math.log(closes[i] / closes[i - 1]));
    }
  }
  const window = 20;
  const hvValues = [];
  for (let i = window; i <= returns.length; i++) {
    const slice = returns.slice(i - window, i);
    const mean = slice.reduce((a, b) => a + b, 0) / window;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / (window - 1);
    const annualized = Math.sqrt(variance) * Math.sqrt(252);
    hvValues.push(annualized);
  }
  if (hvValues.length === 0) return null;
  const current = hvValues[hvValues.length - 1];
  const high = Math.max(...hvValues);
  const low = Math.min(...hvValues);
  const rank = high !== low ? ((current - low) / (high - low)) * 100 : 50;
  return {
    hvCurrent20: +current.toFixed(4),
    hvHigh52w: +high.toFixed(4),
    hvLow52w: +low.toFixed(4),
    hvRank: +rank.toFixed(2),
  };
}

module.exports = router;
