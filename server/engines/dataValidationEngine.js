'use strict';

/**
 * Data Validation Engine
 *
 * Validates market data rows before they are used by any signal engine.
 * Replaces fragile RVOL caps with real cross-provider validation.
 *
 * Key behaviours:
 * - invalid_price: reject immediately, no cross-check
 * - extreme_rvol (>10) or extreme_move (>50%): cross-check FMP price to
 *   determine if the value is a real market event or a data error
 * - price_mismatch (>3% vs FMP): reject even normal-looking data
 * - FMP cross-check results are cached for 60s per symbol
 */

const { queryWithTimeout } = require('../db/pg');

// ── Thresholds ────────────────────────────────────────────────────────────────
const EXTREME_RVOL       = 10;    // rvol above this triggers FMP cross-check
const EXTREME_MOVE_PCT   = 50;    // |chg%| above this triggers FMP cross-check
const PRICE_MISMATCH_PCT = 0.03;  // 3% price divergence = bad data
const FMP_TIMEOUT_MS     = 5000;
const FMP_CACHE_TTL_MS   = 60_000;

// ── FMP quote cache ───────────────────────────────────────────────────────────
const fmpCache = new Map(); // symbol → { data: FmpQuote|null, fetchedAt: number }

// ── Module-level counters (reset never — cumulative since process start) ─────
let totalChecked  = 0;
let totalRejected = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Fire-and-forget rejection log insert.
 * Never throws — validation must not block on logging failure.
 */
function logRejection(symbol, issue, row, engine) {
  queryWithTimeout(
    `INSERT INTO data_validation_log (symbol, issue, price, change_percent, relative_volume, engine)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      symbol,
      issue,
      row.price          != null ? toNum(row.price)          : null,
      row.change_percent != null ? toNum(row.change_percent) : null,
      row.relative_volume != null ? toNum(row.relative_volume) : null,
      engine || null,
    ],
    { timeoutMs: 3000, label: 'validation.log_rejection', maxRetries: 0 }
  ).catch((err) => {
    console.warn('[VALIDATION LOG] insert failed:', err.message);
  });
}

// ── Core validation ───────────────────────────────────────────────────────────

async function validateMarketData(row) {
  const issues = [];

  if (!row.price || toNum(row.price) <= 0) {
    issues.push('invalid_price');
  }

  if (Math.abs(toNum(row.change_percent)) > EXTREME_MOVE_PCT) {
    issues.push('extreme_move');
  }

  if (toNum(row.relative_volume) > EXTREME_RVOL) {
    issues.push('extreme_rvol');
  }

  return { valid: issues.length === 0, issues };
}

// ── FMP cross-check ───────────────────────────────────────────────────────────

async function crossCheckWithFMP(symbol) {
  const cached = fmpCache.get(symbol);
  if (cached && (Date.now() - cached.fetchedAt) < FMP_CACHE_TTL_MS) {
    return cached.data;
  }

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey || apiKey === 'REQUIRED') return null;

  try {
    const url = `https://financialmodelingprep.com/stable/quote?symbol=${symbol}&apikey=${apiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FMP_TIMEOUT_MS);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      fmpCache.set(symbol, { data: null, fetchedAt: Date.now() });
      return null;
    }

    const json = await res.json();
    const quote = Array.isArray(json) ? (json[0] || null) : null;
    fmpCache.set(symbol, { data: quote, fetchedAt: Date.now() });
    return quote;
  } catch {
    fmpCache.set(symbol, { data: null, fetchedAt: Date.now() });
    return null;
  }
}

// ── Validation + cross-check wrapper ─────────────────────────────────────────

/**
 * Validates a market data row and cross-checks with FMP when needed.
 *
 * RVOL cap is NOT applied here. If rvol > 10:
 *   - FMP price match → allow (real momentum confirmed)
 *   - FMP price mismatch → reject (bad data)
 *   - FMP unavailable → reject conservatively
 *
 * @param {object} row    Row from market_quotes / tradable_universe
 * @param {string} engine Engine name for rejection log (e.g. 'strategySignalEngine')
 * @returns {object}      Row with added valid:boolean and issues:string[]
 */
async function validateAndEnrich(row, engine) {
  totalChecked++;

  const price = toNum(row.price);
  const chg   = toNum(row.change_percent);
  const rvol  = toNum(row.relative_volume);

  // ── Hard fail: no valid price — nothing else matters ─────────────────────
  if (!price || price <= 0) {
    totalRejected++;
    console.log(`[DATA REJECTED] ${row.symbol} reason=invalid_price`);
    logRejection(row.symbol, 'invalid_price', row, engine);
    return { ...row, valid: false, issues: ['invalid_price'] };
  }

  const isExtreme = rvol > EXTREME_RVOL || Math.abs(chg) > EXTREME_MOVE_PCT;

  if (isExtreme) {
    // ── Extreme values: cross-check FMP to distinguish real vs bad data ───
    const external = await crossCheckWithFMP(row.symbol);

    if (external) {
      const fmpPrice = toNum(external.price);
      if (fmpPrice > 0) {
        const diff = Math.abs((price - fmpPrice) / fmpPrice);
        if (diff > PRICE_MISMATCH_PCT) {
          totalRejected++;
          console.log(
            `[DATA REJECTED] ${row.symbol} reason=price_mismatch ` +
            `local=${price} fmp=${fmpPrice} diff=${(diff * 100).toFixed(1)}% rvol=${rvol}`
          );
          logRejection(row.symbol, 'price_mismatch', row, engine);
          return { ...row, valid: false, issues: ['price_mismatch'] };
        }
        // FMP price matches → extreme RVOL/move is real momentum, allow
        console.log(
          `[DATA CONFIRMED] ${row.symbol} rvol=${rvol} chg=${chg.toFixed(1)}% — FMP cross-check passed`
        );
        return { ...row, valid: true, issues: [] };
      }
    }

    // FMP unavailable → conservative reject for extreme values
    const issues = [];
    if (rvol > EXTREME_RVOL)            issues.push('extreme_rvol');
    if (Math.abs(chg) > EXTREME_MOVE_PCT) issues.push('extreme_move');
    totalRejected++;
    console.log(`[DATA REJECTED] ${row.symbol} reason=${issues.join(',')} (FMP unavailable for confirmation)`);
    logRejection(row.symbol, issues.join(','), row, engine);
    return { ...row, valid: false, issues };
  }

  // ── Normal values: price sanity cross-check (uses cache, non-blocking) ───
  const external = await crossCheckWithFMP(row.symbol);
  if (external) {
    const fmpPrice = toNum(external.price);
    if (fmpPrice > 0) {
      const diff = Math.abs((price - fmpPrice) / fmpPrice);
      if (diff > PRICE_MISMATCH_PCT) {
        totalRejected++;
        console.log(
          `[DATA REJECTED] ${row.symbol} reason=price_mismatch ` +
          `local=${price} fmp=${fmpPrice} diff=${(diff * 100).toFixed(1)}%`
        );
        logRejection(row.symbol, 'price_mismatch', row, engine);
        return { ...row, valid: false, issues: ['price_mismatch'] };
      }
    }
  }

  return { ...row, valid: true, issues: [] };
}

// ── Stats for health endpoint ─────────────────────────────────────────────────

function getValidationStats() {
  return {
    total_checked:    totalChecked,
    total_rejected:   totalRejected,
    rejection_rate:   totalChecked > 0
      ? Number((totalRejected / totalChecked * 100).toFixed(2))
      : 0,
  };
}

// ── Periodic log purge (keeps table small, call from a scheduler) ─────────────
async function purgeOldValidationLogs() {
  try {
    const { rowCount } = await queryWithTimeout(
      `DELETE FROM data_validation_log WHERE created_at < NOW() - INTERVAL '7 days'`,
      [],
      { timeoutMs: 10000, label: 'validation.purge_old_logs', maxRetries: 0 }
    );
    if (rowCount > 0) console.log('[VALIDATION LOG] purged', rowCount, 'rows older than 7 days');
  } catch (err) {
    console.warn('[VALIDATION LOG] purge failed:', err.message);
  }
}

module.exports = {
  validateMarketData,
  validateAndEnrich,
  getValidationStats,
  purgeOldValidationLogs,
};
