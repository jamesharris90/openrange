const { average, max, min, toNumber } = require('./utils');

function SMA(bars, period) {
  const size = Math.max(1, Number(period) || 1);
  const closes = (Array.isArray(bars) ? bars : []).map((bar) => toNumber(bar.close));
  return closes.map((_, index) => {
    if (index + 1 < size) return null;
    return average(closes.slice(index + 1 - size, index + 1));
  });
}

function EMA(bars, period) {
  const size = Math.max(1, Number(period) || 1);
  const multiplier = 2 / (size + 1);
  const closes = (Array.isArray(bars) ? bars : []).map((bar) => toNumber(bar.close));
  let previous = null;
  return closes.map((close, index) => {
    if (close === null) return null;
    if (index + 1 < size) return null;
    if (previous === null) {
      previous = average(closes.slice(index + 1 - size, index + 1));
      return previous;
    }
    previous = ((close - previous) * multiplier) + previous;
    return previous;
  });
}

function VWAP(bars) {
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;
  return (Array.isArray(bars) ? bars : []).map((bar) => {
    const high = toNumber(bar.high, 0);
    const low = toNumber(bar.low, 0);
    const close = toNumber(bar.close, 0);
    const volume = toNumber(bar.volume, 0);
    const typicalPrice = (high + low + close) / 3;
    cumulativePriceVolume += typicalPrice * volume;
    cumulativeVolume += volume;
    return cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : null;
  });
}

function ATR(bars, period) {
  const size = Math.max(1, Number(period) || 1);
  const trueRanges = (Array.isArray(bars) ? bars : []).map((bar, index, source) => {
    const high = toNumber(bar.high, 0);
    const low = toNumber(bar.low, 0);
    const previousClose = toNumber(source[index - 1]?.close, high);
    return max([
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose),
    ]);
  });

  return trueRanges.map((_, index) => {
    if (index + 1 < size) return null;
    return average(trueRanges.slice(index + 1 - size, index + 1));
  });
}

function RSI(bars, period) {
  const size = Math.max(1, Number(period) || 1);
  const closes = (Array.isArray(bars) ? bars : []).map((bar) => toNumber(bar.close));
  const gains = [];
  const losses = [];

  for (let index = 1; index < closes.length; index += 1) {
    const delta = toNumber(closes[index], 0) - toNumber(closes[index - 1], 0);
    gains.push(Math.max(delta, 0));
    losses.push(Math.max(-delta, 0));
  }

  return closes.map((_, index) => {
    if (index < size) return null;
    const avgGain = average(gains.slice(index - size, index));
    const avgLoss = average(losses.slice(index - size, index));
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  });
}

function relativeVolume(bars, period) {
  const size = Math.max(1, Number(period) || 1);
  const volumes = (Array.isArray(bars) ? bars : []).map((bar) => toNumber(bar.volume));
  return volumes.map((volume, index) => {
    if (volume === null || index + 1 < size) return null;
    const base = average(volumes.slice(index + 1 - size, index + 1));
    return base > 0 ? volume / base : null;
  });
}

function isHammer(bar) {
  const open = toNumber(bar.open, 0);
  const high = toNumber(bar.high, 0);
  const low = toNumber(bar.low, 0);
  const close = toNumber(bar.close, 0);
  const body = Math.abs(close - open);
  const lowerWick = Math.min(open, close) - low;
  const upperWick = high - Math.max(open, close);
  return lowerWick >= (body * 2) && upperWick <= Math.max(body * 0.5, 0.0001);
}

function openingRange(bars, minutes) {
  const windowBars = (Array.isArray(bars) ? bars : []).slice(0, Math.max(1, Number(minutes) || 1));
  if (!windowBars.length) {
    return { high: null, low: null, height: null };
  }

  const high = max(windowBars.map((bar) => bar.high));
  const low = min(windowBars.map((bar) => bar.low));
  return {
    high,
    low,
    height: high !== null && low !== null ? high - low : null,
  };
}

function gapPercent(todayOpen, prevClose) {
  const open = toNumber(todayOpen);
  const previous = toNumber(prevClose);
  if (open === null || previous === null || previous === 0) return null;
  return ((open - previous) / previous) * 100;
}

module.exports = {
  ATR,
  EMA,
  RSI,
  SMA,
  VWAP,
  gapPercent,
  isHammer,
  openingRange,
  relativeVolume,
};