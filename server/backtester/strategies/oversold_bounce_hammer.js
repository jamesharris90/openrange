const {
  aggregateBarsByMinutes,
  averageDailyVolumeBeforeDate,
  buildIntradayDailyMap,
  createSignal,
  evaluateWithOptions,
  getPreviousClose,
  getRegularSessionBars,
  hasEarningsWithinDays,
  isDateInScanRange,
  isHammer,
  min,
  toNumber,
} = require('./_common');

const STRATEGY_ID = 'oversold_bounce_hammer';

module.exports = {
  id: STRATEGY_ID,
  name: 'Oversold Bounce Hammer',
  category: 'intraday_reversal',
  timeframe: 'intraday',
  holdPeriod: 'same_day',
  dataRequired: 'intraday_1m',

  async scan(symbol, intradayBars, context) {
    const signals = [];
    const sessions = buildIntradayDailyMap(intradayBars);
    for (const [sessionDate, rawBars] of sessions.entries()) {
      if (!isDateInScanRange(sessionDate, context.scanRange)) continue;
      if (hasEarningsWithinDays(context.earnings, sessionDate, 2)) continue;
      const bars = getRegularSessionBars(rawBars);
      if (bars.length < 30) continue;
      const previousClose = getPreviousClose(context.dailyBars, sessionDate);
      const avgDailyVolume = averageDailyVolumeBeforeDate(context.dailyBars, sessionDate, 20);
      if (previousClose === null || (avgDailyVolume || 0) < 300000) continue;

      const sessionLow = min(bars.map((bar) => bar.low));
      const dropPercent = ((sessionLow - previousClose) / previousClose) * 100;
      if (dropPercent > -5) continue;

      const bars5m = aggregateBarsByMinutes(bars, 5);
      for (let index = 2; index < bars5m.length - 1; index += 1) {
        const hammerBar = bars5m[index];
        if (!isHammer(hammerBar)) continue;
        const confirmBar = bars5m[index + 1];
        if (toNumber(confirmBar.close) <= toNumber(hammerBar.high)) continue;

        const entryPrice = toNumber(confirmBar.close);
        const stopPrice = toNumber(hammerBar.low) * 0.999;
        const risk = entryPrice - stopPrice;
        if (risk <= 0) continue;

        signals.push(createSignal(STRATEGY_ID, symbol, {
          signalDate: sessionDate,
          direction: 'long',
          entryPrice,
          stopPrice,
          targetPrice: entryPrice + (risk * 1.5),
          entryTimestamp: confirmBar.timestamp,
          metadata: {
            session_drop_percent: dropPercent,
            projectedEntryLevel: 'confirm above 5-minute hammer high',
          },
        }));
        break;
      }
    }
    return signals;
  },

  async evaluate(signal, subsequentBars) {
    return evaluateWithOptions(signal, subsequentBars, { maxBars: 45 });
  },
};