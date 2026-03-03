function sma(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function ema(values, period) {
  if (!values.length || values.length < period) return null;
  const k = 2 / (period + 1);
  let acc = sma(values.slice(0, period));
  for (let i = period; i < values.length; i += 1) {
    acc = values[i] * k + acc * (1 - k);
  }
  return acc;
}

function rsi(values, period = 14) {
  if (values.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss += Math.abs(d);
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < values.length; i += 1) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function atr(bars, period = 14) {
  if (!Array.isArray(bars) || bars.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i += 1) {
    const high = Number(bars[i].high);
    const low = Number(bars[i].low);
    const prevClose = Number(bars[i - 1].close);
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }
  return sma(trs.slice(-period));
}

function macd(values) {
  if (!values.length) return { line: null, signal: null, histogram: null };
  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);
  if (ema12 == null || ema26 == null) return { line: null, signal: null, histogram: null };
  const line = ema12 - ema26;
  return { line, signal: null, histogram: null };
}

function calculateTechnicalsForSymbol(row) {
  const closeSeries = Array.isArray(row.closeSeries) ? row.closeSeries.map(Number).filter(Number.isFinite) : [];
  const bars = Array.isArray(row.bars) ? row.bars : [];

  const atr14 = atr(bars, 14);
  const price = Number(row.price);
  const ema9 = ema(closeSeries, 9);
  const ema20 = ema(closeSeries, 20);
  const ema50 = ema(closeSeries, 50);
  const ema200 = ema(closeSeries, 200);

  const emaStackState = [ema9, ema20, ema50, ema200].every((n) => n != null)
    ? (ema9 > ema20 && ema20 > ema50 && ema50 > ema200 ? 'bullish' : 'mixed')
    : null;

  return {
    atr14,
    atrPercent: atr14 != null && price ? (atr14 / price) * 100 : null,
    rsi14: rsi(closeSeries, 14),
    macd: macd(closeSeries),
    ema9,
    ema20,
    ema50,
    ema200,
    emaStackState,
    emaCompressionScore: [ema9, ema20, ema50].every((n) => n != null) && price
      ? ((Math.max(ema9, ema20, ema50) - Math.min(ema9, ema20, ema50)) / price) * 100
      : null,
    aboveVwap: row.vwap != null && price ? price > Number(row.vwap) : null,
    vwapDistancePercent: row.vwap != null && price ? ((price - Number(row.vwap)) / Number(row.vwap)) * 100 : null,
    vwapSlope: null,
    distanceFrom52wHighPercent: row.yearHigh && price ? ((price - Number(row.yearHigh)) / Number(row.yearHigh)) * 100 : null,
    distanceFrom52wLowPercent: row.yearLow && price ? ((price - Number(row.yearLow)) / Number(row.yearLow)) * 100 : null,
    return1D: row.previousClose && price ? ((price - Number(row.previousClose)) / Number(row.previousClose)) * 100 : null,
    return5D: null,
    return1M: null,
    gapPercent: row.open && row.previousClose ? ((Number(row.open) - Number(row.previousClose)) / Number(row.previousClose)) * 100 : null,
    intradayMoveFromOpenPercent: row.open && price ? ((price - Number(row.open)) / Number(row.open)) * 100 : null,
    intradayMoveFromHighPercent: row.dayHigh && price ? ((price - Number(row.dayHigh)) / Number(row.dayHigh)) * 100 : null,
    intradayMoveFromLowPercent: row.dayLow && price ? ((price - Number(row.dayLow)) / Number(row.dayLow)) * 100 : null,
    rangeExpansionScore: row.dayHigh && row.dayLow && atr14 ? (Number(row.dayHigh) - Number(row.dayLow)) / atr14 : null,
    floatRotation: row.float && row.volume ? Number(row.volume) / Number(row.float) : null,
    dollarVolume: row.volume && price ? Number(row.volume) * price : null,
  };
}

async function calculateTechnicals(universe, logger = console) {
  const out = new Map();
  universe.forEach((row) => {
    out.set(row.symbol, calculateTechnicalsForSymbol(row));
  });
  logger.info('Technical calculator complete', { symbols: out.size });
  return out;
}

module.exports = {
  calculateTechnicals,
  calculateTechnicalsForSymbol,
};
