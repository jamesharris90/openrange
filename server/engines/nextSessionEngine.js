const { queryWithTimeout } = require('../db/pg');

const NEXT_SESSION_CACHE = new Map();
const NEXT_SESSION_TTL_MS = 5 * 60 * 1000;

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueBySymbol(rows = []) {
  const seen = new Set();
  return rows.filter((row) => {
    const symbol = String(row?.symbol || '').trim().toUpperCase();
    if (!symbol || seen.has(symbol)) {
      return false;
    }
    seen.add(symbol);
    return true;
  });
}

function getCacheKey(options = {}) {
  return JSON.stringify({
    asOf: options.asOf || null,
    sessionOverride: options.sessionOverride || null,
  });
}

function getCachedPayload(key) {
  const cached = NEXT_SESSION_CACHE.get(key);
  if (!cached) {
    return null;
  }
  if ((Date.now() - cached.timestamp) >= NEXT_SESSION_TTL_MS) {
    NEXT_SESSION_CACHE.delete(key);
    return null;
  }
  return cached.value;
}

function setCachedPayload(key, value) {
  NEXT_SESSION_CACHE.set(key, {
    value,
    timestamp: Date.now(),
  });
}

function validateEarningsRows(rows = []) {
  return uniqueBySymbol(rows).filter((row) => Boolean(
    row.symbol
    && row.earnings_date
    && row.expected_move_percent !== null
    && row.price !== null
  ));
}

function validateWatchRows(rows = []) {
  return uniqueBySymbol(rows).filter((row) => Boolean(row.symbol && row.price !== null));
}

async function loadEarningsSetups() {
  const result = await queryWithTimeout(
    `SELECT
       ee.symbol,
       ee.report_date::text AS earnings_date,
       ee.eps_estimate,
       ee.expected_move_percent,
       mm.price,
       COALESCE(ee.sector, tu.sector) AS sector
     FROM earnings_events ee
     LEFT JOIN market_metrics mm ON UPPER(mm.symbol) = UPPER(ee.symbol)
     LEFT JOIN ticker_universe tu ON UPPER(tu.symbol) = UPPER(ee.symbol)
     WHERE ee.report_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '3 days'
       AND mm.price IS NOT NULL
       AND ee.expected_move_percent IS NOT NULL
     ORDER BY ee.report_date ASC, ee.expected_move_percent DESC NULLS LAST
     LIMIT 20`,
    [],
    { label: 'next_session.earnings', timeoutMs: 2200, maxRetries: 1, retryDelayMs: 100 }
  );

  return validateEarningsRows((result.rows || []).map((row) => ({
    symbol: String(row.symbol || '').toUpperCase(),
    earnings_date: row.earnings_date,
    eps_estimate: toNumber(row.eps_estimate),
    expected_move_percent: toNumber(row.expected_move_percent),
    price: toNumber(row.price),
    sector: row.sector || null,
  })));
}

async function loadCatalystSetups() {
  const result = await queryWithTimeout(
    `WITH latest_news AS (
       SELECT DISTINCT ON (UPPER(symbol))
         UPPER(symbol) AS symbol,
         headline,
         COALESCE(published_at, created_at) AS published_at
       FROM news_articles
       WHERE symbol IS NOT NULL
         AND COALESCE(published_at, created_at) > NOW() - INTERVAL '24 hours'
       ORDER BY UPPER(symbol), COALESCE(published_at, created_at) DESC
     )
     SELECT
       ln.symbol,
       ln.headline,
       ln.published_at,
       mm.price,
       mm.change_percent,
       mm.relative_volume,
       mm.volume,
       mm.avg_volume_30d,
       mm.liquidity_surge,
       tu.sector
     FROM latest_news ln
     JOIN market_metrics mm ON UPPER(mm.symbol) = ln.symbol
     LEFT JOIN ticker_universe tu ON UPPER(tu.symbol) = ln.symbol
     WHERE mm.price IS NOT NULL
       AND (
         COALESCE(mm.relative_volume, 0) >= 1.5
         OR COALESCE(mm.liquidity_surge, 0) > 0
         OR COALESCE(mm.volume, 0) >= COALESCE(mm.avg_volume_30d, 0)
       )
     ORDER BY COALESCE(mm.relative_volume, 0) DESC, ln.published_at DESC
     LIMIT 20`,
    [],
    { label: 'next_session.catalysts', timeoutMs: 2200, maxRetries: 1, retryDelayMs: 100 }
  );

  return validateWatchRows((result.rows || []).map((row) => ({
    symbol: String(row.symbol || '').toUpperCase(),
    headline: row.headline || null,
    published_at: row.published_at ? new Date(row.published_at).toISOString() : null,
    price: toNumber(row.price),
    change_percent: toNumber(row.change_percent),
    relative_volume: toNumber(row.relative_volume),
    volume: toNumber(row.volume),
    sector: row.sector || null,
  })));
}

async function loadMomentumCarrySetups() {
  const result = await queryWithTimeout(
    `WITH latest_stream AS (
       SELECT DISTINCT ON (UPPER(symbol))
         UPPER(symbol) AS symbol,
         headline,
         score,
         created_at
       FROM opportunity_stream
       WHERE symbol IS NOT NULL
         AND created_at > NOW() - INTERVAL '36 hours'
       ORDER BY UPPER(symbol), created_at DESC
     ),
     latest_setup AS (
       SELECT DISTINCT ON (UPPER(symbol))
         UPPER(symbol) AS symbol,
         setup AS setup_name,
         score AS setup_score,
         detected_at
       FROM trade_setups
       WHERE symbol IS NOT NULL
         AND COALESCE(detected_at, NOW()) > NOW() - INTERVAL '14 days'
       ORDER BY UPPER(symbol), detected_at DESC NULLS LAST
     )
     SELECT
       UPPER(mm.symbol) AS symbol,
       mm.price,
       mm.change_percent,
       mm.relative_volume,
       mm.volume,
       mm.avg_volume_30d,
       mm.vwap,
       mm.atr_percent,
       ls.setup_name,
       ls.setup_score,
       st.headline,
       st.score AS stream_score,
       tu.sector
     FROM market_metrics mm
     LEFT JOIN latest_setup ls ON ls.symbol = UPPER(mm.symbol)
     LEFT JOIN latest_stream st ON st.symbol = UPPER(mm.symbol)
     LEFT JOIN ticker_universe tu ON UPPER(tu.symbol) = UPPER(mm.symbol)
     WHERE mm.price IS NOT NULL
       AND COALESCE(mm.relative_volume, 0) >= 1.5
       AND ABS(COALESCE(mm.change_percent, 0)) >= 3
       AND (ls.setup_name IS NOT NULL OR st.score IS NOT NULL)
     ORDER BY ABS(COALESCE(mm.change_percent, 0)) DESC, COALESCE(mm.relative_volume, 0) DESC
     LIMIT 20`,
    [],
    { label: 'next_session.momentum', timeoutMs: 2200, maxRetries: 1, retryDelayMs: 100 }
  );

  return validateWatchRows((result.rows || []).map((row) => ({
    symbol: String(row.symbol || '').toUpperCase(),
    price: toNumber(row.price),
    change_percent: toNumber(row.change_percent),
    relative_volume: toNumber(row.relative_volume),
    atr_percent: toNumber(row.atr_percent),
    setup_type: row.setup_name || null,
    setup_score: toNumber(row.setup_score),
    stream_score: toNumber(row.stream_score),
    headline: row.headline || null,
    sector: row.sector || null,
  })));
}

async function buildNextSessionPayload(options = {}) {
  const cacheKey = getCacheKey(options);
  const cached = getCachedPayload(cacheKey);
  if (cached) {
    return cached;
  }

  const startedAt = Date.now();
  const missing_sources = [];

  const [earningsResult, catalystsResult, momentumResult] = await Promise.allSettled([
    loadEarningsSetups(),
    loadCatalystSetups(),
    loadMomentumCarrySetups(),
  ]);

  const earnings = earningsResult.status === 'fulfilled' ? earningsResult.value : (missing_sources.push('earnings_events'), []);
  const catalysts = catalystsResult.status === 'fulfilled' ? catalystsResult.value : (missing_sources.push('news_articles'), []);
  const momentum = momentumResult.status === 'fulfilled' ? momentumResult.value : (missing_sources.push('trade_setups/opportunity_stream'), []);

  const payload = {
    earnings,
    catalysts,
    momentum,
    generated_at: new Date().toISOString(),
    message: earnings.length + catalysts.length + momentum.length > 0
      ? null
      : 'No qualifying setups identified for next session',
    missing_sources,
    meta: {
      total_ms: Date.now() - startedAt,
      cache_ttl_ms: NEXT_SESSION_TTL_MS,
    },
  };

  setCachedPayload(cacheKey, payload);
  return payload;
}

module.exports = {
  buildNextSessionPayload,
  NEXT_SESSION_TTL_MS,
};