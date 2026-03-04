#!/usr/bin/env node

const SUPPORTED_INTERVALS = ['1min', '3min', '5min', '15min', '1hour', '4hour', '1day'];
const BASE_URL = process.env.CANDLE_AUDIT_BASE_URL || 'http://localhost:3000/api/v5';

function getExpectedIntervalMinutes(tf) {
  const map = {
    '1min': 1,
    '3min': 3,
    '5min': 5,
    '15min': 15,
    '1hour': 60,
    '4hour': 240,
    '1day': 1440,
  };
  return map[tf] || 1;
}

function normalizeToArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.candles)) return payload.candles;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.historical)) return payload.historical;
  return [];
}

function toMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function toEtParts(ms) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(ms));
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    dateKey: `${map.year}-${map.month}-${map.day}`,
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

function etMinuteOfDay(ms) {
  const p = toEtParts(ms);
  return (p.hour * 60) + p.minute;
}

function detectGaps(candles, timeframe, label) {
  let missingCount = 0;
  const expected = getExpectedIntervalMinutes(timeframe);

  for (let i = 1; i < candles.length; i += 1) {
    const prevRaw = candles[i - 1]?.time ?? candles[i - 1]?.date ?? candles[i - 1]?.datetime ?? candles[i - 1]?.timestamp;
    const currRaw = candles[i]?.time ?? candles[i]?.date ?? candles[i]?.datetime ?? candles[i]?.timestamp;

    const prev = toMs(prevRaw);
    const curr = toMs(currRaw);
    if (!Number.isFinite(prev) || !Number.isFinite(curr)) continue;

    const diffMinutes = (curr - prev) / 60000;
    const prevEt = toEtParts(prev);
    const currEt = toEtParts(curr);

    if (timeframe !== '1day' && prevEt.dateKey !== currEt.dateKey) {
      continue;
    }
    if (diffMinutes !== expected) {
      console.log(`⚠ Gap detected (${label}) at index ${i}`);
      console.log(`Previous: ${new Date(prev).toISOString()}`);
      console.log(`Current : ${new Date(curr).toISOString()}`);
      console.log(`Gap     : ${diffMinutes} minutes (expected ${expected})`);
      missingCount += 1;
    }
  }

  return missingCount;
}

async function safeFetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} for ${url}${txt ? `: ${txt.slice(0, 300)}` : ''}`);
  }
  return res.json();
}

async function audit(symbol, timeframe) {
  console.log(`\n=== Candle Audit for ${symbol} (${timeframe}) ===`);
  console.log(`Supported intervals: ${SUPPORTED_INTERVALS.join(', ')}`);

  const endpoint = `${BASE_URL}/chart?symbol=${symbol}&interval=${timeframe}`;
  console.log(`Endpoint Used: ${endpoint}`);

  const payload = await safeFetchJson(endpoint);
  const backendCandles = normalizeToArray(payload);

  if (!Array.isArray(backendCandles)) {
    console.error('Invalid response format');
    return;
  }

  console.log(`Total candles returned: ${backendCandles.length}`);

  if (backendCandles.length === 0) {
    console.warn('No candles returned.');
    return;
  }

  const firstMs = toMs(backendCandles[0]?.time ?? backendCandles[0]?.date ?? backendCandles[0]?.datetime ?? backendCandles[0]?.timestamp);
  const firstEtMinute = Number.isFinite(firstMs) ? etMinuteOfDay(firstMs) : NaN;
  const firstEtHour = Number.isFinite(firstEtMinute) ? Math.floor(firstEtMinute / 60) : NaN;
  const firstEtMin = Number.isFinite(firstEtMinute) ? firstEtMinute % 60 : NaN;
  console.log(`Earliest candle (UTC): ${Number.isFinite(firstMs) ? new Date(firstMs).toISOString() : 'N/A'}`);
  console.log(`Earliest candle (ET): ${Number.isFinite(firstEtHour) ? `${String(firstEtHour).padStart(2, '0')}:${String(firstEtMin).padStart(2, '0')}` : 'N/A'}`);

  const backendGapCount = detectGaps(backendCandles, timeframe, 'backend');
  console.log(`Total gaps detected: ${backendGapCount}`);

  if (timeframe === '1min') {
    if (backendCandles.length < 500 || (Number.isFinite(firstEtMinute) && firstEtMinute >= (9 * 60 + 30))) {
      console.log('VALIDATION HALT: Extended session not included. Check provider parameters.');
    }
  }

  const fmpBase = process.env.FMP_BASE_URL || 'https://financialmodelingprep.com';
  const fmpKey = process.env.FMP_API_KEY;

  if (!fmpKey) {
    console.log('Origin analysis skipped: FMP_API_KEY not set in environment.');
    return;
  }

  try {
    const intervalForSource = timeframe === '1day' ? '1day' : '1min';
    const providerUrl = `${fmpBase}/stable/historical-chart/${intervalForSource}?symbol=${symbol}&apikey=${fmpKey}`;
    console.log(`Provider endpoint inspected: ${providerUrl.replace(fmpKey, '***')}`);

    const providerPayload = await safeFetchJson(providerUrl);
    const providerCandles = normalizeToArray(providerPayload)
      .sort((a, b) => toMs(a?.time ?? a?.date ?? a?.datetime ?? a?.timestamp) - toMs(b?.time ?? b?.date ?? b?.datetime ?? b?.timestamp));

    const sourceGapCount = detectGaps(providerCandles, intervalForSource, 'provider');

    if (sourceGapCount > 0) {
      console.log('Gap origin assessment: likely upstream API response gaps.');
    } else if (backendGapCount > 0 && timeframe !== '1day') {
      console.log('Gap origin assessment: likely backend aggregation/interval handling.');
    } else if (backendGapCount === 0) {
      console.log('Gap origin assessment: backend output contiguous; investigate frontend filtering if chart still shows gaps.');
    }
  } catch (err) {
    console.warn(`Origin analysis unavailable: ${err.message}`);
  }
}

const symbol = String(process.argv[2] || 'AAPL').toUpperCase();
const timeframe = String(process.argv[3] || '1min');

audit(symbol, timeframe).catch((error) => {
  console.error('Audit failed:', error.message);
  process.exitCode = 1;
});
