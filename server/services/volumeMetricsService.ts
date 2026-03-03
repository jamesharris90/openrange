// @ts-nocheck
const axios = require('axios');

const STABLE_BASE_URL = 'https://financialmodelingprep.com/stable/historical-chart/1day';
const V3_BASE_URL = 'https://financialmodelingprep.com/api/v3/historical-chart/1day';
const STABLE_EOD_LIGHT_URL = 'https://financialmodelingprep.com/stable/historical-price-eod/light';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;

const avgVolumeCache = new Map();
const inFlight = new Map();

function toUpper(value) {
  return String(value || '').trim().toUpperCase();
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isFresh(entry) {
  return entry && Date.now() - entry.ts < CACHE_TTL_MS;
}

async function fetchHistoricalRows(baseUrl, symbol) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    throw new Error('FMP_API_KEY missing for volume metrics');
  }

  const response = await axios.get(`${baseUrl}/${symbol}`, {
    params: {
      limit: 30,
      apikey: apiKey,
    },
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) return [];

  const rows = Array.isArray(response.data) ? response.data : [];
  return rows;
}

async function fetchHistoricalEodLightRows(symbol) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    throw new Error('FMP_API_KEY missing for volume metrics');
  }

  const to = new Date();
  const from = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
  const fmt = (value) => value.toISOString().slice(0, 10);

  const response = await axios.get(STABLE_EOD_LIGHT_URL, {
    params: {
      symbol,
      from: fmt(from),
      to: fmt(to),
      apikey: apiKey,
    },
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) return [];
  return Array.isArray(response.data) ? response.data : [];
}

async function fetchAverageVolume(symbol) {
  let rows = await fetchHistoricalRows(STABLE_BASE_URL, symbol);
  if (!rows.length) {
    rows = await fetchHistoricalRows(V3_BASE_URL, symbol);
  }
  if (!rows.length) {
    rows = await fetchHistoricalEodLightRows(symbol);
  }

  const volumes = rows
    .map((row) => toNumber(row?.volume))
    .filter((v) => Number.isFinite(v) && v > 0);

  const latest30 = volumes.slice(0, 30);

  if (!latest30.length) {
    return null;
  }

  const sum = latest30.reduce((acc, value) => acc + value, 0);
  return sum / latest30.length;
}

async function getAverageVolume(symbolInput) {
  const symbol = toUpper(symbolInput);
  if (!symbol) return null;

  const cached = avgVolumeCache.get(symbol);
  if (isFresh(cached)) {
    return cached.avgVolume;
  }

  if (inFlight.has(symbol)) {
    return inFlight.get(symbol);
  }

  const promise = (async () => {
    try {
      const avgVolume = await fetchAverageVolume(symbol);
      avgVolumeCache.set(symbol, {
        avgVolume,
        ts: Date.now(),
      });
      return avgVolume;
    } finally {
      inFlight.delete(symbol);
    }
  })();

  inFlight.set(symbol, promise);
  return promise;
}

async function refreshAverageVolumes(symbols) {
  const list = Array.isArray(symbols) ? symbols : [];
  for (const symbol of list) {
    try {
      await getAverageVolume(symbol);
    } catch (error) {
      console.warn('[volumeMetricsService] refresh failed', {
        symbol,
        message: error?.message,
      });
    }
  }
}

module.exports = {
  getAverageVolume,
  refreshAverageVolumes,
};
