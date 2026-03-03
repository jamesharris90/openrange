/**
 * Standard MACD (12/26/9).
 * CRITICAL: copies time directly from input candles.
 * @param {Array} candles - [{ time, close, ... }]
 * @returns {{ macdLine: [], signalLine: [], histogram: [] }}
 */
export function calcMACD(candles) {
  const empty = { macdLine: [], signalLine: [], histogram: [] };
  if (!Array.isArray(candles) || candles.length < 35) return empty;

  const closes = candles.map(c => Number(c.close));

  // EMA with SMA seed
  function ema(values, period) {
    const k = 2 / (period + 1);
    const result = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < period; i++) sum += values[i];
    result[period - 1] = sum / period;
    for (let i = period; i < values.length; i++) {
      result[i] = values[i] * k + result[i - 1] * (1 - k);
    }
    return result;
  }

  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);

  // MACD line valid from index 25 (ema26 seed at index 25)
  const macdStart = 25;
  const macdSlice = candles.slice(macdStart).map((c, i) => {
    const m12 = ema12[macdStart + i];
    const m26 = ema26[macdStart + i];
    return m12 !== null && m26 !== null ? m12 - m26 : null;
  });

  // Signal = EMA9 of MACD values
  const signalValues = ema(macdSlice, 9);

  const macdLine = [];
  const signalLine = [];
  const histogram = [];

  for (let i = 0; i < macdSlice.length; i++) {
    const mv = macdSlice[i];
    const sv = signalValues[i];
    if (mv === null || sv === null) continue;
    const c = candles[macdStart + i];
    macdLine.push({ time: c.time, value: mv });
    signalLine.push({ time: c.time, value: sv });
    histogram.push({ time: c.time, value: mv - sv });
  }

  return { macdLine, signalLine, histogram };
}
