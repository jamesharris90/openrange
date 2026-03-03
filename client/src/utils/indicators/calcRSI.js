/**
 * Wilder's RSI (14-period by default).
 * CRITICAL: copies time directly from input candles.
 * @param {Array} candles - [{ time, close, ... }]
 * @param {number} period
 * @returns {Array} [{ time, value }] — values 0–100
 */
export function calcRSI(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return [];

  const closes = candles.map(c => Number(c.close));
  const result = [];

  // Seed: average gain/loss over first `period` changes
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Wilder's smoothing from index `period + 1` onward
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push({ time: candles[i].time, value: 100 - 100 / (1 + rs) });
  }
  return result;
}
