const fs = require('fs');
const path = require('path');

const OUTPUT_PATH = path.join(__dirname, 'endpoint_validation.json');

const endpoints = [
  'http://127.0.0.1:3007/api/screener',
  'http://127.0.0.1:3007/api/intelligence/decision/NVDA',
  'http://127.0.0.1:3007/api/intelligence/top-opportunities?limit=5',
  'http://127.0.0.1:3007/api/market/overview',
  'http://127.0.0.1:3007/api/earnings',
  'http://127.0.0.1:3007/api/research/INTC/full',
  'http://127.0.0.1:3007/api/v5/chart?symbol=INTC&interval=1day',
];

function summarizePayload(url, payload) {
  const summary = {
    top_level_keys: payload && typeof payload === 'object' && !Array.isArray(payload)
      ? Object.keys(payload).slice(0, 20)
      : [],
  };

  if (url.includes('/api/research/INTC/full')) {
    summary.research = {
      bias: payload?.decision?.bias ?? null,
      entry: payload?.decision?.execution_plan?.entry ?? null,
      stop: payload?.decision?.execution_plan?.stop ?? null,
      target: payload?.decision?.execution_plan?.target ?? null,
      dividend_yield_percent: payload?.scanner?.fundamentals?.dividend_yield_percent ?? null,
      short_float_percent: payload?.scanner?.market_structure?.short_float_percent ?? null,
      put_call_ratio: payload?.scanner?.options_flow?.put_call_ratio ?? null,
      earnings_read: payload?.earnings?.read ?? null,
      earnings_edge_read: payload?.earningsEdge?.read ?? null,
    };
  }

  if (url.includes('/api/v5/chart')) {
    summary.chart = {
      candles: Array.isArray(payload?.candles) ? payload.candles.length : 0,
      dailyCandles: Array.isArray(payload?.dailyCandles) ? payload.dailyCandles.length : 0,
      indicator_keys: payload?.indicators ? Object.keys(payload.indicators).slice(0, 10) : [],
    };
  }

  if (url.includes('/api/earnings')) {
    summary.earnings = {
      row_count: Array.isArray(payload?.data) ? payload.data.length : Array.isArray(payload) ? payload.length : 0,
    };
  }

  if (url.includes('/api/screener')) {
    summary.screener = {
      row_count: Array.isArray(payload?.data) ? payload.data.length : 0,
    };
  }

  if (url.includes('/api/intelligence/top-opportunities')) {
    summary.top_opportunities = {
      row_count: Array.isArray(payload?.data) ? payload.data.length : 0,
    };
  }

  return summary;
}

async function hitEndpoint(url) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(25000),
    });
    const raw = await response.text();
    let payload = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = raw;
    }

    return {
      url,
      status: response.status,
      ok: response.ok,
      elapsed_ms: Date.now() - startedAt,
      ...summarizePayload(url, payload),
    };
  } catch (error) {
    return {
      url,
      status: 0,
      ok: false,
      elapsed_ms: Date.now() - startedAt,
      error: error.message,
    };
  }
}

async function main() {
  const results = [];
  for (const url of endpoints) {
    results.push(await hitEndpoint(url));
  }

  const report = {
    generated_at: new Date().toISOString(),
    ok: results.every((result) => result.ok),
    results,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const report = {
    generated_at: new Date().toISOString(),
    ok: false,
    error: error.message,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  console.error(error);
  process.exit(1);
});