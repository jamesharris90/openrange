const {
  averageDailyVolumeBeforeDate,
  createSignal,
  evaluateWithOptions,
  getDailyBarsBefore,
  isDateInScanRange,
  max,
  min,
  smaBeforeDate,
  sortBars,
  toDateKey,
  toNumber,
} = require('./_common');

const STRATEGY_ID = 'breakout_consolidation';

module.exports = {
  id: STRATEGY_ID,
  name: 'Breakout Consolidation',
  category: 'daily_swing',
  timeframe: 'daily',
  holdPeriod: 'multi_day',
  dataRequired: 'daily_ohlcv',

  async scan(symbol, dailyBars, context) {
    const bars = sortBars(dailyBars, 'date');
    const signals = [];
    for (let index = 20; index < bars.length - 1; index += 1) {
      const bar = bars[index];
      const signalDate = toDateKey(bar.date);
      const setupBars = getDailyBarsBefore(bars, signalDate, 10);
      const sma50 = smaBeforeDate(bars, signalDate, 50);
      const avgVolume = averageDailyVolumeBeforeDate(bars, signalDate, 20);
      if (setupBars.length < 10 || !isDateInScanRange(signalDate, context.scanRange)) continue;
      if (toNumber(bar.close) <= 10 || (avgVolume || 0) < 500000 || toNumber(bar.close) <= toNumber(sma50, Infinity)) continue;

      const rangeHigh = max(setupBars.map((candidate) => candidate.high));
      const rangeLow = min(setupBars.map((candidate) => candidate.low));
      const rangePercent = ((rangeHigh - rangeLow) / toNumber(bar.close, 1)) * 100;
      if (rangePercent > 8) continue;
      if (toNumber(bar.close) <= rangeHigh) continue;
      if (toNumber(bar.volume, 0) < (avgVolume * 1.5)) continue;

      const entryPrice = toNumber(bars[index + 1].open);
      const stopPrice = rangeLow;
      const risk = entryPrice - stopPrice;
      if (risk <= 0) continue;
      signals.push(createSignal(STRATEGY_ID, symbol, {
        signalDate,
        entryDate: toDateKey(bars[index + 1].date),
        direction: 'long',
        entryPrice,
        stopPrice,
        targetPrice: entryPrice + (risk * 1.5),
        metadata: {
          consolidation_range_percent: rangePercent,
          projectedEntryLevel: 'next open after breakout above 10-day range',
        },
      }));
    }
    return signals;
  },

  async evaluate(signal, subsequentBars) {
    return evaluateWithOptions(signal, subsequentBars, { maxBars: 10 });
  },
};