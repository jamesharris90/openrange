const {
  aggregateBarsByMinutes,
  averageDailyVolumeBeforeDate,
  buildIntradayDailyMap,
  createSignal,
  evaluateWithOptions,
  getRegularSessionBars,
  isDateInScanRange,
  max,
  toNumber,
  VWAP,
} = require('./_common');

const STRATEGY_ID = 'vwap_mean_revert_short';

module.exports = {
  id: STRATEGY_ID,
  name: 'VWAP Mean Revert Short',
  category: 'intraday_reversal',
  timeframe: 'intraday',
  holdPeriod: 'same_day',
  dataRequired: 'intraday_1m',

  async scan(symbol, intradayBars, context) {
    const signals = [];
    const sessions = buildIntradayDailyMap(intradayBars);
    for (const [sessionDate, rawBars] of sessions.entries()) {
      if (!isDateInScanRange(sessionDate, context.scanRange)) continue;
      const bars = getRegularSessionBars(rawBars);
      if (bars.length < 30) continue;
      const avgDailyVolume = averageDailyVolumeBeforeDate(context.dailyBars, sessionDate, 20);
      const open = toNumber(bars[0].open);
      if (open < 3 || open > 80 || (avgDailyVolume || 0) < 500000) continue;

      const vwapSeries = VWAP(bars);
      const bars5m = aggregateBarsByMinutes(bars, 5);
      let highOfDay = toNumber(bars[0].high);
      for (let index = 1; index < bars5m.length; index += 1) {
        const bar = bars5m[index];
        const underlyingIndex = Math.min((index * 5) + 4, vwapSeries.length - 1);
        const vwap = toNumber(vwapSeries[underlyingIndex]);
        if (!vwap) continue;
        const extension = ((toNumber(bar.high) - vwap) / vwap) * 100;
        const priorBar = bars5m[index - 1];
        highOfDay = Math.max(highOfDay, toNumber(bar.high, highOfDay));
        if (extension < 5) continue;
        if (toNumber(bar.close) >= toNumber(priorBar.low)) continue;
        if (toNumber(bar.high) >= toNumber(priorBar.high)) continue;
        if (toNumber(bar.close) >= toNumber(priorBar.close)) continue;

        const entryPrice = toNumber(bar.close);
        const stopPrice = highOfDay * 1.002;
        const targetPrice = vwap;
        if (stopPrice <= entryPrice || targetPrice >= entryPrice) continue;
        signals.push(createSignal(STRATEGY_ID, symbol, {
          signalDate: sessionDate,
          direction: 'short',
          entryPrice,
          stopPrice,
          targetPrice,
          entryTimestamp: bar.timestamp,
          metadata: {
            extension_percent: extension,
            projectedEntryLevel: '5-minute reversal back toward VWAP',
          },
        }));
        break;
      }
    }
    return signals;
  },

  async evaluate(signal, subsequentBars) {
    return evaluateWithOptions(signal, subsequentBars, { maxBars: 60 });
  },
};