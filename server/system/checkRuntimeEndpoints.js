const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

function buildHeaders() {
  const headers = { Accept: 'application/json' };
  if (process.env.PROXY_API_KEY) {
    headers['x-api-key'] = process.env.PROXY_API_KEY;
  }
  return headers;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: buildHeaders() });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function checkEndpoint(name, url, validate) {
  const startedAt = Date.now();
  try {
    const { response, payload } = await fetchJson(url);
    const ok = response.ok && validate(payload, response);
    return {
      name,
      ok,
      detail: {
        url,
        status: response.status,
        elapsed_ms: Date.now() - startedAt,
        message: ok ? 'ok' : 'validation_failed',
      },
    };
  } catch (error) {
    return {
      name,
      ok: false,
      detail: {
        url,
        elapsed_ms: Date.now() - startedAt,
        message: error.message,
      },
    };
  }
}

function hasPopulatedTables(value) {
  return value && typeof value === 'object' && Object.keys(value).length > 0;
}

async function main() {
  const baseUrl = process.env.RUNTIME_CHECK_BASE_URL || process.env.API_BASE || 'http://127.0.0.1:3001';
  const results = [];

  results.push(await checkEndpoint('api.health', `${baseUrl}/api/health`, (payload) => {
    return String(payload?.status || '').toLowerCase() === 'ok'
      && payload?.data_health?.timeout !== true
      && hasPopulatedTables(payload?.data_health?.tables);
  }));

  results.push(await checkEndpoint('api.system.data_integrity', `${baseUrl}/api/system/data-integrity`, (payload) => {
    const tables = Array.isArray(payload?.tables) ? payload.tables : [];
    const intraday = tables.find((table) => table.table === 'intraday_1m');
    const daily = tables.find((table) => table.table === 'daily_ohlc');

    return tables.length > 0
      && Boolean(intraday?.latest_timestamp)
      && Boolean(daily?.latest_timestamp)
      && intraday?.latest_timestamp_error == null
      && daily?.latest_timestamp_error == null;
  }));

  results.push(await checkEndpoint('api.market.overview', `${baseUrl}/api/market/overview`, (payload) => {
    return payload
      && payload?.data
      && payload?.data?.source !== 'timeout_fallback'
      && payload?.meta?.reason !== 'timeout';
  }));

  results.push(await checkEndpoint('api.news', `${baseUrl}/api/news?limit=10`, (payload) => {
    return payload
      && payload?.success === true
      && Array.isArray(payload?.data)
      && payload.data.length > 0;
  }));

  results.push(await checkEndpoint('api.earnings.calendar', `${baseUrl}/api/earnings/calendar?from=2026-04-19&to=2026-05-31&limit=20`, (payload) => {
    return payload
      && payload?.success === true
      && Array.isArray(payload?.data)
      && payload.data.length > 0;
  }));

  results.push(await checkEndpoint('api.v2.research.fast', `${baseUrl}/api/v2/research/TSLA?fast=true`, (payload) => {
    return payload
      && payload?.success === true
      && payload?.data
      && payload?.data?.company?.company_name
      && payload?.data?.earnings?.next?.report_date
      && Array.isArray(payload?.data?.news);
  }));

  const failures = results.filter((result) => !result.ok);
  console.log(JSON.stringify({
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    ok: failures.length === 0,
    results,
  }, null, 2));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[RUNTIME_ENDPOINT_CHECK] fatal', error.message);
  process.exitCode = 1;
});