'use strict';

/**
 * Data Completeness Engine
 *
 * Scores a signal 0.0–1.0 based on how many critical fields are populated.
 * Used by the snapshot engine to gate low-quality signals.
 *
 * Fields (each worth 1/6):
 *   1. has_price      — entry_price or price > 0
 *   2. has_volume     — volume >= 500_000
 *   3. has_catalyst   — catalyst_type is not null
 *   4. has_news       — news_age_hours < 24 (passed in, not fetched here)
 *   5. has_earnings   — earnings_nearby flag
 *   6. has_atr        — atr > 0
 *
 * Rules:
 *   < 0.5  → REJECT signal entirely
 *   < 0.7  → cap confidence at 50
 *   >= 0.85 → eligible for high-conviction label
 */

/**
 * @param {object} signal
 * @param {number} [signal.price]         — current / entry price
 * @param {number} [signal.volume]        — total volume
 * @param {number} [signal.atr]           — ATR value
 * @param {number} [signal.change_percent]— for existence check
 * @param {string|null} [signal.catalyst] — catalyst label if any
 * @param {boolean} [signal.has_news]     — caller sets true if <24h news exists
 * @param {boolean} [signal.has_earnings] — caller sets true if earnings ±3d
 * @returns {number} completeness score 0.0–1.0
 */
function computeDataCompleteness(signal) {
  const {
    price   = 0,
    volume  = 0,
    atr     = 0,
    catalyst = null,
    has_news = false,
    has_earnings = false,
  } = signal;

  let score = 0;
  const checks = {};

  // 1. Price
  checks.has_price = Number(price) > 0;
  if (checks.has_price) score++;

  // 2. Volume
  checks.has_volume = Number(volume) >= 500_000;
  if (checks.has_volume) score++;

  // 3. Catalyst (confirmed news/earnings/headline)
  checks.has_catalyst = catalyst !== null && catalyst !== undefined && String(catalyst).trim() !== '';
  if (checks.has_catalyst) score++;

  // 4. News freshness
  checks.has_news = Boolean(has_news);
  if (checks.has_news) score++;

  // 5. Earnings proximity
  checks.has_earnings = Boolean(has_earnings);
  if (checks.has_earnings) score++;

  // 6. ATR
  checks.has_atr = Number(atr) > 0;
  if (checks.has_atr) score++;

  const completeness = Math.round((score / 6) * 1000) / 1000; // 3 dp

  return completeness;
}

/**
 * Completeness-based label for narrative injection.
 * @param {number} completeness 0.0–1.0
 * @returns {string}
 */
function completenessLabel(completeness) {
  if (completeness >= 0.85) return 'HIGH_CONVICTION';
  if (completeness >= 0.70) return 'MODERATE';
  if (completeness >= 0.50) return 'LOW_CONVICTION';
  return 'INSUFFICIENT';
}

module.exports = { computeDataCompleteness, completenessLabel };
