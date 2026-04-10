'use strict';

/**
 * contractValidator.js
 * Hard data contract enforcement utilities.
 * Endpoints must return { success: false, error: "NO_REAL_DATA", ... } when
 * required fields are absent or all data is zeroed/null.
 */

function validateOHLC(data) {
  if (!Array.isArray(data)) return false;
  return data.every((d) => d?.timestamp && d?.open !== undefined && d?.close !== undefined);
}

/**
 * Validate an array of quote objects.
 * Passes if at least one row has a real symbol AND price > 0.
 */
function validateQuotes(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return rows.some((r) => r?.symbol && Number(r?.price) > 0);
}

/**
 * Validate an array of signal/opportunity objects.
 * Passes if at least one row has a real symbol AND confidence > 0.
 */
function validateSignals(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return rows.some((r) => r?.symbol && Number(r?.confidence ?? r?.score ?? 1) > 0);
}

/**
 * Validate an array of OHLCV candles.
 * Passes if at least one row has close > 0.
 */
function validateCandles(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return rows.some((r) => Number(r?.close) > 0);
}

/**
 * Build a NO_REAL_DATA error response.
 * @param {string} [detail]  optional context (e.g. "quotes", "signals")
 */
function noRealDataResponse(detail) {
  return {
    success: false,
    error: 'NO_REAL_DATA',
    detail: detail || 'Required data fields are missing or all-zero',
    data: [],
  };
}

/**
 * Build a stale-data response (data exists but is old).
 * @param {any[]} data
 * @param {string} staleSince  ISO timestamp of last known good update
 */
function staleDataResponse(data, staleSince) {
  return {
    success: true,
    stale: true,
    stale_since: staleSince,
    data: Array.isArray(data) ? data : [],
  };
}

module.exports = {
  validateOHLC,
  validateQuotes,
  validateSignals,
  validateCandles,
  noRealDataResponse,
  staleDataResponse,
};
