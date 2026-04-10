#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const dotenv = require('dotenv');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER_ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(SERVER_ROOT, '.env') });
if (!process.env.DATABASE_URL && !process.env.SUPABASE_DB_URL) {
  dotenv.config({ path: path.join(ROOT, '.env') });
}

const PROD_API_BASE = 'https://openrange-backend-production.up.railway.app';
const LOCAL_API_BASE = 'http://127.0.0.1:3007';
const PROD_SITE_BASE = 'https://openrangetrading.co.uk';
const OUTPUT_PATH = path.join(ROOT, 'logs', 'data-integrity', 'parity_report.json');
const TICKERS = ['META', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'SOFI', 'MU', 'CRWD', 'SMCI', 'CLRC'];

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
}

function approxEqual(left, right, tolerancePct = 1.5) {
  const l = toNumber(left);
  const r = toNumber(right);
  if (l === null || r === null) return false;
  if (l === 0 && r === 0) return true;
  if (l === 0 || r === 0) return false;
  return Math.abs(l - r) / Math.max(Math.abs(l), Math.abs(r)) <= tolerancePct / 100;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const started = Date.now();
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: response.status, ok: response.ok, elapsed_ms: Date.now() - started, body, text_sample: text.slice(0, 180) };
  } catch (error) {
    return { status: 0, ok: false, elapsed_ms: Date.now() - started, body: null, error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

function extractResearch(body) {
  const data = body?.data || {};
  return {
    symbol: data?.symbol || null,
    price: toNumber(data?.overview?.price ?? data?.market?.price),
    change_percent: toNumber(data?.overview?.change_percent ?? data?.market?.change_percent),
    next_earnings: safeDate(data?.earnings?.next_date ?? data?.earnings?.next?.report_date),
    sector: data?.overview?.sector || data?.company?.sector || null,
  };
}

function extractDecision(body) {
  const decision = body?.decision || body?.data?.decision || body?.data || {};
  return {
    status: decision?.status || null,
    action: decision?.action || null,
    confidence: toNumber(decision?.confidence),
    risk_flags: Array.isArray(decision?.risk_flags) ? decision.risk_flags : [],
  };
}

async function dbTicker(pool, symbol) {
  const quote = await pool.query(
    `SELECT q.price, q.change_percent, q.volume, q.updated_at, q.sector, m.avg_volume_30d
     FROM public.market_quotes q
     LEFT JOIN public.market_metrics m ON UPPER(m.symbol) = UPPER(q.symbol)
     WHERE UPPER(q.symbol) = UPPER($1)
     LIMIT 1`,
    [symbol]
  );
  const next = await pool.query(
    `SELECT report_date
     FROM public.earnings_events
     WHERE UPPER(symbol) = UPPER($1) AND report_date >= CURRENT_DATE
     ORDER BY report_date ASC
     LIMIT 1`,
    [symbol]
  );
  const count = await pool.query(
    `SELECT COUNT(*)::bigint AS n FROM public.earnings_events WHERE UPPER(symbol) = UPPER($1)`,
    [symbol]
  );
  const integrity = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE open <= 0 OR high <= 0 OR low <= 0 OR close <= 0 OR high < GREATEST(open, close) OR low > LEAST(open, close) OR volume < 0) AS invalid_rows
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
    next_earnings: safeDate(next.rows?.[0]?.report_date),
    earnings_event_count: Number(count.rows?.[0]?.n || 0),
    recent_invalid_ohlcv_rows: Number(integrity.rows?.[0]?.invalid_rows || 0),
  };
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    const rows = [];
    for (const symbol of TICKERS) {
      const db = await dbTicker(pool, symbol);
      const production = await fetchJson(`${PROD_API_BASE}/api/research/${symbol}`);
      const research = extractResearch(production.body);
      rows.push({
        symbol,
        db,
        production_api: {
          status: production.status,
          elapsed_ms: production.elapsed_ms,
          research,
        },
        parity: {
          price_match: approxEqual(db.price, research.price),
          next_earnings_match: db.next_earnings === research.next_earnings,
          sector_match: !db.sector || !research.sector ? null : db.sector === research.sector,
        },
      });
    }

    const localMeta = await fetchJson(`${LOCAL_API_BASE}/api/research/META`);
    const localClrc = await fetchJson(`${LOCAL_API_BASE}/api/intelligence/decision/CLRC`);
    const prodClrc = await fetchJson(`${PROD_API_BASE}/api/intelligence/decision/CLRC`);
    const prodProxy = await fetchJson(`${PROD_SITE_BASE}/api/research/META/full`);

    const report = {
      generated_at: new Date().toISOString(),
      local_api_base: LOCAL_API_BASE,
      production_api_base: PROD_API_BASE,
      production_site_base: PROD_SITE_BASE,
      tickers: rows,
      summary: {
        price_matches: rows.filter((row) => row.parity.price_match).length,
        next_earnings_matches: rows.filter((row) => row.parity.next_earnings_match).length,
        sectors_compared: rows.filter((row) => row.parity.sector_match !== null).length,
        sector_matches: rows.filter((row) => row.parity.sector_match === true).length,
      },
      focused_evidence: {
        meta_local_research: {
          status: localMeta.status,
          elapsed_ms: localMeta.elapsed_ms,
          research: extractResearch(localMeta.body),
        },
        clrc_decision_local: {
          status: localClrc.status,
          elapsed_ms: localClrc.elapsed_ms,
          decision: extractDecision(localClrc.body),
        },
        clrc_decision_production: {
          status: prodClrc.status,
          elapsed_ms: prodClrc.elapsed_ms,
          decision: extractDecision(prodClrc.body),
        },
        meta_frontend_proxy: {
          status: prodProxy.status,
          elapsed_ms: prodProxy.elapsed_ms,
          ok: prodProxy.ok,
          text_sample: prodProxy.text_sample || null,
        },
      },
    };

    ensureDir(OUTPUT_PATH);
    fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report.summary, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});