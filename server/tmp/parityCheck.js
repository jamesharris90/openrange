require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const DEFAULT_LOCAL_BASE = process.env.PARITY_LOCAL_BASE || 'http://127.0.0.1:3007';
const DEFAULT_PRODUCTION_BASE = process.env.PARITY_PRODUCTION_BASE || 'https://openrangetrading.co.uk';
const DEFAULT_TIMEOUT_MS = Math.max(1000, Number(process.env.PARITY_TIMEOUT_MS) || 8000);
const TARGET_SYMBOL = (process.env.PARITY_SYMBOL || 'AAPL').trim().toUpperCase();

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function absoluteDelta(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return null;
  }

  return Math.abs(left - right);
}

function percentDelta(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return null;
  }

  const denominator = Math.max(Math.abs(right), 1e-9);
  return Number((((left - right) / denominator) * 100).toFixed(2));
}

async function fetchJson(baseUrl, path) {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_error) {
      json = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      elapsed_ms: Date.now() - startedAt,
      json,
      body_preview: text.slice(0, 300),
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

  if (Array.isArray(payload?.results)) {
    return payload.results;
  }

  if (Array.isArray(payload?.news)) {
    return payload.news;
  }

  return [];
}

function findSymbolRow(rows, symbol) {
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  return rows.find((row) => String(row?.symbol || '').trim().toUpperCase() === normalizedSymbol) || null;
}

function summarizeScreener(payload, symbol) {
  const rows = extractRows(payload);
  const row = findSymbolRow(rows, symbol);
  return {
    row_count: rows.length,
    symbol,
    sample: row ? {
      price: toNumber(row.price),
      volume: toNumber(row.volume),
      news_count: toNumber(row.news_count ?? row.newsCount ?? row.news_count_7d),
      coverage_status: row.coverage_status || null,
    } : null,
  };
}

function summarizeResearch(payload) {
  const data = payload?.data || payload || {};
  const market = data.market || {};
  const news = Array.isArray(data.news) ? data.news : [];
  return {
    row_count: news.length,
    sample: {
      price: toNumber(market.price),
      volume: toNumber(market.volume),
      news_count: news.length,
    },
  };
}

function summarizeEarnings(payload) {
  const rows = extractRows(payload);
  const first = rows[0] || null;
  return {
    row_count: rows.length,
    sample: first ? {
      symbol: first.symbol || null,
      price: toNumber(first.price),
      volume: toNumber(first.volume),
      news_count: toNumber(first.news_count ?? first.newsCount),
    } : null,
  };
}

function summarizeNews(payload, symbol) {
  const rows = extractRows(payload);
  const symbolRows = rows.filter((row) => String(row?.symbol || '').trim().toUpperCase() === symbol);
  return {
    row_count: rows.length,
    symbol_count: symbolRows.length,
    sample: symbolRows[0] ? {
      symbol: symbolRows[0].symbol || null,
      published_at: symbolRows[0].published_at || symbolRows[0].publishedAt || null,
      headline: symbolRows[0].headline || symbolRows[0].title || null,
    } : null,
  };
}

function diffSummaries(local, production) {
  const localSample = local?.sample || null;
  const productionSample = production?.sample || null;

  return {
    row_count_delta: Number(local?.row_count || 0) - Number(production?.row_count || 0),
    price_delta: absoluteDelta(toNumber(localSample?.price), toNumber(productionSample?.price)),
    price_delta_percent: percentDelta(toNumber(localSample?.price), toNumber(productionSample?.price)),
    volume_delta: absoluteDelta(toNumber(localSample?.volume), toNumber(productionSample?.volume)),
    volume_delta_percent: percentDelta(toNumber(localSample?.volume), toNumber(productionSample?.volume)),
    news_count_delta: Number(localSample?.news_count || 0) - Number(productionSample?.news_count || 0),
  };
}

async function compareEndpoint(name, path, summarizer) {
  const [local, production] = await Promise.all([
    fetchJson(DEFAULT_LOCAL_BASE, path),
    fetchJson(DEFAULT_PRODUCTION_BASE, path),
  ]);

  const localSummary = local.json ? summarizer(local.json) : null;
  const productionSummary = production.json ? summarizer(production.json) : null;

  return {
    endpoint: name,
    path,
    local: {
      ok: local.ok,
      status: local.status,
      elapsed_ms: local.elapsed_ms,
      error: local.error || null,
      body_preview: local.body_preview,
    },
    production: {
      ok: production.ok,
      status: production.status,
      elapsed_ms: production.elapsed_ms,
      error: production.error || null,
      body_preview: production.body_preview,
    },
    local_summary: localSummary,
    production_summary: productionSummary,
    differences: local.json && production.json
      ? diffSummaries(localSummary, productionSummary)
      : null,
  };
}

async function main() {
  const endpoints = [
    {
      name: 'screener',
      path: '/api/screener',
      summarizer: (payload) => summarizeScreener(payload, TARGET_SYMBOL),
    },
    {
      name: 'research',
      path: `/api/v2/research/${encodeURIComponent(TARGET_SYMBOL)}`,
      summarizer: summarizeResearch,
    },
    {
      name: 'earnings',
      path: '/api/earnings',
      summarizer: summarizeEarnings,
    },
    {
      name: 'news',
      path: `/api/news?symbol=${encodeURIComponent(TARGET_SYMBOL)}`,
      summarizer: (payload) => summarizeNews(payload, TARGET_SYMBOL),
    },
  ];

  const results = [];
  for (const endpoint of endpoints) {
    results.push(await compareEndpoint(endpoint.name, endpoint.path, endpoint.summarizer));
  }

  const ok = results.every((result) => result.local.ok && result.production.ok);
  const report = {
    ok,
    checked_at: new Date().toISOString(),
    local_base: DEFAULT_LOCAL_BASE,
    production_base: DEFAULT_PRODUCTION_BASE,
    symbol: TARGET_SYMBOL,
    results,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, checked_at: new Date().toISOString() }, null, 2));
  process.exit(1);
});