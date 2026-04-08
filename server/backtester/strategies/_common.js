const { ATR, SMA, VWAP, gapPercent, isHammer, openingRange, relativeVolume } = require('../indicators');
const { evaluateRiskModel } = require('../evaluator');
const {
  aggregateBarsByMinutes,
  average,
  filterEventsInWindow,
  getNextDailyBar,
  getPreviousDailyBar,
  groupBarsByDate,
  isDateInScanRange,
  max,
  min,
  sortBars,
  sum,
  toDateKey,
  toNumber,
} = require('../utils');

function getRegularSessionBars(bars) {
  const regular = (Array.isArray(bars) ? bars : []).filter((bar) => !bar.session || String(bar.session).toUpperCase() === 'REGULAR');
  return regular.length ? regular : (Array.isArray(bars) ? bars : []);
}

function averageDailyVolumeBeforeDate(dailyBars, dateKey, lookback = 20) {
  const bars = sortBars(dailyBars, 'date').filter((bar) => toDateKey(bar.date) < toDateKey(dateKey));
  return average(bars.slice(-lookback).map((bar) => bar.volume));
}

function atrBeforeDate(dailyBars, dateKey, lookback = 14) {
  const bars = sortBars(dailyBars, 'date').filter((bar) => toDateKey(bar.date) < toDateKey(dateKey));
  return ATR(bars, lookback).slice(-1)[0];
}

function smaBeforeDate(dailyBars, dateKey, lookback) {
  const bars = sortBars(dailyBars, 'date').filter((bar) => toDateKey(bar.date) <= toDateKey(dateKey));
  return SMA(bars, lookback).slice(-1)[0];
}

function recentSwingHigh(dailyBars, dateKey, lookback = 20) {
  const bars = sortBars(dailyBars, 'date').filter((bar) => toDateKey(bar.date) < toDateKey(dateKey));
  return max(bars.slice(-lookback).map((bar) => bar.high));
}

function recentSwingLow(dailyBars, dateKey, lookback = 20) {
  const bars = sortBars(dailyBars, 'date').filter((bar) => toDateKey(bar.date) < toDateKey(dateKey));
  return min(bars.slice(-lookback).map((bar) => bar.low));
}

function getDailyBarOnDate(dailyBars, dateKey) {
  return sortBars(dailyBars, 'date').find((bar) => toDateKey(bar.date) === toDateKey(dateKey)) || null;
}

function computeEarningsBeat(event) {
  if (!event) return false;
  const actual = toNumber(event.eps_actual);
  const estimate = toNumber(event.eps_estimate);
  if (actual !== null && estimate !== null) return actual > estimate;
  return false;
}

function findNewsWithinHours(news, anchorDate, hours) {
  return filterEventsInWindow(news, anchorDate, hours / 24, 0, 'published_at');
}

function hasEarningsWithinDays(earnings, anchorDate, days) {
  return filterEventsInWindow(earnings, anchorDate, days, days, 'report_date').length > 0;
}

function getPremarketBars(bars) {
  return (Array.isArray(bars) ? bars : []).filter((bar) => String(bar.session || '').toUpperCase() === 'PREMARKET');
}

function firstSignalOnly(signals) {
  return Array.isArray(signals) && signals.length ? [signals[0]] : [];
}

function createSignal(strategyId, symbol, payload) {
  return {
    strategyId,
    symbol,
    signal_date: payload.signalDate,
    direction: payload.direction,
    entryPrice: payload.entryPrice,
    stopPrice: payload.stopPrice,
    targetPrice: payload.targetPrice,
    entryTimestamp: payload.entryTimestamp || null,
    entryDate: payload.entryDate || payload.signalDate,
    metadata: payload.metadata || {},
  };
}

function evaluateWithOptions(signal, bars, options) {
  return evaluateRiskModel(signal, bars, options);
}

function buildIntradayDailyMap(intradayBars) {
  return groupBarsByDate(intradayBars);
}

function getPreviousClose(dailyBars, dateKey) {
  return toNumber(getPreviousDailyBar(dailyBars, dateKey)?.close);
}

function getNextDailyOpen(dailyBars, dateKey) {
  return toNumber(getNextDailyBar(dailyBars, dateKey)?.open);
}

function getDailyBarsBefore(dailyBars, dateKey, count) {
  const bars = sortBars(dailyBars, 'date').filter((bar) => toDateKey(bar.date) < toDateKey(dateKey));
  return bars.slice(-count);
}

function getDailyBarsThrough(dailyBars, dateKey, count) {
  const bars = sortBars(dailyBars, 'date').filter((bar) => toDateKey(bar.date) <= toDateKey(dateKey));
  return bars.slice(-count);
}

module.exports = {
  ATR,
  SMA,
  VWAP,
  aggregateBarsByMinutes,
  atrBeforeDate,
  averageDailyVolumeBeforeDate,
  buildIntradayDailyMap,
  computeEarningsBeat,
  createSignal,
  evaluateWithOptions,
  findNewsWithinHours,
  firstSignalOnly,
  gapPercent,
  getDailyBarOnDate,
  getDailyBarsBefore,
  getDailyBarsThrough,
  getNextDailyOpen,
  getPremarketBars,
  getPreviousClose,
  getRegularSessionBars,
  hasEarningsWithinDays,
  isDateInScanRange,
  isHammer,
  max,
  min,
  openingRange,
  recentSwingHigh,
  recentSwingLow,
  relativeVolume,
  smaBeforeDate,
  sortBars,
  sum,
  toDateKey,
  toNumber,
};