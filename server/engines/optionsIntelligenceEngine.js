/**
 * optionsIntelligenceEngine.js
 *
 * Enriches market_metrics with options-derived intelligence:
 *   - implied_volatility       (mean IV of nearest-expiry contracts)
 *   - expected_move_percent    (IV × √(dte/365))
 *   - put_call_ratio           (put_volume / call_volume)
 *   - options_updated_at
 *
 * ADDITIVE ONLY — never removes or overwrites existing non-null data
 * with null. Safe to run concurrently with all other engines.
 */

'use strict';

const fmpFetch         = require('../services/fmpClient');
const { queryWithTimeout } = require('../db/pg');
const logger           = require('../utils/logger');

// ── config ────────────────────────────────────────────────────────────────────

const BATCH_SIZE           = 5;   // FMP options-chain is heavy — keep batches small
const STALE_THRESHOLD_MS   = 5 * 60 * 1000;  // re-enrich if older than 5 min
const INTER_BATCH_DELAY_MS = 800; // ms between batches to avoid rate-limit
const MAX_SYMBOLS          = 200; // cap per run to stay within API budget

// ── helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function asFinite(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Parse a date string into a JS Date, returning null on failure.
 */
function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Days between now and a future date (floored to 0).
 */
function daysToExpiry(expirationStr) {
  const exp = parseDate(expirationStr);
  if (!exp) return null;
  const msLeft = exp.getTime() - Date.now();
  return Math.max(0, Math.floor(msLeft / 86_400_000));
}

/**
 * Nearest upcoming expiration date among a set of option contracts.
 * Returns the expiration string or null.
 */
function nearestExpiry(contracts) {
  const now = Date.now();
  let best = null;
  let bestMs = Infinity;
  for (const c of contracts) {
    const exp = parseDate(c.expiration ?? c.expirationDate ?? c.date);
    if (!exp) continue;
    const ms = exp.getTime() - now;
    if (ms > 0 && ms < bestMs) {
      bestMs = ms;
      best = c.expiration ?? c.expirationDate ?? c.date;
    }
  }
  return best;
}

// ── core IV / move calculation ─────────────────────────────────────────────────

/**
 * Given the raw FMP options-chain response, extract:
 *   impliedVolatility    — mean IV of contracts at the nearest expiry (0–∞, not %)
 *   expectedMovePercent  — IV × √(dte / 365) expressed as a percentage
 *   putCallRatio         — put_volume / call_volume
 *
 * Returns null for any field that cannot be derived from available data.
 */
function extractOptionsMetrics(data, fallbackChangePct = null, fallbackAtr = null) {
  // FMP returns either an array of contracts or { callOptions, putOptions }
  let calls = [];
  let puts  = [];

  if (Array.isArray(data)) {
    // flat array — split by optionType field
    for (const c of data) {
      const t = String(c.type ?? c.optionType ?? '').toLowerCase();
      if (t === 'call') calls.push(c);
      else if (t === 'put') puts.push(c);
    }
  } else if (data && typeof data === 'object') {
    calls = Array.isArray(data.callOptions) ? data.callOptions : [];
    puts  = Array.isArray(data.putOptions)  ? data.putOptions  : [];
  }

  const all = [...calls, ...puts];
  if (all.length === 0) {
    return buildFallbackMetrics(fallbackChangePct, fallbackAtr);
  }

  // ── nearest expiry ────────────────────────────────────────────────────────
  const nearExp = nearestExpiry(all);
  const dte = nearExp ? daysToExpiry(nearExp) : null;

  // ── filter to nearest expiry (or use all if no expiry info) ──────────────
  const nearContracts = nearExp
    ? all.filter(c => (c.expiration ?? c.expirationDate ?? c.date) === nearExp)
    : all;

  // ── implied volatility ────────────────────────────────────────────────────
  const ivValues = nearContracts
    .map(c => asFinite(c.impliedVolatility ?? c.iv ?? c.impliedVol))
    .filter(v => v !== null && v > 0 && v < 50); // FMP returns as decimal (0–∞), cap at 5000%

  let impliedVolatility = null;
  if (ivValues.length > 0) {
    // mean IV
    impliedVolatility = ivValues.reduce((a, b) => a + b, 0) / ivValues.length;
  }

  // ── expected move ─────────────────────────────────────────────────────────
  let expectedMovePercent = null;
  if (impliedVolatility !== null && dte !== null && dte > 0) {
    // standard square-root-of-time formula; IV is annual (decimal), result → %
    expectedMovePercent = impliedVolatility * Math.sqrt(dte / 365) * 100;
  } else if (impliedVolatility !== null) {
    // fallback: assume 5-day move
    expectedMovePercent = impliedVolatility * Math.sqrt(5 / 365) * 100;
  }

  // Fall through to ATR / change_percent proxy if IV still missing
  if (expectedMovePercent === null) {
    expectedMovePercent = buildFallbackExpectedMove(fallbackChangePct, fallbackAtr);
  }

  // ── put / call ratio ──────────────────────────────────────────────────────
  const callVol = calls.reduce((s, c) => s + (asFinite(c.volume, 0) ?? 0), 0);
  const putVol  = puts.reduce((s, c) => s + (asFinite(c.volume, 0) ?? 0), 0);
  const putCallRatio = callVol > 0 ? putVol / callVol : null;

  return {
    impliedVolatility:    impliedVolatility    !== null ? Math.round(impliedVolatility * 10000) / 10000 : null,
    expectedMovePercent:  expectedMovePercent  !== null ? Math.round(expectedMovePercent * 100) / 100   : null,
    putCallRatio:         putCallRatio         !== null ? Math.round(putCallRatio * 1000) / 1000        : null,
  };
}

function buildFallbackExpectedMove(changePct, atr) {
  // ATR-based proxy: treat ATR/price ≈ daily σ, scale to weekly
  if (atr !== null && atr > 0) {
    return Math.round(atr * Math.sqrt(5) * 100) / 100;
  }
  // Last resort: abs(change_percent)
  if (changePct !== null && Number.isFinite(changePct)) {
    return Math.round(Math.abs(changePct) * 100) / 100;
  }
  return null;
}

function buildFallbackMetrics(changePct, atr) {
  return {
    impliedVolatility:   null,
    expectedMovePercent: buildFallbackExpectedMove(changePct, atr),
    putCallRatio:        null,
  };
}

// ── database helpers ──────────────────────────────────────────────────────────

/**
 * Pull symbols that either have no options data yet, or whose options data is stale.
 * Prioritises by market_cap DESC (liquid stocks first).
 */
async function fetchSymbolsToEnrich(limit = MAX_SYMBOLS) {
  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();
  const result = await queryWithTimeout(
    `SELECT
       mq.symbol,
       mm.atr,
       mm.implied_volatility,
       mm.expected_move_percent,
       mm.options_updated_at,
       mq.change_percent,
       mq.market_cap
     FROM market_quotes mq
     LEFT JOIN market_metrics mm ON UPPER(mm.symbol) = UPPER(mq.symbol)
     WHERE mq.price > 0
       AND mq.volume > 0
       AND (
         mm.options_updated_at IS NULL
         OR mm.options_updated_at < $1
       )
     ORDER BY mq.market_cap DESC NULLS LAST
     LIMIT $2`,
    [staleThreshold, limit],
    { label: 'optionsEngine.fetchSymbols', timeoutMs: 8000, maxRetries: 1 }
  );
  return result.rows ?? [];
}

/**
 * Write enriched data back to market_metrics.
 * Uses COALESCE so we never overwrite a valid existing value with NULL.
 */
async function writeMetrics(symbol, metrics) {
  const { impliedVolatility, expectedMovePercent, putCallRatio } = metrics;

  await queryWithTimeout(
    `INSERT INTO market_metrics (symbol, implied_volatility, expected_move_percent, put_call_ratio, options_updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (symbol) DO UPDATE SET
       implied_volatility    = COALESCE($2, market_metrics.implied_volatility),
       expected_move_percent = COALESCE($3, market_metrics.expected_move_percent),
       put_call_ratio        = COALESCE($4, market_metrics.put_call_ratio),
       options_updated_at    = NOW()`,
    [symbol.toUpperCase(), impliedVolatility, expectedMovePercent, putCallRatio],
    { label: 'optionsEngine.write', timeoutMs: 5000, maxRetries: 1 }
  );
}

// ── per-symbol fetch + enrich ─────────────────────────────────────────────────

async function enrichSymbol(row) {
  const symbol     = String(row.symbol ?? '').toUpperCase();
  const changePct  = asFinite(row.change_percent);
  const atr        = asFinite(row.atr);

  let rawData = null;
  try {
    rawData = await fmpFetch('/options-chain', { symbol });
  } catch (err) {
    logger.warn('[optionsEngine] options-chain fetch failed', { symbol, error: err.message });
  }

  const metrics = rawData
    ? extractOptionsMetrics(rawData, changePct, atr)
    : buildFallbackMetrics(changePct, atr);

  // Only write if we have at least expected_move_percent
  if (metrics.expectedMovePercent === null && metrics.impliedVolatility === null) {
    return { symbol, skipped: true };
  }

  await writeMetrics(symbol, metrics);
  return { symbol, ...metrics };
}

// ── public interface ──────────────────────────────────────────────────────────

/**
 * Enrich a specific list of symbols (used by on-demand callers).
 * Falls back to the full stale-symbol queue if symbols is empty.
 */
async function enrichOptionsData(symbols = []) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    logger.warn('[optionsEngine] FMP_API_KEY not set — skipping');
    return { enriched: 0, skipped: 0, errors: 0 };
  }

  let rows;
  if (symbols.length > 0) {
    // Validate against market_quotes so we only process known symbols
    const upper = symbols.map(s => s.toUpperCase());
    const result = await queryWithTimeout(
      `SELECT mq.symbol, mm.atr, mq.change_percent, mq.market_cap, mm.options_updated_at
       FROM market_quotes mq
       LEFT JOIN market_metrics mm ON UPPER(mm.symbol) = UPPER(mq.symbol)
       WHERE UPPER(mq.symbol) = ANY($1::text[])`,
      [upper],
      { label: 'optionsEngine.fetchSpecific', timeoutMs: 6000, maxRetries: 1 }
    );
    rows = result.rows ?? [];
  } else {
    rows = await fetchSymbolsToEnrich(MAX_SYMBOLS);
  }

  if (rows.length === 0) {
    logger.info('[optionsEngine] no symbols to enrich');
    return { enriched: 0, skipped: 0, errors: 0 };
  }

  logger.info('[optionsEngine] enriching symbols', { count: rows.length });

  let enriched = 0, skipped = 0, errors = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    await Promise.allSettled(
      batch.map(async (row) => {
        try {
          const result = await enrichSymbol(row);
          if (result.skipped) skipped++;
          else enriched++;
        } catch (err) {
          errors++;
          logger.warn('[optionsEngine] symbol error', {
            symbol: row.symbol,
            error: err.message,
          });
        }
      })
    );

    // Stagger batches to respect FMP rate limits
    if (i + BATCH_SIZE < rows.length) {
      await sleep(INTER_BATCH_DELAY_MS);
    }
  }

  logger.info('[optionsEngine] run complete', { enriched, skipped, errors });
  return { enriched, skipped, errors };
}

/**
 * Scheduled entry point — enriches all stale symbols.
 */
async function runOptionsIntelligenceEngine() {
  return enrichOptionsData([]);
}

module.exports = {
  runOptionsIntelligenceEngine,
  enrichOptionsData,
  extractOptionsMetrics,   // exported for testing
  buildFallbackMetrics,
};
