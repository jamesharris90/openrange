/**
 * Session-anchored VWAP. Resets when the UTC date changes between candles.
 * CRITICAL: copies time directly from input candles.
 * @param {Array} candles - [{ time, high, low, close, volume }] — time is Unix seconds
 * @returns {Array} [{ time, value }]
 */
export function calcVWAP(candles) {
  if (!Array.isArray(candles) || !candles.length) return [];
  const result = [];
  let cumPV = 0;
  let cumVol = 0;
  let prevDate = null;

  for (const c of candles) {
    const d = new Date(Number(c.time) * 1000);
    const date = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
    if (date !== prevDate) {
      cumPV = 0;
      cumVol = 0;
      prevDate = date;
    }
    const vol = Number(c.volume) || 0;
    const tp = (Number(c.high) + Number(c.low) + Number(c.close)) / 3;
    cumPV += tp * vol;
    cumVol += vol;
    result.push({ time: c.time, value: cumVol > 0 ? cumPV / cumVol : tp });
  }
  return result;
}
