#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
if (!process.env.DATABASE_URL && !process.env.SUPABASE_DB_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
}

const { queryWithTimeout } = require('../db/pg');

const BASE_URL = process.env.SCREENER_BASE_URL || 'http://localhost:3007';
const LOG_DIR = path.resolve(__dirname, '..', 'logs');
const CONTRACT_FIELDS = [
  'symbol',
  'price',
  'change_percent',
  'volume',
  'avg_volume_30d',
  'relative_volume',
  'market_cap',
  'sector',
  'catalyst_type',
];
const FORBIDDEN_FIELDS = ['trade_score', 'confidence', 'setup', 'entry', 'stop', 'target', 'signal_valid'];
const COVERAGE_REQUIRED = 0.7;

function writeJson(fileName, payload) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const filePath = path.join(LOG_DIR, fileName);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return filePath;
}

function pickRandom(items, count) {
  const clone = [...items];
  for (let i = clone.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  return clone.slice(0, count);
}

async function fetchJson(endpoint) {
  const startedAt = Date.now();
  const response = await fetch(`${BASE_URL}${endpoint}`);
  const body = await response.json();
  return { status: response.status, ms: Date.now() - startedAt, body };
}

async function getCoverageStats() {
  await queryWithTimeout(
    `ALTER TABLE market_quotes
       ADD COLUMN IF NOT EXISTS previous_close NUMERIC,
       ADD COLUMN IF NOT EXISTS last_updated TIMESTAMPTZ`,
    [],
    {
      timeoutMs: 8000,
      label: 'validation.truth.coverage.ensure_quote_columns',
      maxRetries: 0,
      poolType: 'write',
    }
  );

  await queryWithTimeout(
    `UPDATE market_quotes
     SET last_updated = COALESCE(last_updated, updated_at)
     WHERE last_updated IS NULL`,
    [],
    {
      timeoutMs: 8000,
      label: 'validation.truth.coverage.backfill_last_updated',
      maxRetries: 0,
      poolType: 'write',
    }
  );

  const { rows } = await queryWithTimeout(
    `SELECT
       (SELECT COUNT(DISTINCT UPPER(symbol))::int
        FROM ticker_universe
        WHERE symbol IS NOT NULL AND symbol <> '') AS total_universe_count,
       (SELECT COUNT(*)::int
        FROM market_quotes
        WHERE last_updated >= NOW() - INTERVAL '60 seconds'
          AND price IS NOT NULL
          AND price > 0) AS fresh_quote_count`,
    [],
    {
      timeoutMs: 8000,
      label: 'validation.truth.coverage',
      maxRetries: 0,
    }
  );

  const totalUniverseCount = Number(rows?.[0]?.total_universe_count || 0);
  const freshQuoteCount = Number(rows?.[0]?.fresh_quote_count || 0);
  const coverage = totalUniverseCount > 0 ? freshQuoteCount / totalUniverseCount : 0;

  return {
    total_universe_count: totalUniverseCount,
    fresh_quote_count: freshQuoteCount,
    coverage,
    required: COVERAGE_REQUIRED,
    pass: coverage >= COVERAGE_REQUIRED,
  };
}

function evaluateContract(payload, coverageStats) {
  const rows = Array.isArray(payload.body?.data) ? payload.body.data : [];

  const fieldViolations = [];
  const forbiddenViolations = [];
  const nanViolations = [];
  const catalystViolations = [];

  for (const row of rows) {
    const symbol = String(row?.symbol || '').toUpperCase();
    const keys = Object.keys(row || {}).sort();
    const expected = [...CONTRACT_FIELDS].sort();

    if (keys.length !== expected.length || expected.some((k) => !keys.includes(k))) {
      fieldViolations.push({ symbol, keys });
    }

    const forbidden = FORBIDDEN_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(row || {}, field));
    if (forbidden.length) {
      forbiddenViolations.push({ symbol, forbidden });
    }

    const numericFields = ['price', 'change_percent', 'volume', 'avg_volume_30d', 'relative_volume', 'market_cap'];
    for (const field of numericFields) {
      const value = Number(row?.[field]);
      if (!Number.isFinite(value)) {
        nanViolations.push({ symbol, field, value: row?.[field] });
      }
    }

    if (!String(row?.symbol || '').trim() || !String(row?.sector || '').trim() || !String(row?.catalyst_type || '').trim()) {
      nanViolations.push({ symbol, field: 'required_string', value: row });
    }

    if (String(row?.catalyst_type || '').toUpperCase() === 'VOLUME') {
      catalystViolations.push({ symbol, reason: 'forbidden_catalyst_VOLUME' });
    }
  }

  const checks = {
    endpoint_status_200: payload.status === 200,
    not_data_not_ready_status: String(payload.body?.status || '') !== 'DATA_NOT_READY',
    success_true: payload.body?.success === true,
    page_size_is_25: Number(payload.body?.pageSize) === 25,
    coverage_gte_70pct: Boolean(coverageStats?.pass),
    strict_column_integrity: fieldViolations.length === 0,
    no_forbidden_fields: forbiddenViolations.length === 0,
    no_null_or_nan_values: nanViolations.length === 0,
    no_volume_catalyst: catalystViolations.length === 0,
    universe_count_gt_5000: Number(payload.body?.count || 0) > 5000,
  };

  return {
    timestamp: new Date().toISOString(),
    endpoint: `${BASE_URL}/api/screener?page=1&pageSize=25`,
    count: Number(payload.body?.count || 0),
    returned: rows.length,
    coverage: coverageStats,
    checks,
    violations: {
      field_violations: fieldViolations,
      forbidden_field_violations: forbiddenViolations,
      nan_or_null_violations: nanViolations,
      catalyst_violations: catalystViolations,
    },
    pass: Object.values(checks).every(Boolean),
  };
}

async function evaluatePrice(payload) {
  const rows = Array.isArray(payload.body?.data) ? payload.body.data : [];
  const symbols = rows.map((row) => String(row?.symbol || '').toUpperCase()).filter(Boolean);

  const quoteResult = await queryWithTimeout(
    `SELECT DISTINCT ON (UPPER(symbol))
       UPPER(symbol) AS symbol,
       price::numeric AS price,
       updated_at::timestamptz AS updated_at
     FROM market_quotes
     WHERE UPPER(symbol) = ANY($1::text[])
     ORDER BY UPPER(symbol), updated_at DESC NULLS LAST`,
    [symbols],
    { timeoutMs: 8000, label: 'validation.truth.price.market_quotes', maxRetries: 0 }
  );

  const quoteMap = new Map((quoteResult.rows || []).map((row) => [
    String(row.symbol || '').toUpperCase(),
    { price: Number(row.price), updated_at: row.updated_at },
  ]));

  const quoteComparison = [];
  for (const row of rows) {
    const symbol = String(row.symbol || '').toUpperCase();
    const apiPrice = Number(row.price);
    const quote = quoteMap.get(symbol);
    const quotePrice = Number(quote?.price);
    const quoteTsMs = quote?.updated_at ? new Date(quote.updated_at).getTime() : null;
    const pctDiff = Number.isFinite(apiPrice) && Number.isFinite(quotePrice) && quotePrice > 0
      ? (Math.abs(apiPrice - quotePrice) / quotePrice) * 100
      : null;

    quoteComparison.push({
      symbol,
      api_price: apiPrice,
      quote_price: quotePrice,
      quote_ts_ms: quoteTsMs,
      pct_diff: pctDiff,
      pass: Number.isFinite(pctDiff) && pctDiff <= 0.0001,
    });
  }

  const latestQuoteTsMs = quoteComparison.reduce((maxTs, item) => {
    if (!Number.isFinite(item.quote_ts_ms)) return maxTs;
    return Math.max(maxTs, item.quote_ts_ms);
  }, Number.NEGATIVE_INFINITY);

  for (const item of quoteComparison) {
    const quoteAgeFromSnapshotSeconds = Number.isFinite(latestQuoteTsMs) && Number.isFinite(item.quote_ts_ms)
      ? (latestQuoteTsMs - item.quote_ts_ms) / 1000
      : null;
    item.quote_age_from_snapshot_seconds = quoteAgeFromSnapshotSeconds;
    item.pass = item.pass
      && Number.isFinite(quoteAgeFromSnapshotSeconds)
      && quoteAgeFromSnapshotSeconds <= 60;
    delete item.quote_ts_ms;
  }

  const sampleSymbols = pickRandom(symbols, 5);
  const liveComparisons = [];
  for (const symbol of sampleSymbols) {
    const live = await fetchJson(`/api/quote?symbol=${encodeURIComponent(symbol)}`);
    const livePrice = Number(live.body?.data?.[0]?.price);
    const apiRow = rows.find((row) => String(row?.symbol || '').toUpperCase() === symbol);
    const apiPrice = Number(apiRow?.price);
    const pctDiff = Number.isFinite(livePrice) && Number.isFinite(apiPrice) && livePrice > 0
      ? (Math.abs(apiPrice - livePrice) / livePrice) * 100
      : null;

    liveComparisons.push({
      symbol,
      live_status: live.status,
      live_price: livePrice,
      api_price: apiPrice,
      pct_diff: pctDiff,
      pass: live.status === 200
        && Number.isFinite(livePrice)
        && Number.isFinite(pctDiff)
        && pctDiff <= 1,
    });
  }

  const checks = {
    all_rows_match_market_quotes_price: quoteComparison.every((item) => item.pass),
    compared_against_five_live_quotes: liveComparisons.length === 5,
    live_quote_deviation_within_1pct: liveComparisons.length === 5 && liveComparisons.every((item) => item.pass),
  };

  return {
    timestamp: new Date().toISOString(),
    endpoint: BASE_URL,
    checks,
    quote_comparison: quoteComparison,
    live_quote_comparison: liveComparisons,
    pass: Object.values(checks).every(Boolean),
  };
}

async function evaluateCatalyst(payload) {
  const rows = Array.isArray(payload.body?.data) ? payload.body.data : [];

  const byCatalyst = rows.reduce((acc, row) => {
    const key = String(row?.catalyst_type || 'UNKNOWN').toUpperCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const unusualViolations = rows
    .filter((row) => String(row?.catalyst_type || '').toUpperCase() === 'UNUSUAL_VOLUME')
    .filter((row) => !(Number(row.volume) >= Number(row.avg_volume_30d) * 3 && Number(row.volume) >= 2000000))
    .map((row) => ({
      symbol: row.symbol,
      volume: row.volume,
      avg_volume_30d: row.avg_volume_30d,
    }));

  const newsSymbols = rows
    .filter((row) => String(row?.catalyst_type || '').toUpperCase() === 'NEWS')
    .map((row) => String(row.symbol || '').toUpperCase());

  const earningsSymbols = rows
    .filter((row) => String(row?.catalyst_type || '').toUpperCase() === 'EARNINGS')
    .map((row) => String(row.symbol || '').toUpperCase());

  const newsResult = newsSymbols.length
    ? await queryWithTimeout(
      `WITH base AS (
         SELECT
           UPPER(NULLIF(to_jsonb(na)->>'symbol', '')) AS direct_symbol,
           COALESCE(to_jsonb(na)->'symbols', '[]'::jsonb) AS symbols_json,
           COALESCE((to_jsonb(na)->>'published_at')::timestamptz, (to_jsonb(na)->>'created_at')::timestamptz) AS published_at
         FROM news_articles na
         WHERE COALESCE((to_jsonb(na)->>'published_at')::timestamptz, (to_jsonb(na)->>'created_at')::timestamptz) >= NOW() - INTERVAL '24 hours'
       ),
       expanded AS (
         SELECT direct_symbol AS symbol
         FROM base
         WHERE direct_symbol IS NOT NULL AND direct_symbol <> ''
         UNION ALL
         SELECT UPPER(arr.value) AS symbol
         FROM base b
         JOIN LATERAL jsonb_array_elements_text(b.symbols_json) AS arr(value) ON TRUE
       )
       SELECT UPPER(symbol) AS symbol
       FROM expanded
       WHERE UPPER(symbol) = ANY($1::text[])
       GROUP BY UPPER(symbol)`,
      [newsSymbols],
      { timeoutMs: 8000, label: 'validation.truth.catalyst.news', maxRetries: 0 }
    )
    : { rows: [] };

  const earningsResult = earningsSymbols.length
    ? await queryWithTimeout(
      `SELECT UPPER(symbol) AS symbol
       FROM earnings_events
       WHERE UPPER(symbol) = ANY($1::text[])
         AND report_date::timestamptz >= NOW() - INTERVAL '1 day'
         AND report_date::timestamptz <= NOW() + INTERVAL '1 day'
       GROUP BY UPPER(symbol)`,
      [earningsSymbols],
      { timeoutMs: 8000, label: 'validation.truth.catalyst.earnings', maxRetries: 0 }
    )
    : { rows: [] };

  const newsSet = new Set((newsResult.rows || []).map((row) => String(row.symbol || '').toUpperCase()));
  const earningsSet = new Set((earningsResult.rows || []).map((row) => String(row.symbol || '').toUpperCase()));

  const newsMissing = newsSymbols.filter((symbol) => !newsSet.has(symbol));
  const earningsMissing = earningsSymbols.filter((symbol) => !earningsSet.has(symbol));

  const relativeVolumeViolations = rows
    .filter((row) => {
      const expected = Number(row.volume) / Number(row.avg_volume_30d);
      const actual = Number(row.relative_volume);
      return !(Number.isFinite(expected) && Number.isFinite(actual) && Math.abs(actual - expected) <= Math.max(1e-9, Math.abs(expected) * 1e-9));
    })
    .map((row) => ({
      symbol: row.symbol,
      volume: row.volume,
      avg_volume_30d: row.avg_volume_30d,
      relative_volume: row.relative_volume,
      expected_relative_volume: Number(row.volume) / Number(row.avg_volume_30d),
    }));

  const checks = {
    no_volume_literal_catalyst: rows.every((row) => String(row?.catalyst_type || '').toUpperCase() !== 'VOLUME'),
    unusual_volume_is_strict: unusualViolations.length === 0,
    news_has_recent_article: newsMissing.length === 0,
    earnings_within_plus_minus_one_day: earningsMissing.length === 0,
    relative_volume_formula_exact: relativeVolumeViolations.length === 0,
  };

  return {
    timestamp: new Date().toISOString(),
    catalyst_distribution: byCatalyst,
    checks,
    violations: {
      unusual_volume_violations: unusualViolations,
      news_missing_recent_articles: newsMissing,
      earnings_missing_valid_window: earningsMissing,
      relative_volume_violations: relativeVolumeViolations,
    },
    pass: Object.values(checks).every(Boolean),
  };
}

async function main() {
  const screenerPayload = await fetchJson('/api/screener?page=1&pageSize=25');
  const coverageStats = await getCoverageStats();

  const contractReport = evaluateContract(screenerPayload, coverageStats);
  const priceReport = await evaluatePrice(screenerPayload);
  const catalystReport = await evaluateCatalyst(screenerPayload);

  writeJson('screener_contract_check.json', contractReport);
  writeJson('screener_price_check.json', priceReport);
  writeJson('screener_catalyst_check.json', catalystReport);

  const pass = contractReport.pass && priceReport.pass && catalystReport.pass;
  const summary = {
    timestamp: new Date().toISOString(),
    endpoint: BASE_URL,
    pass,
    status_text: pass ? 'BUILD VALIDATED - SAFE TO DEPLOY' : 'BUILD FAILED - FIX REQUIRED',
    reports: {
      contract: 'logs/screener_contract_check.json',
      price: 'logs/screener_price_check.json',
      catalyst: 'logs/screener_catalyst_check.json',
    },
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!pass) {
    process.exit(1);
  }
}

main().catch((error) => {
  const summary = {
    timestamp: new Date().toISOString(),
    pass: false,
    status_text: 'BUILD FAILED - FIX REQUIRED',
    error: error?.message || String(error),
  };
  writeJson('screener_contract_check.json', summary);
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
});
