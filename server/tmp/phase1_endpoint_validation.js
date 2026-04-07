const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.VALIDATION_BASE_URL || 'http://127.0.0.1:3007';
const OUTPUT_PATH = process.env.VALIDATION_OUTPUT_PATH || path.resolve(__dirname, '../../logs/endpoint_validation.json');

function abortableFetch(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

function summarizeBody(body) {
  if (Array.isArray(body)) {
    return {
      kind: 'array',
      length: body.length,
      sample_keys: body[0] && typeof body[0] === 'object' ? Object.keys(body[0]).slice(0, 12) : [],
    };
  }

  if (body && typeof body === 'object') {
    const topLevelKeys = Object.keys(body);
    const summary = {
      kind: 'object',
      top_level_keys: topLevelKeys,
    };

    if (Array.isArray(body.data)) {
      summary.data_length = body.data.length;
      summary.data_sample_keys = body.data[0] && typeof body.data[0] === 'object'
        ? Object.keys(body.data[0]).slice(0, 12)
        : [];
    }

    if (Array.isArray(body.items)) {
      summary.items_length = body.items.length;
      summary.items_sample_keys = body.items[0] && typeof body.items[0] === 'object'
        ? Object.keys(body.items[0]).slice(0, 12)
        : [];
    }

    return summary;
  }

  return {
    kind: typeof body,
    value: body,
  };
}

async function checkEndpoint(endpoint, expectedStatus = 200) {
  const url = `${BASE_URL}${endpoint}`;
  const startedAt = Date.now();

  try {
    const response = await abortableFetch(url, 30000);
    const text = await response.text();
    let body = null;

    try {
      body = text ? JSON.parse(text) : null;
    } catch (_error) {
      body = { raw: text.slice(0, 1000) };
    }

    return {
      endpoint,
      url,
      ok: response.status === expectedStatus,
      status: response.status,
      runtime_ms: Date.now() - startedAt,
      summary: summarizeBody(body),
    };
  } catch (error) {
    return {
      endpoint,
      url,
      ok: false,
      status: null,
      runtime_ms: Date.now() - startedAt,
      error: error.name === 'AbortError' ? 'timeout' : error.message,
    };
  }
}

async function main() {
  const endpoints = [
    '/api/health',
    '/api/screener?limit=5',
    '/api/intelligence/decision/AAPL',
    '/api/intelligence/top-opportunities?limit=5',
    '/api/market/overview',
    '/api/earnings',
  ];

  const results = [];
  for (const endpoint of endpoints) {
    results.push(await checkEndpoint(endpoint));
  }

  const report = {
    base_url: BASE_URL,
    checked_at: new Date().toISOString(),
    all_ok: results.every((result) => result.ok),
    results,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  const failure = {
    ok: false,
    error: error.message,
    checked_at: new Date().toISOString(),
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(failure, null, 2));
  console.log(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
});