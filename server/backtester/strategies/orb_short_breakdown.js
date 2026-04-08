const {
  averageDailyVolumeBeforeDate,
  buildIntradayDailyMap,
  createSignal,
  evaluateWithOptions,
  gapPercent,
  getPreviousClose,
  getRegularSessionBars,
  isDateInScanRange,
  openingRange,
  sum,
  toNumber,
  atrBeforeDate,
} = require('./_common');

const STRATEGY_ID = 'orb_short_breakdown';

module.exports = {
  id: STRATEGY_ID,
  name: 'ORB Short Breakdown',
  category: 'intraday_momentum',
  timeframe: 'intraday',
  holdPeriod: 'same_day',
  dataRequired: 'intraday_1m',

  async scan(symbol, intradayBars, context) {
    const signals = [];
    const sessions = buildIntradayDailyMap(intradayBars);
    for (const [sessionDate, rawBars] of sessions.entries()) {
      if (!isDateInScanRange(sessionDate, context.scanRange)) continue;
      const bars = getRegularSessionBars(rawBars);
      if (bars.length < 15) continue;
      const previousClose = getPreviousClose(context.dailyBars, sessionDate);
      const dayOpen = toNumber(bars[0].open);
      const gap = gapPercent(dayOpen, previousClose);
      const avgVolume = averageDailyVolumeBeforeDate(context.dailyBars, sessionDate, 20);
      const atr14 = atrBeforeDate(context.dailyBars, sessionDate, 14);
      if (gap === null || gap > -1 || avgVolume === null || avgVolume < 500000 || dayOpen < 1 || (atr14 || 0) < 0.3) continue;

      const openingBars = bars.slice(0, 5);
      const range = openingRange(openingBars, 5);
      const openingVolumeAverage = sum(openingBars.map((bar) => bar.volume)) / openingBars.length;
      for (let index = 5; index < Math.min(bars.length, 80); index += 1) {
        const bar = bars[index];
        if (toNumber(bar.close) >= range.low) continue;
        if (toNumber(bar.volume, 0) < openingVolumeAverage * 1.5) continue;

        const entryPrice = toNumber(bar.close);
        const stopPrice = range.high;
        const targetPrice = entryPrice - ((range.high - range.low) * 1.5);
        signals.push(createSignal(STRATEGY_ID, symbol, {
          signalDate: sessionDate,
          direction: 'short',
          entryPrice,
          stopPrice,
          targetPrice,
          entryTimestamp: bar.timestamp,
          metadata: {
            gap_percent: gap,
            opening_range_high: range.high,
            opening_range_low: range.low,
            projectedEntryLevel: 'break below first 5-minute low',
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