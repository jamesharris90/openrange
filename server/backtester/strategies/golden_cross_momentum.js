const {
  averageDailyVolumeBeforeDate,
  createSignal,
  evaluateWithOptions,
  smaBeforeDate,
  sortBars,
  toDateKey,
  toNumber,
  isDateInScanRange,
} = require('./_common');

const STRATEGY_ID = 'golden_cross_momentum';

module.exports = {
  id: STRATEGY_ID,
  name: 'Golden Cross Momentum',
  category: 'daily_swing',
  timeframe: 'daily',
  holdPeriod: 'multi_day',
  dataRequired: 'daily_ohlcv',

  async scan(symbol, dailyBars, context) {
    const bars = sortBars(dailyBars, 'date');
    const signals = [];
    for (let index = 203; index < bars.length - 1; index += 1) {
      const bar = bars[index];
      const signalDate = toDateKey(bar.date);
      if (!isDateInScanRange(signalDate, context.scanRange)) continue;
      const avgVolume = averageDailyVolumeBeforeDate(bars, signalDate, 20);
      if ((avgVolume || 0) < 500000) continue;

      const sma50 = smaBeforeDate(bars, signalDate, 50);
      const sma200 = smaBeforeDate(bars, signalDate, 200);
      const priorSma50 = smaBeforeDate(bars, toDateKey(bars[index - 1].date), 50);
      const priorSma200 = smaBeforeDate(bars, toDateKey(bars[index - 1].date), 200);
      const crossedRecently = (sma50 > sma200) && (priorSma50 <= priorSma200 || (index >= 2 && smaBeforeDate(bars, toDateKey(bars[index - 2].date), 50) <= smaBeforeDate(bars, toDateKey(bars[index - 2].date), 200)));
      if (!crossedRecently) continue;
      if (toNumber(bar.close) <= sma50 || toNumber(bar.close) <= sma200) continue;
      if (toNumber(bar.volume, 0) < (avgVolume * 1.2)) continue;

      const entryPrice = toNumber(bars[index + 1].open);
      const stopPrice = sma200 * 0.99;
      const risk = entryPrice - stopPrice;
      if (risk <= 0) continue;
      signals.push(createSignal(STRATEGY_ID, symbol, {
        signalDate,
        entryDate: toDateKey(bars[index + 1].date),
        direction: 'long',
        entryPrice,
        stopPrice,
        targetPrice: entryPrice + (risk * 2),
        metadata: {
          sma50,
          sma200,
          projectedEntryLevel: 'next open after fresh golden cross confirmation',
        },
      }));
    }
    return signals;
  },

  async evaluate(signal, subsequentBars) {
    return evaluateWithOptions(signal, subsequentBars, { maxBars: 20 });
  },
};