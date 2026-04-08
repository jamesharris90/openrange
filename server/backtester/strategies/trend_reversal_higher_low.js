const {
  averageDailyVolumeBeforeDate,
  createSignal,
  evaluateWithOptions,
  max,
  sortBars,
  toDateKey,
  toNumber,
  isDateInScanRange,
} = require('./_common');

const STRATEGY_ID = 'trend_reversal_higher_low';

module.exports = {
  id: STRATEGY_ID,
  name: 'Trend Reversal Higher Low',
  category: 'daily_swing',
  timeframe: 'daily',
  holdPeriod: 'multi_day',
  dataRequired: 'daily_ohlcv',

  async scan(symbol, dailyBars, context) {
    const bars = sortBars(dailyBars, 'date');
    const signals = [];
    for (let index = 252; index < bars.length - 1; index += 1) {
      const bar = bars[index];
      const signalDate = toDateKey(bar.date);
      if (!isDateInScanRange(signalDate, context.scanRange)) continue;
      const avgVolume = averageDailyVolumeBeforeDate(bars, signalDate, 20);
      if ((avgVolume || 0) < 300000 || toNumber(bar.close) <= 5) continue;

      const trailingYear = bars.slice(index - 252, index + 1);
      const fiftyTwoWeekHigh = max(trailingYear.map((candidate) => candidate.high));
      if (((toNumber(bar.close) - fiftyTwoWeekHigh) / fiftyTwoWeekHigh) > -0.2) continue;

      const leftWindow = bars.slice(index - 30, index - 10);
      const rightWindow = bars.slice(index - 10, index);
      const lowA = leftWindow.reduce((best, candidate) => (!best || toNumber(candidate.low) < toNumber(best.low) ? candidate : best), null);
      const lowB = rightWindow.reduce((best, candidate) => (!best || toNumber(candidate.low) < toNumber(best.low) ? candidate : best), null);
      if (!lowA || !lowB || toNumber(lowB.low) <= toNumber(lowA.low)) continue;

      const necklineZone = bars.slice(bars.indexOf(lowA) + 1, bars.indexOf(lowB));
      const neckline = max(necklineZone.map((candidate) => candidate.high));
      if (!neckline || toNumber(bar.close) <= neckline) continue;

      const entryPrice = toNumber(bars[index + 1].open);
      const stopPrice = toNumber(lowB.low);
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
          neckline,
          projectedEntryLevel: 'next open after higher-low neckline breakout',
        },
      }));
    }
    return signals;
  },

  async evaluate(signal, subsequentBars) {
    return evaluateWithOptions(signal, subsequentBars, { maxBars: 15 });
  },
};