const {
  averageDailyVolumeBeforeDate,
  createSignal,
  evaluateWithOptions,
  sortBars,
  toDateKey,
  toNumber,
  isDateInScanRange,
} = require('./_common');

const STRATEGY_ID = 'volume_climax_reversal';

module.exports = {
  id: STRATEGY_ID,
  name: 'Volume Climax Reversal',
  category: 'daily_swing',
  timeframe: 'daily',
  holdPeriod: 'multi_day',
  dataRequired: 'daily_ohlcv',

  async scan(symbol, dailyBars, context) {
    const bars = sortBars(dailyBars, 'date');
    const signals = [];
    for (let index = 21; index < bars.length; index += 1) {
      const bar = bars[index];
      const previousBar = bars[index - 1];
      const signalDate = toDateKey(bar.date);
      if (!isDateInScanRange(signalDate, context.scanRange)) continue;

      const avgVolume = averageDailyVolumeBeforeDate(bars, toDateKey(previousBar.date), 20);
      const previousDrop = ((toNumber(previousBar.close) - toNumber(bars[index - 2].close)) / toNumber(bars[index - 2].close)) * 100;
      if (previousDrop > -8) continue;
      if (toNumber(previousBar.volume, 0) < (avgVolume * 3)) continue;
      if (Math.abs((toNumber(bar.open) - toNumber(previousBar.close)) / toNumber(previousBar.close)) > 0.02) continue;
      if (toNumber(bar.open) <= toNumber(previousBar.low)) continue;

      const entryPrice = toNumber(bar.open);
      const stopPrice = toNumber(previousBar.low);
      const risk = entryPrice - stopPrice;
      if (risk <= 0) continue;
      const meanReversionTarget = toNumber(previousBar.open);
      signals.push(createSignal(STRATEGY_ID, symbol, {
        signalDate,
        entryDate: signalDate,
        direction: 'long',
        entryPrice,
        stopPrice,
        targetPrice: meanReversionTarget > entryPrice ? Math.min(meanReversionTarget, entryPrice + (risk * 1.5)) : entryPrice + (risk * 1.5),
        metadata: {
          prior_drop_percent: previousDrop,
          projectedEntryLevel: 'open above capitulation low after volume climax',
        },
      }));
    }
    return signals;
  },

  async evaluate(signal, subsequentBars) {
    return evaluateWithOptions(signal, subsequentBars, { maxBars: 3 });
  },
};