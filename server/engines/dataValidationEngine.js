'use strict';

/**
 * Data Validation Engine — Persistent Intelligence System
 *
 * Validates market data rows before any signal engine uses them.
 * Tracks rejection history in DB, survives restarts, scores provider reliability.
 *
 * Checks performed (in priority order):
 *   stale_data             — row.updated_at older than 2 min
 *   invalid_price          — price <= 0
 *   invalid_volume         — volume <= 0
 *   extreme_rvol           — rvol > 10  → FMP cross-check
 *   extreme_move           — |chg%| > 50 → FMP cross-check
 *   volume_spike_unconfirmed — volume > 20x avg_volume_30d → FMP cross-check
 *   price_mismatch         — local vs FMP price divergence > 3%
 */

const { queryWithTimeout } = require('../db/pg');

// ── Thresholds ────────────────────────────────────────────────────────────────
const EXTREME_RVOL         = 10;
const EXTREME_MOVE_PCT     = 50;
const PRICE_MISMATCH_PCT   = 0.03;
const STALE_THRESHOLD_MS   = 2 * 60 * 1000;   // 2 minutes
const VOLUME_SPIKE_RATIO   = 20;               // 20x avg_volume_30d
const FMP_TIMEOUT_MS       = 5000;
const FMP_CACHE_TTL_MS     = 60_000;

// ── FMP quote cache ───────────────────────────────────────────────────────────
const fmpCache = new Map();

// ── In-memory counters (cumulative since process start) ───────────────────────
let totalChecked   = 0;
let totalRejected  = 0;

// Batch counters (reset on each flushValidationMetrics call)
let batchChecked   = 0;
let batchRejected  = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Fire-and-forget rejection log insert — never throws.
 * Writes to data_validation_log with full cross-check detail.
 */
function logRejection(symbol, issue, row, engine, externalPrice, diffPct) {
  const localPrice = row.price != null ? toNum(row.price) : null;
  queryWithTimeout(
    `INSERT INTO data_validation_log
       (symbol, issue, price, change_percent, relative_volume, engine,
        provider, local_price, external_price, diff_percent)
     VALUES ($1,$2,$3,$4,$5,$6,'fmp',$7,$8,$9)`,
    [
      symbol,
      issue,
      localPrice,
      row.change_percent != null ? toNum(row.change_percent) : null,
      row.relative_volume != null ? toNum(row.relative_volume) : null,
      engine || null,
      localPrice,
      externalPrice != null ? toNum(externalPrice) : null,
      diffPct       != null ? toNum(diffPct)        : null,
    ],
    { timeoutMs: 3000, label: 'validation.log_rejection', maxRetries: 0 }
  ).catch((err) => {
    console.warn('[VALIDATION LOG] insert failed:', err.message);
  });
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
    const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FMP_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) { fmpCache.set(symbol, { data: null, fetchedAt: Date.now() }); return null; }

    const json = await res.json();
    const quote = Array.isArray(json) ? (json[0] || null) : null;
    fmpCache.set(symbol, { data: quote, fetchedAt: Date.now() });
    return quote;
  } catch {
    fmpCache.set(symbol, { data: null, fetchedAt: Date.now() });
    return null;
  }
}

// ── Core field validation (synchronous checks only) ───────────────────────────

async function validateMarketData(row) {
  const issues = [];

  // Stale data: only check if updated_at is present on the row
  if (row.updated_at) {
    const age = Date.now() - new Date(row.updated_at).getTime();
    if (age > STALE_THRESHOLD_MS) {
      issues.push('stale_data');
    }
  }

  if (!row.price || toNum(row.price) <= 0) {
    issues.push('invalid_price');
  }

  if (toNum(row.volume) <= 0) {
    issues.push('invalid_volume');
  }

  if (Math.abs(toNum(row.change_percent)) > EXTREME_MOVE_PCT) {
    issues.push('extreme_move');
  }

  if (toNum(row.relative_volume) > EXTREME_RVOL) {
    issues.push('extreme_rvol');
  }

  const avgVol = toNum(row.avg_volume_30d);
  const vol    = toNum(row.volume);
  if (avgVol > 0 && vol > avgVol * VOLUME_SPIKE_RATIO) {
    issues.push('volume_spike_unconfirmed');
  }

  return { valid: issues.length === 0, issues };
}

// ── Validation + FMP cross-check wrapper ─────────────────────────────────────

/**
 * Validates a market data row and cross-checks with FMP when needed.
 *
 * Hard rejects (no cross-check): stale_data, invalid_price, invalid_volume
 * Soft rejects (FMP cross-check): extreme_rvol, extreme_move, volume_spike_unconfirmed
 *   → If FMP price confirms within 3%: allow (real market event)
 *   → If FMP price diverges >3%: reject as price_mismatch
 *   → If FMP unavailable: conservative reject
 *
 * @param {object} row     Row from market_quotes / tradable_universe
 *   Expected optional fields: updated_at, avg_volume_30d (for stale/volume checks)
 * @param {string} engine  Source engine name for the rejection log
 */
async function validateAndEnrich(row, engine) {
  totalChecked++;
  batchChecked++;

  const price = toNum(row.price);
  const chg   = toNum(row.change_percent);
  const rvol  = toNum(row.relative_volume);
  const vol   = toNum(row.volume);

  // ── Hard fail: stale data ────────────────────────────────────────────────
  if (row.updated_at) {
    const age = Date.now() - new Date(row.updated_at).getTime();
    if (age > STALE_THRESHOLD_MS) {
      totalRejected++; batchRejected++;
      console.log(`[DATA REJECTED] ${row.symbol} reason=stale_data age=${Math.round(age / 1000)}s`);
      logRejection(row.symbol, 'stale_data', row, engine);
      return { ...row, valid: false, issues: ['stale_data'] };
    }
  }

  // ── Hard fail: invalid price ─────────────────────────────────────────────
  if (!price || price <= 0) {
    totalRejected++; batchRejected++;
    console.log(`[DATA REJECTED] ${row.symbol} reason=invalid_price`);
    logRejection(row.symbol, 'invalid_price', row, engine);
    return { ...row, valid: false, issues: ['invalid_price'] };
  }

  // ── Hard fail: invalid volume ────────────────────────────────────────────
  if (vol <= 0) {
    totalRejected++; batchRejected++;
    console.log(`[DATA REJECTED] ${row.symbol} reason=invalid_volume`);
    logRejection(row.symbol, 'invalid_volume', row, engine);
    return { ...row, valid: false, issues: ['invalid_volume'] };
  }

  // ── Check if cross-check needed ──────────────────────────────────────────
  const avgVol = toNum(row.avg_volume_30d);
  const needsCrossCheck =
    rvol > EXTREME_RVOL ||
    Math.abs(chg) > EXTREME_MOVE_PCT ||
    (avgVol > 0 && vol > avgVol * VOLUME_SPIKE_RATIO);

  if (needsCrossCheck) {
    const external = await crossCheckWithFMP(row.symbol);

    if (external) {
      const fmpPrice = toNum(external.price);
      if (fmpPrice > 0) {
        const diff = Math.abs((price - fmpPrice) / fmpPrice);
        if (diff > PRICE_MISMATCH_PCT) {
          totalRejected++; batchRejected++;
          const diffPct = Number((diff * 100).toFixed(2));
          console.log(
            `[DATA REJECTED] ${row.symbol} reason=price_mismatch ` +
            `local=${price} fmp=${fmpPrice} diff=${diffPct}% rvol=${rvol}`
          );
          logRejection(row.symbol, 'price_mismatch', row, engine, fmpPrice, diffPct);
          return { ...row, valid: false, issues: ['price_mismatch'] };
        }
        // FMP price confirms — extreme values are REAL, allow
        console.log(
          `[DATA CONFIRMED] ${row.symbol} rvol=${rvol} chg=${chg.toFixed(1)}% ` +
          `vol=${vol} — FMP cross-check passed`
        );
        return { ...row, valid: true, issues: [] };
      }
    }

    // FMP unavailable — conservative reject
    const issues = [];
    if (rvol > EXTREME_RVOL)                issues.push('extreme_rvol');
    if (Math.abs(chg) > EXTREME_MOVE_PCT)    issues.push('extreme_move');
    if (avgVol > 0 && vol > avgVol * VOLUME_SPIKE_RATIO) issues.push('volume_spike_unconfirmed');

    totalRejected++; batchRejected++;
    console.log(`[DATA REJECTED] ${row.symbol} reason=${issues.join(',')} (FMP unavailable)`);
    logRejection(row.symbol, issues.join(','), row, engine);
    return { ...row, valid: false, issues };
  }

  // ── Normal values: price sanity cross-check ──────────────────────────────
  const external = await crossCheckWithFMP(row.symbol);
  if (external) {
    const fmpPrice = toNum(external.price);
    if (fmpPrice > 0) {
      const diff = Math.abs((price - fmpPrice) / fmpPrice);
      if (diff > PRICE_MISMATCH_PCT) {
        totalRejected++; batchRejected++;
        const diffPct = Number((diff * 100).toFixed(2));
        console.log(
          `[DATA REJECTED] ${row.symbol} reason=price_mismatch ` +
          `local=${price} fmp=${fmpPrice} diff=${diffPct}%`
        );
        logRejection(row.symbol, 'price_mismatch', row, engine, fmpPrice, diffPct);
        return { ...row, valid: false, issues: ['price_mismatch'] };
      }
    }
  }

  return { ...row, valid: true, issues: [] };
}

// ── Persist batch metrics ─────────────────────────────────────────────────────

/**
 * Writes current batch counters to validation_metrics table and resets them.
 * Call on a timer (every 5 min) or after each engine batch.
 * Safe to call even if no rows were checked since last flush.
 */
async function flushValidationMetrics() {
  if (batchChecked === 0) return;

  const checked  = batchChecked;
  const rejected = batchRejected;
  const rate     = Number((rejected / checked * 100).toFixed(4));

  batchChecked  = 0;
  batchRejected = 0;

  try {
    await queryWithTimeout(
      `INSERT INTO validation_metrics (total_checked, total_rejected, rejection_rate)
       VALUES ($1, $2, $3)`,
      [checked, rejected, rate],
      { timeoutMs: 5000, label: 'validation.flush_metrics', maxRetries: 0 }
    );
    console.log('[VALIDATION] metrics flushed', { checked, rejected, rate: `${rate}%` });
  } catch (err) {
    console.warn('[VALIDATION] metrics flush failed:', err.message);
    // Restore counters so they are not lost
    batchChecked  += checked;
    batchRejected += rejected;
  }
}

// ── Stats accessors ───────────────────────────────────────────────────────────

/** Fast in-memory stats for the current process session. */
function getValidationStats() {
  return {
    total_checked:  totalChecked,
    total_rejected: totalRejected,
    rejection_rate: totalChecked > 0
      ? Number((totalRejected / totalChecked * 100).toFixed(2))
      : 0,
    pending_flush: { checked: batchChecked, rejected: batchRejected },
  };
}

/**
 * DB-backed stats — queries validation_metrics for the last N hours.
 * Use for the health/validation endpoints (non-latency-critical paths).
 */
async function getPersistedValidationStats(hours = 24) {
  try {
    const res = await queryWithTimeout(
      `SELECT
         COALESCE(SUM(total_checked),  0)::int   AS total_checked,
         COALESCE(SUM(total_rejected), 0)::int   AS total_rejected,
         CASE WHEN SUM(total_checked) > 0
              THEN ROUND((SUM(total_rejected)::numeric / SUM(total_checked) * 100), 2)
              ELSE 0
         END AS rejection_rate,
         MAX(timestamp) AS last_snapshot
       FROM validation_metrics
       WHERE timestamp > NOW() - INTERVAL '${Number(hours)} hours'`,
      [],
      { timeoutMs: 5000, label: 'validation.get_persisted_stats', maxRetries: 0 }
    );
    const row = res.rows?.[0] || {};
    return {
      total_checked:   Number(row.total_checked   || 0),
      total_rejected:  Number(row.total_rejected  || 0),
      rejection_rate:  Number(row.rejection_rate  || 0),
      last_snapshot:   row.last_snapshot || null,
      window_hours:    hours,
    };
  } catch (err) {
    console.warn('[VALIDATION] persisted stats query failed:', err.message);
    return null;
  }
}

// ── Log purge ─────────────────────────────────────────────────────────────────

async function purgeOldValidationLogs() {
  try {
    const { rowCount: dvlRows } = await queryWithTimeout(
      `DELETE FROM data_validation_log WHERE created_at < NOW() - INTERVAL '7 days'`,
      [],
      { timeoutMs: 10000, label: 'validation.purge_dvl', maxRetries: 0 }
    );
    const { rowCount: vmRows } = await queryWithTimeout(
      `DELETE FROM validation_metrics WHERE timestamp < NOW() - INTERVAL '30 days'`,
      [],
      { timeoutMs: 10000, label: 'validation.purge_vm', maxRetries: 0 }
    );
    if ((dvlRows + vmRows) > 0) {
      console.log('[VALIDATION LOG] purged', { dvl_rows: dvlRows, vm_rows: vmRows });
    }
  } catch (err) {
    console.warn('[VALIDATION LOG] purge failed:', err.message);
  }
}

module.exports = {
  validateMarketData,
  validateAndEnrich,
  flushValidationMetrics,
  getValidationStats,
  getPersistedValidationStats,
  purgeOldValidationLogs,
};
