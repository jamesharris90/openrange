#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const dotenv = require('dotenv');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER_ROOT = path.resolve(__dirname, '..');
const TRADING_OS_ROOT = path.resolve(ROOT, 'trading-os');

dotenv.config({ path: path.join(SERVER_ROOT, '.env') });
if (!process.env.DATABASE_URL && !process.env.SUPABASE_DB_URL) {
  dotenv.config({ path: path.join(ROOT, '.env') });
}

const LOCAL_API_BASE = process.env.DATA_INTEGRITY_LOCAL_API_BASE || 'http://127.0.0.1:3007';
const PROD_API_BASE = process.env.DATA_INTEGRITY_PROD_API_BASE || readProdApiBase();
const PROD_SITE_BASE = process.env.DATA_INTEGRITY_PROD_SITE_BASE || 'https://openrangetrading.co.uk';

const PRECHECK_PATH = path.join(ROOT, 'logs', 'precheck_validation.json');
const ENDPOINT_PATH = path.join(ROOT, 'logs', 'endpoint_validation.json');
const BUILD_REPORT_PATH = path.join(ROOT, 'logs', 'build_validation_report.json');

const TICKERS = ['META', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'SOFI', 'MU', 'CRWD', 'SMCI', 'CLRC'];
const REQUIRED_OBJECTS = [
  { name: 'market_quotes', expectedType: 'r', columns: ['symbol', 'price', 'change_percent', 'volume', 'updated_at'] },
  { name: 'market_metrics', expectedType: 'r', columns: ['symbol', 'price', 'change_percent', 'avg_volume_30d', 'updated_at'] },
  { name: 'earnings_events', expectedType: 'r', columns: ['symbol', 'report_date', 'eps_estimate', 'eps_actual', 'updated_at'] },
  { name: 'daily_ohlcv', expectedType: 'v', columns: ['symbol', 'date', 'open', 'high', 'low', 'close', 'volume'] },
];

function readProdApiBase() {
  try {
    const raw = fs.readFileSync(path.join(TRADING_OS_ROOT, '.env.production'), 'utf8');
    const match = raw.match(/^NEXT_PUBLIC_API_URL=(.+)$/m);
    return match ? match[1].trim() : 'https://openrange-backend-production.up.railway.app';
  } catch {
    return 'https://openrange-backend-production.up.railway.app';
  }
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath, payload) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function safeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
}

function percentDiff(left, right) {
  const l = toNumber(left);
  const r = toNumber(right);
  if (l === null || r === null) return null;
  if (l === 0 && r === 0) return 0;
  if (l === 0 || r === 0) return 100;
  return Number((((Math.abs(l - r)) / Math.max(Math.abs(l), Math.abs(r))) * 100).toFixed(4));
}

function approxEqual(left, right, tolerancePct = 1.5) {
  const diff = percentDiff(left, right);
  return diff === null ? false : diff <= tolerancePct;
}

async function fetchJson(url) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return {
      url,
      status: response.status,
      ok: response.ok,
      elapsed_ms: Date.now() - started,
      body,
      text_sample: text.slice(0, 200),
    };
  } catch (error) {
    return {
      url,
      status: 0,
      ok: false,
      elapsed_ms: Date.now() - started,
      body: null,
      error: error.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractResearchSnapshot(body) {
  const data = body?.data || {};
  return {
    symbol: data?.symbol || null,
    price: toNumber(data?.market?.price ?? data?.overview?.price),
    change_percent: toNumber(data?.market?.change_percent ?? data?.overview?.change_percent),
    next_earnings: safeDate(data?.earnings?.next?.report_date ?? data?.earnings?.next_date),
    sector: data?.company?.sector || data?.overview?.sector || null,
  };
}

function extractDecisionSummary(body) {
  const decision = body?.decision || body?.data?.decision || body?.data || {};
  return {
    status: decision?.status || body?.status || null,
    action: decision?.action || null,
    confidence: toNumber(decision?.confidence),
    risk_flags: Array.isArray(decision?.risk_flags) ? decision.risk_flags : [],
  };
}

function shapeCheck(endpoint, body) {
  if (endpoint.startsWith('/api/screener')) {
    const rows = Array.isArray(body?.rows) ? body.rows : Array.isArray(body?.data) ? body.data : [];
    return { pass: rows.length > 0, count: rows.length };
  }
  if (endpoint.includes('/api/intelligence/decision/')) {
    const decision = body?.decision || body?.data?.decision || body?.data || {};
    return { pass: Boolean(decision?.action || decision?.status), action: decision?.action || null };
  }
  if (endpoint.startsWith('/api/intelligence/top-opportunities')) {
    const rows = Array.isArray(body?.results)
      ? body.results
      : Array.isArray(body?.data)
        ? body.data
        : Array.isArray(body)
          ? body
          : [];
    return { pass: rows.length > 0, count: rows.length };
  }
  if (endpoint.startsWith('/api/market/overview')) {
    return { pass: Boolean(body && typeof body === 'object'), keys: Object.keys(body || {}).slice(0, 8) };
  }
  if (endpoint.startsWith('/api/earnings')) {
    const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
    return { pass: rows.length > 0, count: rows.length };
  }
  return { pass: false };
}

async function buildPrecheck(pool) {
  const objects = [];
  for (const entry of REQUIRED_OBJECTS) {
    const reg = await pool.query(
      `SELECT c.oid::regclass::text AS resolved_name, c.relkind AS relkind
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = $1`,
      [entry.name]
    );
    const exists = reg.rowCount > 0;
    const relkind = reg.rows?.[0]?.relkind || null;
    const columns = exists
      ? await pool.query(
          `SELECT column_name
           FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1
           ORDER BY ordinal_position`,
          [entry.name]
        )
      : { rows: [] };
    const columnNames = columns.rows.map((row) => row.column_name);
    const missingColumns = entry.columns.filter((column) => !columnNames.includes(column));
    let rowCount = null;
    if (exists) {
      const countResult = await pool.query(`SELECT COUNT(*)::bigint AS n FROM public.${entry.name}`);
      rowCount = Number(countResult.rows?.[0]?.n || 0);
    }
    objects.push({
      name: entry.name,
      exists,
      relkind,
      expected_relkind: entry.expectedType,
      row_count: rowCount,
      columns_validated: entry.columns,
      missing_columns: missingColumns,
      pass: exists && missingColumns.length === 0 && rowCount !== null,
    });
  }

  const payload = {
    phase: 'phase_0_precheck',
    generated_at: new Date().toISOString(),
    database_connected: true,
    objects,
    pass: objects.every((entry) => entry.pass),
  };
  writeJson(PRECHECK_PATH, payload);
  return payload;
}

async function buildEndpointValidation() {
  const endpoints = [
    '/api/screener',
    '/api/intelligence/decision/CLRC',
    '/api/intelligence/decision/AAPL',
    '/api/intelligence/top-opportunities?limit=5',
    '/api/market/overview',
    '/api/earnings/calendar?limit=5',
  ];

  const localResults = [];
  const prodResults = [];
  for (const endpoint of endpoints) {
    const local = await fetchJson(`${LOCAL_API_BASE}${endpoint}`);
    const prod = await fetchJson(`${PROD_API_BASE}${endpoint}`);
    localResults.push({
      endpoint,
      base: LOCAL_API_BASE,
      status: local.status,
      ok: local.ok,
      elapsed_ms: local.elapsed_ms,
      shape: shapeCheck(endpoint, local.body),
      error: local.error || null,
    });
    prodResults.push({
      endpoint,
      base: PROD_API_BASE,
      status: prod.status,
      ok: prod.ok,
      elapsed_ms: prod.elapsed_ms,
      shape: shapeCheck(endpoint, prod.body),
      error: prod.error || null,
    });
  }

  const payload = {
    phase: 'phase_4_endpoint_retest',
    generated_at: new Date().toISOString(),
    local_base: LOCAL_API_BASE,
    production_base: PROD_API_BASE,
    local_results: localResults,
    production_results: prodResults,
    pass: localResults.every((result) => result.ok && result.shape.pass),
  };
  writeJson(ENDPOINT_PATH, payload);
  return payload;
}

async function fetchDbTicker(pool, symbol) {
  const quote = await pool.query(
    `SELECT q.symbol,
            q.price,
            q.change_percent,
            q.volume,
            q.updated_at,
            q.sector,
            m.avg_volume_30d
     FROM public.market_quotes q
     LEFT JOIN public.market_metrics m ON UPPER(m.symbol) = UPPER(q.symbol)
     WHERE UPPER(q.symbol) = UPPER($1)
     LIMIT 1`,
    [symbol]
  );
  const nextEarnings = await pool.query(
    `SELECT report_date, eps_estimate, eps_actual
     FROM public.earnings_events
     WHERE UPPER(symbol) = UPPER($1)
       AND report_date >= CURRENT_DATE
     ORDER BY report_date ASC
     LIMIT 1`,
    [symbol]
  );
  const earningsCount = await pool.query(
    `SELECT COUNT(*)::bigint AS n
     FROM public.earnings_events
     WHERE UPPER(symbol) = UPPER($1)`,
    [symbol]
  );
  const recentIntegrity = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE open <= 0 OR high <= 0 OR low <= 0 OR close <= 0 OR high < GREATEST(open, close) OR low > LEAST(open, close) OR volume < 0) AS invalid_rows,
            COUNT(*) AS inspected_rows
     FROM (
       SELECT open, high, low, close, volume
       FROM public.daily_ohlcv
       WHERE UPPER(symbol) = UPPER($1)
       ORDER BY date DESC
       LIMIT 10
     ) recent`,
    [symbol]
  );

  const row = quote.rows?.[0] || {};
  return {
    symbol,
    price: toNumber(row.price),
    change_percent: toNumber(row.change_percent),
    volume: toNumber(row.volume),
    avg_volume_30d: toNumber(row.avg_volume_30d),
    sector: row.sector || null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    next_earnings: safeDate(nextEarnings.rows?.[0]?.report_date),
    earnings_event_count: Number(earningsCount.rows?.[0]?.n || 0),
    recent_ohlcv_invalid_rows: Number(recentIntegrity.rows?.[0]?.invalid_rows || 0),
    recent_ohlcv_rows_inspected: Number(recentIntegrity.rows?.[0]?.inspected_rows || 0),
  };
}

async function buildParity(pool) {
  const matrix = [];
  for (const symbol of TICKERS) {
    const db = await fetchDbTicker(pool, symbol);
    const prodResearchResponse = await fetchJson(`${PROD_API_BASE}/api/research/${symbol}`);
    const prodResearch = extractResearchSnapshot(prodResearchResponse.body);

    matrix.push({
      symbol,
      db,
      production_api: {
        research_status: prodResearchResponse.status,
        research_elapsed_ms: prodResearchResponse.elapsed_ms,
        research: prodResearch,
      },
      parity: {
        production_price_match: approxEqual(db.price, prodResearch.price),
        production_next_earnings_match: db.next_earnings === prodResearch.next_earnings,
      },
    });
  }

  const localMetaResearchResponse = await fetchJson(`${LOCAL_API_BASE}/api/research/META`);
  const localClrcDecisionResponse = await fetchJson(`${LOCAL_API_BASE}/api/intelligence/decision/CLRC`);
  const prodClrcDecisionResponse = await fetchJson(`${PROD_API_BASE}/api/intelligence/decision/CLRC`);
  const metaProxy = await fetchJson(`${PROD_SITE_BASE}/api/research/META/full`);
  return {
    generated_at: new Date().toISOString(),
    tickers: matrix,
    local_meta_research: {
      status: localMetaResearchResponse.status,
      elapsed_ms: localMetaResearchResponse.elapsed_ms,
      snapshot: extractResearchSnapshot(localMetaResearchResponse.body),
    },
    clrc_decision_comparison: {
      local: {
        status: localClrcDecisionResponse.status,
        elapsed_ms: localClrcDecisionResponse.elapsed_ms,
        decision: extractDecisionSummary(localClrcDecisionResponse.body),
      },
      production: {
        status: prodClrcDecisionResponse.status,
        elapsed_ms: prodClrcDecisionResponse.elapsed_ms,
        decision: extractDecisionSummary(prodClrcDecisionResponse.body),
      },
    },
    production_frontend_proxy_check: {
      url: `${PROD_SITE_BASE}/api/research/META/full`,
      status: metaProxy.status,
      ok: metaProxy.ok,
      elapsed_ms: metaProxy.elapsed_ms,
      text_sample: metaProxy.text_sample || null,
      has_json: Boolean(metaProxy.body),
    },
    summary: {
      production_price_matches: matrix.filter((row) => row.parity.production_price_match).length,
      production_earnings_matches: matrix.filter((row) => row.parity.production_next_earnings_match).length,
    },
  };
}

function summarizePerformance(endpointValidation, parity) {
  const local = endpointValidation.local_results.map((result) => ({
    endpoint: result.endpoint,
    elapsed_ms: result.elapsed_ms,
  }));
  const production = endpointValidation.production_results.map((result) => ({
    endpoint: result.endpoint,
    elapsed_ms: result.elapsed_ms,
  }));
  const researchProd = parity.tickers.map((row) => row.production_api.research_elapsed_ms);
  return {
    local_endpoints: local,
    production_endpoints: production,
    production_research_avg_ms: avg(researchProd),
    slow_local_endpoints: local.filter((row) => row.elapsed_ms > 3000),
    slow_production_endpoints: production.filter((row) => row.elapsed_ms > 3000),
  };
}

function avg(values) {
  const filtered = values.map(toNumber).filter((value) => value !== null);
  if (!filtered.length) return null;
  return Number((filtered.reduce((sum, value) => sum + value, 0) / filtered.length).toFixed(2));
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.SUPABASE_DB_URL,
    ssl: process.env.DATABASE_URL?.includes('supabase.com') || process.env.DATABASE_URL?.includes('pooler')
      ? { rejectUnauthorized: false }
      : false,
  });

  try {
    await pool.query('SELECT 1');
    const precheck = await buildPrecheck(pool);
    const endpointValidation = await buildEndpointValidation();
    const parity = await buildParity(pool);
    const performance = summarizePerformance(endpointValidation, parity);

    const clrc = parity.clrc_decision_comparison;
    const meta = parity.tickers.find((row) => row.symbol === 'META');

    const buildReport = {
      generated_at: new Date().toISOString(),
      local_api_base: LOCAL_API_BASE,
      production_api_base: PROD_API_BASE,
      production_site_base: PROD_SITE_BASE,
      precheck,
      endpoint_validation: endpointValidation,
      parity,
      performance,
      evidence: {
        research_earnings: {
          symbol: 'META',
          db_next_earnings: meta?.db?.next_earnings || null,
          db_earnings_event_count: meta?.db?.earnings_event_count || 0,
          production_snapshot_next_earnings: meta?.production_api?.research?.next_earnings || null,
          local_snapshot_next_earnings: parity.local_meta_research?.snapshot?.next_earnings || null,
          production_frontend_proxy_status: parity.production_frontend_proxy_check.status,
        },
        corrupt_symbol_guard: {
          symbol: 'CLRC',
          db_recent_invalid_rows: parity.tickers.find((row) => row.symbol === 'CLRC')?.db?.recent_ohlcv_invalid_rows || 0,
          local_decision: clrc?.local?.decision || null,
          production_decision: clrc?.production?.decision || null,
        },
      },
      remaining_risks: [],
      status_text: 'BUILD VALIDATED - SAFE TO DEPLOY',
      pass: Boolean(
        precheck.pass
        && endpointValidation.pass
        && (clrc?.local?.decision?.status === 'INSUFFICIENT_DATA')
      ),
    };

    if (parity.production_frontend_proxy_check.status !== 200) {
      buildReport.remaining_risks.push('Production frontend research full-route remains unhealthy until frontend deploy picks up the API base fix.');
    }
    if (performance.slow_local_endpoints.length > 0 || performance.slow_production_endpoints.length > 0) {
      buildReport.remaining_risks.push('Some endpoints remain slower than 3000ms during spot checks; see performance section for exact timings.');
    }
    if (!buildReport.pass) {
      buildReport.status_text = 'BUILD FAILED - FIX REQUIRED';
    }

    writeJson(BUILD_REPORT_PATH, buildReport);
    console.log(JSON.stringify({
      precheck_pass: precheck.pass,
      endpoint_pass: endpointValidation.pass,
      clrc_local_status: clrc?.local?.decision?.status || null,
      status_text: buildReport.status_text,
    }, null, 2));

    if (!buildReport.pass) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});