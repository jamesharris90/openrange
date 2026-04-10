#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../server/.env'), override: true });
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), override: false });

const API_KEY = process.env.FMP_API_KEY;
const BASE = 'https://financialmodelingprep.com/stable';

const ENDPOINTS = [
  {
    key: 'batch-exchange-quote',
    url: `${BASE}/batch-exchange-quote?exchange=NASDAQ&short=true`,
    requiredFields: ['symbol', 'price', 'volume']
  },
  {
    key: 'batch-quote',
    url: `${BASE}/batch-quote?symbols=AAPL,MSFT,NVDA,SPY,QQQ`,
    requiredFields: ['symbol', 'price', 'volume']
  },
  {
    key: 'stock-news',
    url: `${BASE}/news/stock?symbols=AAPL`,
    requiredFields: ['symbol']
  },
  {
    key: 'earnings-calendar',
    url: `${BASE}/earnings-calendar`,
    requiredFields: ['symbol']
  },
  {
    key: 'historical-chart-1min',
    url: `${BASE}/historical-chart/1min?symbol=AAPL`,
    requiredFields: ['date', 'open', 'high', 'low', 'close', 'volume']
  }
];

function normalizeArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.results)) return payload.results;
  return null;
}

async function fetchJson(url, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { signal: controller.signal });
    const raw = await res.text();
    let body;
    try {
      body = JSON.parse(raw);
    } catch (_err) {
      body = null;
    }
    return {
      status: res.status,
      body,
      ms: Date.now() - startedAt,
      error: null
    };
  } catch (err) {
    return {
      status: 0,
      body: null,
      ms: Date.now() - startedAt,
      error: err.name === 'AbortError' ? 'timeout' : (err.message || 'request_error')
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  if (!API_KEY) {
    throw new Error('FMP_API_KEY missing');
  }

  const results = [];
  let pass = true;

  for (const endpoint of ENDPOINTS) {
    const joiner = endpoint.url.includes('?') ? '&' : '?';
    const fullUrl = `${endpoint.url}${joiner}apikey=${encodeURIComponent(API_KEY)}`;
    const response = await fetchJson(fullUrl);
    const rows = normalizeArray(response.body);

    const endpointResult = {
      endpoint: endpoint.key,
      url: endpoint.url,
      http_status: response.status,
      latency_ms: response.ms,
      error: response.error,
      is_array: Array.isArray(rows),
      response_size: Array.isArray(rows) ? rows.length : 0,
      required_fields: endpoint.requiredFields,
      missing_required_fields: [],
      sample_row: Array.isArray(rows) && rows.length > 0 ? rows[0] : null,
      pass: true
    };

    if (response.status < 200 || response.status >= 300) {
      endpointResult.pass = false;
      endpointResult.error = endpointResult.error || `http_${response.status}`;
    }

    if (!Array.isArray(rows)) {
      endpointResult.pass = false;
      endpointResult.error = endpointResult.error || 'response_not_array';
    }

    if (Array.isArray(rows) && rows.length === 0) {
      endpointResult.pass = false;
      endpointResult.error = endpointResult.error || 'empty_array';
    }

    if (Array.isArray(rows) && rows.length > 0) {
      const sample = rows[0] || {};
      endpointResult.missing_required_fields = endpoint.requiredFields.filter((field) => !(field in sample));
      if (endpointResult.missing_required_fields.length > 0) {
        endpointResult.pass = false;
        endpointResult.error = endpointResult.error || 'missing_required_fields';
      }
    }

    if (!endpointResult.pass) pass = false;
    results.push(endpointResult);
  }

  const out = {
    generated_at: new Date().toISOString(),
    pass,
    endpoints: results
  };

  fs.mkdirSync(path.resolve(__dirname, '../logs'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '../logs/fmp_stable_validation.json'), JSON.stringify(out, null, 2));

  console.log('fmp stable validation written: logs/fmp_stable_validation.json');
  if (!pass) process.exit(1);
}

main().catch((err) => {
  fs.mkdirSync(path.resolve(__dirname, '../logs'), { recursive: true });
  fs.writeFileSync(
    path.resolve(__dirname, '../logs/fmp_stable_validation.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), pass: false, fatal_error: err.message }, null, 2)
  );
  console.error(err.message);
  process.exit(1);
});
