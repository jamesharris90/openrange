const {
  averageDailyVolumeBeforeDate,
  buildIntradayDailyMap,
  createSignal,
  evaluateWithOptions,
  findNewsWithinHours,
  getPreviousClose,
  getRegularSessionBars,
  isDateInScanRange,
  max,
  min,
  toNumber,
} = require('./_common');

const STRATEGY_ID = 'news_momentum_breakout';

module.exports = {
  id: STRATEGY_ID,
  name: 'News Momentum Breakout',
  category: 'intraday_catalyst',
  timeframe: 'intraday',
  holdPeriod: 'same_day',
  dataRequired: 'intraday_1m',

  async scan(symbol, intradayBars, context) {
    const signals = [];
    const sessions = buildIntradayDailyMap(intradayBars);
    for (const [sessionDate, rawBars] of sessions.entries()) {
      if (!isDateInScanRange(sessionDate, context.scanRange)) continue;
      const bars = getRegularSessionBars(rawBars);
      if (bars.length < 20) continue;
      const previousClose = getPreviousClose(context.dailyBars, sessionDate);
      const avgDailyVolume = averageDailyVolumeBeforeDate(context.dailyBars, sessionDate, 20);
      if (previousClose === null || (avgDailyVolume || 0) < 300000) continue;
      if (!findNewsWithinHours(context.news, `${sessionDate}T23:59:59Z`, 4).length) continue;

      const first15High = max(bars.slice(0, 15).map((bar) => bar.high));
      const first15Low = min(bars.slice(0, 15).map((bar) => bar.low));
      const pctChange = ((toNumber(bars[14].close) - previousClose) / previousClose) * 100;
      if (pctChange < 2) continue;

      for (let index = 15; index < Math.min(bars.length, 120); index += 1) {
        const bar = bars[index];
        const avgVolume = bars.slice(Math.max(0, index - 10), index).reduce((total, candidate) => total + toNumber(candidate.volume, 0), 0) / Math.max(1, Math.min(index, 10));
        if (toNumber(bar.close) <= first15High) continue;
        if (toNumber(bar.volume, 0) < avgVolume * 2) continue;

        const entryPrice = toNumber(bar.close);
        const stopPrice = first15Low;
        const risk = entryPrice - stopPrice;
        if (risk <= 0) continue;
        signals.push(createSignal(STRATEGY_ID, symbol, {
          signalDate: sessionDate,
          direction: 'long',
          entryPrice,
          stopPrice,
          targetPrice: entryPrice + (risk * 2),
          entryTimestamp: bar.timestamp,
          metadata: {
            percent_change: pctChange,
            projectedEntryLevel: 'break above first 15-minute high with fresh news',
          },
        }));
        break;
      }
    }
    return signals;
  },

  async evaluate(signal, subsequentBars) {
    return evaluateWithOptions(signal, subsequentBars, { maxBars: 90 });
  },
};