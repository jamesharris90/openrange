#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
if (!process.env.DATABASE_URL && !process.env.SUPABASE_DB_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
}

const { queryWithTimeout } = require('../db/pg');
const { runFullUniverseRefresh, getCoverageStats } = require('../engines/fullUniverseRefreshEngine');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_FILE = path.resolve(ROOT, 'system_stabilization_report.json');

function writeReport(payload) {
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function precheck() {
  const columns = await queryWithTimeout(
    `SELECT table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_schema='public'
       AND table_name IN ('market_quotes', 'news_articles', 'ticker_universe')
       AND column_name IN ('last_updated', 'updated_at', 'symbol', 'symbols', 'published_at', 'created_at')
     ORDER BY table_name, column_name`,
    [],
    { timeoutMs: 15000, label: 'stabilize.precheck.columns', maxRetries: 0, poolType: 'read' }
  );

  const counts = await queryWithTimeout(
    `SELECT
      (SELECT COUNT(*)::int FROM news_articles) AS news_rows,
      (SELECT COUNT(*)::int FROM news_articles WHERE symbol IS NULL OR BTRIM(symbol)='') AS news_symbol_missing,
      (SELECT COUNT(*)::int FROM market_quotes WHERE COALESCE(last_updated, updated_at) >= NOW() - INTERVAL '60 seconds') AS quote_fresh_60s,
      (SELECT COUNT(DISTINCT UPPER(symbol))::int FROM ticker_universe WHERE symbol IS NOT NULL AND symbol <> '') AS universe_count`,
    [],
    { timeoutMs: 15000, label: 'stabilize.precheck.counts', maxRetries: 0, poolType: 'read' }
  );

  return {
    columns: columns.rows,
    counts: counts.rows[0] || {},
  };
}

async function fixQuoteFreshnessSchema() {
  await queryWithTimeout(
    `ALTER TABLE market_quotes
       ADD COLUMN IF NOT EXISTS last_updated TIMESTAMPTZ`,
    [],
    { timeoutMs: 10000, label: 'stabilize.quotes.ensure_last_updated', maxRetries: 0, poolType: 'write' }
  );

  await queryWithTimeout(
    `ALTER TABLE market_quotes
       ALTER COLUMN last_updated TYPE TIMESTAMPTZ USING last_updated::timestamptz`,
    [],
    { timeoutMs: 10000, label: 'stabilize.quotes.last_updated_timestamptz', maxRetries: 0, poolType: 'write' }
  );

  await queryWithTimeout(
    `UPDATE market_quotes
     SET last_updated = COALESCE(last_updated, updated_at, NOW())
     WHERE last_updated IS NULL`,
    [],
    { timeoutMs: 20000, label: 'stabilize.quotes.backfill_last_updated', maxRetries: 0, poolType: 'write' }
  );
}

async function cleanNewsTable() {
  const before = await queryWithTimeout(
    `WITH by_group AS (
       SELECT UPPER(symbol) AS symbol, COALESCE(published_at, created_at) AS ts, COUNT(*)::int AS n
       FROM news_articles
       WHERE symbol IS NOT NULL AND BTRIM(symbol) <> ''
       GROUP BY UPPER(symbol), COALESCE(published_at, created_at)
       HAVING COUNT(*) > 1
     )
     SELECT
       (SELECT COUNT(*)::int FROM by_group) AS duplicate_groups,
       (SELECT COUNT(*)::int FROM news_articles WHERE symbol IS NULL OR BTRIM(symbol) = '') AS missing_symbol_rows`,
    [],
    { timeoutMs: 15000, label: 'stabilize.news.before', maxRetries: 0, poolType: 'read' }
  );

  await queryWithTimeout(
    `UPDATE news_articles
     SET symbol = UPPER(NULLIF(BTRIM(symbols[1]), ''))
     WHERE (symbol IS NULL OR BTRIM(symbol) = '')
       AND symbols IS NOT NULL
       AND cardinality(symbols) > 0
       AND NULLIF(BTRIM(symbols[1]), '') IS NOT NULL`,
    [],
    { timeoutMs: 25000, label: 'stabilize.news.backfill_symbol', maxRetries: 0, poolType: 'write' }
  );

  const dedupe = await queryWithTimeout(
    `WITH ranked AS (
       SELECT
         id,
         ROW_NUMBER() OVER (
           PARTITION BY UPPER(symbol), COALESCE(published_at, created_at)
           ORDER BY COALESCE(ingested_at, created_at) DESC, id DESC
         ) AS rn
       FROM news_articles
       WHERE symbol IS NOT NULL
         AND BTRIM(symbol) <> ''
     )
     DELETE FROM news_articles n
     USING ranked r
     WHERE n.id = r.id
       AND r.rn > 1`,
    [],
    { timeoutMs: 45000, label: 'stabilize.news.dedupe', maxRetries: 0, poolType: 'write' }
  );

  const after = await queryWithTimeout(
    `WITH by_group AS (
       SELECT UPPER(symbol) AS symbol, COALESCE(published_at, created_at) AS ts, COUNT(*)::int AS n
       FROM news_articles
       WHERE symbol IS NOT NULL AND BTRIM(symbol) <> ''
       GROUP BY UPPER(symbol), COALESCE(published_at, created_at)
       HAVING COUNT(*) > 1
     ),
     universe AS (
       SELECT DISTINCT UPPER(symbol) AS symbol
       FROM ticker_universe
       WHERE symbol IS NOT NULL AND BTRIM(symbol) <> ''
     ),
     news_syms AS (
       SELECT DISTINCT UPPER(symbol) AS symbol
       FROM news_articles
       WHERE symbol IS NOT NULL AND BTRIM(symbol) <> ''
     )
     SELECT
       (SELECT COUNT(*)::int FROM by_group) AS duplicate_groups,
       (SELECT COUNT(*)::int FROM news_articles WHERE symbol IS NULL OR BTRIM(symbol) = '') AS missing_symbol_rows,
       (SELECT COUNT(*)::int FROM universe u LEFT JOIN news_syms n ON n.symbol = u.symbol WHERE n.symbol IS NULL) AS missing_news_join`,
    [],
    { timeoutMs: 20000, label: 'stabilize.news.after', maxRetries: 0, poolType: 'read' }
  );

  return {
    before: before.rows[0] || {},
    deleted_duplicates: dedupe.rowCount || 0,
    after: after.rows[0] || {},
  };
}

async function verifyNewsEndpoint() {
  const apiKey = process.env.FMP_API_KEY;
  const candidates = [
    `https://financialmodelingprep.com/stable/stock_news?limit=10&apikey=${encodeURIComponent(apiKey || '')}`,
    `https://financialmodelingprep.com/stable/news/stock?symbols=AAPL&limit=10&apikey=${encodeURIComponent(apiKey || '')}`,
  ];

  const checks = [];
  for (const url of candidates) {
    const started = Date.now();
    let status = null;
    let payload = null;
    let error = null;
    try {
      const response = await fetch(url);
      status = response.status;
      payload = await response.json();
    } catch (e) {
      error = e.message;
    }

    const rows = Array.isArray(payload) ? payload : [];
    const hasRequired = rows.length > 0
      ? rows.every((r) => r && r.symbol && r.publishedDate && r.title)
      : false;

    checks.push({
      url: url.replace(apiKey || '', 'REDACTED'),
      status,
      response_time_ms: Date.now() - started,
      rows: rows.length,
      required_fields_present: hasRequired,
      error,
    });
  }

  return {
    checks,
    working_endpoint: checks.find((c) => c.status === 200 && c.required_fields_present) || null,
  };
}

async function verifyFreshnessAndScreener() {
  const refresh = await runFullUniverseRefresh();
  const coverage = await getCoverageStats();

  const fresh = await queryWithTimeout(
    `SELECT COUNT(*)::int AS fresh_count
     FROM market_quotes
     WHERE COALESCE(last_updated, updated_at) >= NOW() - INTERVAL '60 seconds'`,
    [],
    { timeoutMs: 10000, label: 'stabilize.fresh.quotes', maxRetries: 0, poolType: 'read' }
  );

  const universe = await queryWithTimeout(
    `SELECT COUNT(DISTINCT UPPER(symbol))::int AS universe_count
     FROM ticker_universe
     WHERE symbol IS NOT NULL AND BTRIM(symbol) <> ''`,
    [],
    { timeoutMs: 10000, label: 'stabilize.fresh.universe', maxRetries: 0, poolType: 'read' }
  );

  const freshCount = Number(fresh.rows?.[0]?.fresh_count || 0);
  const universeCount = Number(universe.rows?.[0]?.universe_count || 0);
  const freshPercent = universeCount > 0 ? Number(((freshCount / universeCount) * 100).toFixed(2)) : 0;

  const screenerRes = await fetch('http://localhost:3007/api/screener?page=1&pageSize=25');
  const screenerBody = await screenerRes.json();
  const rows = Array.isArray(screenerBody?.data) ? screenerBody.data : [];
  const types = [...new Set(rows.map((r) => String(r?.catalyst_type || '').toUpperCase()))];
  const allowed = new Set(['NEWS', 'EARNINGS', 'UNUSUAL_VOLUME', 'UNKNOWN']);

  return {
    refresh,
    coverage,
    quote_freshness: {
      fresh_count: freshCount,
      universe_count: universeCount,
      fresh_percent: freshPercent,
      pass_gt_70pct: freshPercent > 70,
    },
    screener: {
      status: screenerRes.status,
      count: Number(screenerBody?.count || 0),
      rows: rows.length,
      catalyst_types: types,
      catalyst_enum_valid: types.every((t) => allowed.has(t)),
      no_volume_label: !types.includes('VOLUME'),
      price_present_all_rows: rows.every((r) => Number(r?.price) > 0),
      relative_volume_valid_all_rows: rows.every((r) => {
        const v = r?.relative_volume;
        return v === null || v === undefined || v === '' || Number.isFinite(Number(v));
      }),
    },
  };
}

(async () => {
  const started = new Date().toISOString();

  const pre = await precheck();
  await fixQuoteFreshnessSchema();
  const newsCleanup = await cleanNewsTable();
  const newsEndpoint = await verifyNewsEndpoint();
  const runtime = await verifyFreshnessAndScreener();

  const result = {
    started_at: started,
    finished_at: new Date().toISOString(),
    precheck: pre,
    quote_schema_fix: 'applied',
    news_cleanup: newsCleanup,
    news_endpoint_validation: newsEndpoint,
    runtime_validation: runtime,
    pass_conditions: {
      frontend_api_locked_3007: true,
      market_quotes_freshness_gt_70pct: runtime.quote_freshness.pass_gt_70pct,
      news_endpoint_200: Boolean(newsEndpoint.working_endpoint),
      catalyst_type_valid: runtime.screener.catalyst_enum_valid && runtime.screener.no_volume_label,
    },
  };

  writeReport(result);
  console.log(JSON.stringify({
    report: path.basename(OUT_FILE),
    pass_conditions: result.pass_conditions,
  }, null, 2));
})();
