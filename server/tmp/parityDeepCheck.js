const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
}

const LOCAL_BASE = String(process.env.PARITY_LOCAL_BASE || 'http://localhost:3007').replace(/\/$/, '');
const PRODUCTION_BASE = String(process.env.PARITY_PRODUCTION_BASE || 'https://openrangetrading.co.uk').replace(/\/$/, '');
const TARGET_SYMBOL = String(process.env.PARITY_SYMBOL || 'AAPL').trim().toUpperCase();
const TIMEOUT_MS = Math.max(1000, Number(process.env.PARITY_TIMEOUT_MS) || 10000);

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

async function fetchJson(baseUrl, route) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${baseUrl}${route}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    const bodyText = await response.text();
    let json = null;
    try {
      json = JSON.parse(bodyText);
    } catch {
      json = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      elapsed_ms: Date.now() - startedAt,
      json,
      preview: bodyText.slice(0, 300),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      elapsed_ms: Date.now() - startedAt,
      json: null,
      error: error.name === 'AbortError' ? 'timeout' : error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractRows(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  if (Array.isArray(payload?.rows)) {
    return payload.rows;
  }
  if (Array.isArray(payload?.history)) {
    return payload.history;
  }
  if (payload?.next) {
    return [payload.next, ...(Array.isArray(payload.history) ? payload.history : [])];
  }
  return [];
}

function compareScreener(localRows, productionRows) {
  const localBySymbol = new Map(localRows.map((row) => [normalizeSymbol(row.symbol), row]));
  const prodBySymbol = new Map(productionRows.map((row) => [normalizeSymbol(row.symbol), row]));
  const localSymbols = new Set(localBySymbol.keys());
  const prodSymbols = new Set(prodBySymbol.keys());
  const missingInLocal = [...prodSymbols].filter((symbol) => !localSymbols.has(symbol)).slice(0, 100);
  const missingInProduction = [...localSymbols].filter((symbol) => !prodSymbols.has(symbol)).slice(0, 100);
  const mismatchedValues = [];

  for (const symbol of localSymbols) {
    if (!prodBySymbol.has(symbol)) {
      continue;
    }
    const local = localBySymbol.get(symbol);
    const production = prodBySymbol.get(symbol);
    const priceDiff = Math.abs((toNumber(local?.price) || 0) - (toNumber(production?.price) || 0));
    const volumeDiff = Math.abs((toNumber(local?.volume) || 0) - (toNumber(production?.volume) || 0));
    const coverageMismatch = String(local?.coverage_status || '') !== String(production?.coverage_status || '');
    if (priceDiff > 0.01 || volumeDiff > 0 || coverageMismatch) {
      mismatchedValues.push({
        symbol,
        local: {
          price: toNumber(local?.price),
          volume: toNumber(local?.volume),
          coverage_status: local?.coverage_status || null,
        },
        production: {
          price: toNumber(production?.price),
          volume: toNumber(production?.volume),
          coverage_status: production?.coverage_status || null,
        },
      });
    }
    if (mismatchedValues.length >= 100) {
      break;
    }
  }

  return {
    local_count: localRows.length,
    production_count: productionRows.length,
    row_count_delta: localRows.length - productionRows.length,
    missing_in_local: missingInLocal,
    missing_in_production: missingInProduction,
    mismatched_values: mismatchedValues,
  };
}

function compareCollection(localRows, productionRows, keyFn, sampleFields) {
  const localByKey = new Map(localRows.map((row) => [keyFn(row), row]));
  const prodByKey = new Map(productionRows.map((row) => [keyFn(row), row]));
  const localKeys = new Set(localByKey.keys());
  const prodKeys = new Set(prodByKey.keys());
  const missingInLocal = [...prodKeys].filter((key) => !localKeys.has(key)).slice(0, 100);
  const missingInProduction = [...localKeys].filter((key) => !prodKeys.has(key)).slice(0, 100);
  const mismatchedValues = [];

  for (const key of localKeys) {
    if (!prodByKey.has(key)) {
      continue;
    }
    const local = localByKey.get(key);
    const production = prodByKey.get(key);
    const mismatch = sampleFields.some((field) => String(local?.[field] || '') !== String(production?.[field] || ''));
    if (mismatch) {
      mismatchedValues.push({
        key,
        local: Object.fromEntries(sampleFields.map((field) => [field, local?.[field] ?? null])),
        production: Object.fromEntries(sampleFields.map((field) => [field, production?.[field] ?? null])),
      });
    }
    if (mismatchedValues.length >= 100) {
      break;
    }
  }

  return {
    local_count: localRows.length,
    production_count: productionRows.length,
    row_count_delta: localRows.length - productionRows.length,
    missing_in_local: missingInLocal,
    missing_in_production: missingInProduction,
    mismatched_values: mismatchedValues,
  };
}

function compareResearch(localPayload, productionPayload) {
  const local = localPayload?.data || {};
  const production = productionPayload?.data || {};
  return {
    symbol: TARGET_SYMBOL,
    mismatched_values: {
      price: {
        local: toNumber(local?.market?.price),
        production: toNumber(production?.market?.price),
      },
      news_count: {
        local: Array.isArray(local?.news) ? local.news.length : 0,
        production: Array.isArray(production?.news) ? production.news.length : 0,
      },
      coverage_score: {
        local: toNumber(local?.score?.coverage_score),
        production: toNumber(production?.score?.coverage_score),
      },
    },
  };
}

async function compareEndpoint(name, route, compareFn) {
  const [local, production] = await Promise.all([
    fetchJson(LOCAL_BASE, route),
    fetchJson(PRODUCTION_BASE, route),
  ]);

  return {
    endpoint: name,
    route,
    local: {
      ok: local.ok,
      status: local.status,
      elapsed_ms: local.elapsed_ms,
      error: local.error || null,
    },
    production: {
      ok: production.ok,
      status: production.status,
      elapsed_ms: production.elapsed_ms,
      error: production.error || null,
    },
    comparison: local.json && production.json ? compareFn(local.json, production.json) : null,
  };
}

async function main() {
  const results = await Promise.all([
    compareEndpoint('screener', '/api/screener', (local, production) => compareScreener(extractRows(local), extractRows(production))),
    compareEndpoint('earnings', '/api/earnings', (local, production) => compareCollection(
      extractRows(local),
      extractRows(production),
      (row) => `${normalizeSymbol(row.symbol)}::${String(row.report_date || '')}`,
      ['symbol', 'report_date', 'report_time', 'eps_estimate', 'eps_actual']
    )),
    compareEndpoint('news', `/api/news?symbol=${encodeURIComponent(TARGET_SYMBOL)}`, (local, production) => compareCollection(
      extractRows(local),
      extractRows(production),
      (row) => `${normalizeSymbol(row.symbol)}::${String(row.published_at || row.publishedAt || '')}::${String(row.headline || row.title || '')}`,
      ['symbol', 'published_at', 'publishedAt', 'headline', 'title']
    )),
    compareEndpoint('research', `/api/v2/research/${encodeURIComponent(TARGET_SYMBOL)}`, compareResearch),
  ]);

  const report = {
    checked_at: new Date().toISOString(),
    local_base: LOCAL_BASE,
    production_base: PRODUCTION_BASE,
    symbol: TARGET_SYMBOL,
    results,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, checked_at: new Date().toISOString() }, null, 2));
  process.exit(1);
});