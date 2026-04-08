const {
  averageDailyVolumeBeforeDate,
  computeEarningsBeat,
  createSignal,
  evaluateWithOptions,
  isDateInScanRange,
  sortBars,
  toDateKey,
  toNumber,
} = require('./_common');

const STRATEGY_ID = 'earnings_drift_long';

module.exports = {
  id: STRATEGY_ID,
  name: 'Earnings Drift Long',
  category: 'daily_catalyst',
  timeframe: 'daily',
  holdPeriod: 'multi_day',
  dataRequired: 'daily_ohlcv',

  async scan(symbol, dailyBars, context) {
    const bars = sortBars(dailyBars, 'date');
    const signals = [];
    for (let index = 0; index < bars.length - 3; index += 1) {
      const day1 = bars[index];
      const day2 = bars[index + 1];
      const day3 = bars[index + 2];
      const day4 = bars[index + 3];
      const signalDate = toDateKey(day1.date);
      if (!isDateInScanRange(signalDate, context.scanRange)) continue;
      const event = (context.earnings || []).find((candidate) => toDateKey(candidate.report_date) === signalDate);
      if (!event || !computeEarningsBeat(event)) continue;

      const avgVolume = averageDailyVolumeBeforeDate(bars, signalDate, 20);
      const marketCap = toNumber(context.fundamentals.marketCap);
      if ((avgVolume || 0) < 500000 || (marketCap || 0) < 500000000) continue;
      if (toNumber(day2.close) <= toNumber(day1.close) || toNumber(day3.close) <= toNumber(day1.close)) continue;

      const entryPrice = toNumber(day4.open);
      const stopPrice = toNumber(day2.low);
      const risk = entryPrice - stopPrice;
      if (risk <= 0) continue;
      signals.push(createSignal(STRATEGY_ID, symbol, {
        signalDate,
        entryDate: toDateKey(day4.date),
        direction: 'long',
        entryPrice,
        stopPrice,
        targetPrice: entryPrice + (risk * 2),
        metadata: {
          earnings_beat: true,
          projectedEntryLevel: 'day-four open after earnings drift confirmation',
        },
      }));
    }
    return signals;
  },

  async evaluate(signal, subsequentBars) {
    return evaluateWithOptions(signal, subsequentBars, { maxBars: 10, ignoreTarget: true });
  },
};