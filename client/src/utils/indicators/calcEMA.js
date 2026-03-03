/**
 * Calculates EMA using SMA seed for the first `period` candles.
 * CRITICAL: copies time directly from input candles — never transforms it.
 * @param {Array} candles - [{ time, open, high, low, close, ... }]
 * @param {number} period
 * @returns {Array} [{ time, value }]
 */
export function calcEMA(candles, period) {
  if (!Array.isArray(candles) || candles.length < period) return [];
  const k = 2 / (period + 1);
  const result = [];
  let prev = null;

  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) continue;
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += Number(candles[j].close);
      prev = sum / period;
    } else {
      prev = Number(candles[i].close) * k + prev * (1 - k);
    }
    result.push({ time: candles[i].time, value: prev });
  }
  return result;
}
