// @ts-nocheck
const axios = require('axios');
const { getSessionWindow } = require('../utils/sessionWindow.ts');

const FMP_BASE = 'https://financialmodelingprep.com';
const REQUEST_TIMEOUT_MS = 30000;

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toSecTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  const raw = String(value || '').trim();
  const parsedEt = parseEtDateTimeToMs(raw);
  const parsed = Number.isFinite(parsedEt) ? parsedEt : Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed / 1000);
}

function parseOffsetMinutes(offsetRaw) {
  const match = String(offsetRaw || '').match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
  if (!match) return null;
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  return sign * ((hours * 60) + minutes);
}

function getEtOffsetMinutes(utcMs) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'shortOffset',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date(utcMs));
  const tz = parts.find((p) => p.type === 'timeZoneName')?.value;
  return parseOffsetMinutes(tz);
}

function parseEtDateTimeToMs(raw) {
  const match = String(raw || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return NaN;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] || 0);

  const wallUtcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMinutes = getEtOffsetMinutes(wallUtcGuess);
  if (!Number.isFinite(offsetMinutes)) return NaN;

  return wallUtcGuess - (offsetMinutes * 60 * 1000);
}

function normalizeCandle(row) {
  const time = toSecTime(row?.date || row?.datetime || row?.timestamp || row?.time);
  if (!Number.isFinite(time)) return null;

  const close = toNum(row?.close) ?? toNum(row?.adjClose) ?? toNum(row?.price);
  const open = toNum(row?.open) ?? close;
  const high = toNum(row?.high) ?? close;
  const low = toNum(row?.low) ?? close;
  const volume = toNum(row?.volume) ?? 0;

  if ([open, high, low, close].some((v) => v == null)) return null;

  return { time, open, high, low, close, volume };
}

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.historical)) return payload.historical;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function sortCandles(candles) {
  return [...candles].sort((a, b) => a.time - b.time);
}

async function fetchStable(endpoint, params = {}) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) throw new Error('FMP_API_KEY missing');

  const response = await axios.get(`${FMP_BASE}${endpoint}`, {
    params: { ...params, apikey: apiKey },
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`FMP ${endpoint} failed with status ${response.status}`);
  }

  return response.data;
}

async function fetchNonStableIntraday(symbol, session) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) throw new Error('FMP_API_KEY missing');

  const endpoint = `/api/v3/historical-chart/1min/${encodeURIComponent(symbol)}`;
  const params = { from: session.from, to: session.to, apikey: apiKey };

  const response = await axios.get(`${FMP_BASE}${endpoint}`, {
    params,
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`FMP ${endpoint} failed with status ${response.status}`);
  }

  return {
    endpoint,
    params,
    data: response.data,
  };
}

function computeVWAP(candles) {
  const out = [];
  let cumulativePV = 0;
  let cumulativeVolume = 0;

  for (const candle of candles) {
    const typical = (candle.high + candle.low + candle.close) / 3;
    const volume = Number.isFinite(candle.volume) ? candle.volume : 0;

    cumulativePV += typical * volume;
    cumulativeVolume += volume;

    if (cumulativeVolume > 0) {
      out.push({ time: candle.time, value: cumulativePV / cumulativeVolume });
    }
  }

  return out;
}

function computeATR(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < 2) return [];

  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const prev = candles[i - 1];

    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prev.close),
      Math.abs(current.low - prev.close)
    );

    trs.push({ time: current.time, tr });
  }

  const out = [];
  let atr = null;
  for (let i = 0; i < trs.length; i++) {
    if (i < period - 1) continue;
    if (i === period - 1) {
      atr = trs.slice(0, period).reduce((sum, row) => sum + row.tr, 0) / period;
    } else {
      atr = ((atr * (period - 1)) + trs[i].tr) / period;
    }
    out.push({ time: trs[i].time, value: atr });
  }

  return out;
}

function computeAtrPercent(candles, atrSeries) {
  if (!Array.isArray(candles) || !Array.isArray(atrSeries) || !atrSeries.length) return null;
  const atrPoint = atrSeries[atrSeries.length - 1];
  if (!atrPoint) return null;

  const candle = candles.find((c) => c.time === atrPoint.time) || candles[candles.length - 1];
  const close = toNum(candle?.close);
  if (!Number.isFinite(close) || close <= 0) return null;

  const atr = toNum(atrPoint.value);
  if (!Number.isFinite(atr)) return null;

  return (atr / close) * 100;
}

function aggregateCandles(candles, minutes) {
  if (!Array.isArray(candles) || !candles.length) return [];
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

function dedupeAndSortCandles(candles) {
  const byTime = new Map();
  for (const candle of candles) {
    if (!Number.isFinite(candle?.time)) continue;
    byTime.set(candle.time, candle);
  }
  return sortCandles(Array.from(byTime.values()));
}

async function fetchIntraday(symbol, interval) {
  const endpoint = `/stable/historical-chart/${interval}`;

  if (interval === '1min') {
    const sessions = getSessionWindow(3);
    let collected = [];

    for (const session of sessions) {
      const stableParams = { symbol, from: session.from, to: session.to };
      const stablePayload = await fetchStable(endpoint, stableParams);
      const stableRows = asArray(stablePayload);

      let selectedRows = stableRows;

      try {
        const nonStable = await fetchNonStableIntraday(symbol, session);
        const nonStableRows = asArray(nonStable.data);
        if (nonStableRows.length > stableRows.length) {
          selectedRows = nonStableRows;
        }
      } catch (_error) {
      }

      const rows = selectedRows.map(normalizeCandle).filter(Boolean);
      collected = collected.concat(rows);
    }

    return dedupeAndSortCandles(collected);
  }

  const params = { symbol };
  const payload = await fetchStable(endpoint, params);
  const rawRows = asArray(payload);
  const rows = rawRows.map(normalizeCandle).filter(Boolean);
  return sortCandles(rows);
}

async function enrichWithIntraday(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) throw new Error('symbol is required');

  const intraday1m = await fetchIntraday(sym, '1min');
  const intraday3m = intraday1m.length ? aggregateCandles(intraday1m, 3) : [];
  const intraday5m = intraday1m.length ? aggregateCandles(intraday1m, 5) : await fetchIntraday(sym, '5min');
  const intraday15m = intraday1m.length ? aggregateCandles(intraday1m, 15) : [];
  const intraday1h = intraday1m.length ? aggregateCandles(intraday1m, 60) : [];
  const intraday4h = intraday1m.length ? aggregateCandles(intraday1m, 240) : [];

  const vwap = computeVWAP(intraday1m);

  const orbWindow = intraday1m.slice(0, Math.min(15, intraday1m.length));
  const fallbackWindow = intraday1m.slice(0, Math.min(5, intraday1m.length));
  const sourceWindow = orbWindow.length ? orbWindow : fallbackWindow;
  const orh = sourceWindow.length ? Math.max(...sourceWindow.map((c) => c.high)) : null;

  const currentVolume = intraday1m.length ? Number(intraday1m[intraday1m.length - 1].volume || 0) : null;
  const priorVolumes = intraday1m.slice(-31, -1).map((c) => Number(c.volume || 0)).filter((v) => Number.isFinite(v));
  const rollingAvgVolume = priorVolumes.length
    ? (priorVolumes.reduce((sum, value) => sum + value, 0) / priorVolumes.length)
    : null;
  const relativeVolume = Number.isFinite(currentVolume) && Number.isFinite(rollingAvgVolume) && rollingAvgVolume > 0
    ? currentVolume / rollingAvgVolume
    : null;

  const atrSeries = computeATR(intraday1m, 14);
  const atrPercent = computeAtrPercent(intraday1m, atrSeries);
  const sessionMinute = intraday1m.length ? Math.min(intraday1m.length, 390) : 0;

  return {
    intraday1m,
    intraday3m,
    intraday5m,
    intraday15m,
    intraday1h,
    intraday4h,
    vwap,
    orh,
    relativeVolume,
    atrPercent,
    sessionMinute,
  };
}

module.exports = {
  enrichWithIntraday,
};
