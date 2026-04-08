const {
  averageDailyVolumeBeforeDate,
  createSignal,
  evaluateWithOptions,
  recentSwingHigh,
  smaBeforeDate,
  sortBars,
  toDateKey,
  toNumber,
  isDateInScanRange,
} = require('./_common');

const STRATEGY_ID = 'ma_bounce_50sma';

module.exports = {
  id: STRATEGY_ID,
  name: '50 SMA Bounce',
  category: 'daily_swing',
  timeframe: 'daily',
  holdPeriod: 'multi_day',
  dataRequired: 'daily_ohlcv',

  async scan(symbol, dailyBars, context) {
    const bars = sortBars(dailyBars, 'date');
    const signals = [];
    for (let index = 200; index < bars.length - 1; index += 1) {
      const bar = bars[index];
      const signalDate = toDateKey(bar.date);
      if (!isDateInScanRange(signalDate, context.scanRange)) continue;
      const sma50 = smaBeforeDate(bars, signalDate, 50);
      const sma200 = smaBeforeDate(bars, signalDate, 200);
      const avgVolume = averageDailyVolumeBeforeDate(bars, signalDate, 20);
      if ((avgVolume || 0) < 500000 || toNumber(bar.close) <= 10 || !sma50 || !sma200) continue;
      if (toNumber(bar.close) <= sma200 || sma50 <= sma200) continue;
      if (Math.abs((toNumber(bar.low) - sma50) / sma50) > 0.01) continue;
      if (toNumber(bar.close) <= toNumber(bar.open) || toNumber(bar.close) <= sma50) continue;

      const entryPrice = toNumber(bars[index + 1].open);
      const stopPrice = sma50 * 0.985;
      const risk = entryPrice - stopPrice;
      if (risk <= 0) continue;
      const swingHigh = recentSwingHigh(bars, signalDate, 20) || (entryPrice + (risk * 2));
      signals.push(createSignal(STRATEGY_ID, symbol, {
        signalDate,
        entryDate: toDateKey(bars[index + 1].date),
        direction: 'long',
        entryPrice,
        stopPrice,
        targetPrice: Math.max(swingHigh, entryPrice + (risk * 2)),
        metadata: {
          sma50,
          sma200,
          projectedEntryLevel: 'next open after 50 SMA support bounce',
        },
      }));
    }
    return signals;
  },

  async evaluate(signal, subsequentBars) {
    return evaluateWithOptions(signal, subsequentBars, { maxBars: 10 });
  },
};