const {
  averageDailyVolumeBeforeDate,
  buildIntradayDailyMap,
  createSignal,
  evaluateWithOptions,
  gapPercent,
  getPremarketBars,
  getPreviousClose,
  getRegularSessionBars,
  isDateInScanRange,
  max,
  min,
  toNumber,
  VWAP,
} = require('./_common');

const STRATEGY_ID = 'gap_and_go_long';

module.exports = {
  id: STRATEGY_ID,
  name: 'Gap and Go Long',
  category: 'intraday_momentum',
  timeframe: 'intraday',
  holdPeriod: 'same_day',
  dataRequired: 'intraday_1m',

  async scan(symbol, intradayBars, context) {
    const signals = [];
    const sessions = buildIntradayDailyMap(intradayBars);
    for (const [sessionDate, rawBars] of sessions.entries()) {
      if (!isDateInScanRange(sessionDate, context.scanRange)) continue;
      const regularBars = getRegularSessionBars(rawBars);
      if (regularBars.length < 20) continue;
      const premarketBars = getPremarketBars(rawBars);
      const previousClose = getPreviousClose(context.dailyBars, sessionDate);
      const open = toNumber(regularBars[0].open);
      const gap = gapPercent(open, previousClose);
      const avgDailyVolume = averageDailyVolumeBeforeDate(context.dailyBars, sessionDate, 20);
      if (gap === null || gap < 3 || open < 2 || open > 50 || (avgDailyVolume || 0) < 300000) continue;

      const premarketVolume = premarketBars.reduce((total, bar) => total + toNumber(bar.volume, 0), 0);
      const firstFiveVolume = regularBars.slice(0, 5).reduce((total, bar) => total + toNumber(bar.volume, 0), 0);
      const volumeRatio = avgDailyVolume > 0 ? (premarketVolume + firstFiveVolume) / (avgDailyVolume / 78) : 0;
      if (volumeRatio < 2) continue;

      const vwapSeries = VWAP(regularBars);
      let pullbackIndex = -1;
      for (let index = 5; index < Math.min(regularBars.length, 80); index += 1) {
        const bar = regularBars[index];
        const vwap = vwapSeries[index];
        if (!vwap) continue;
        if (toNumber(bar.low) <= vwap * 1.003 && toNumber(bar.high) >= vwap * 0.997) {
          pullbackIndex = index;
          break;
        }
      }
      if (pullbackIndex < 0) continue;

      let highOfDay = max(regularBars.slice(0, pullbackIndex + 1).map((bar) => bar.high));
      for (let index = pullbackIndex + 1; index < Math.min(regularBars.length, 120); index += 1) {
        const bar = regularBars[index];
        if (toNumber(bar.close) > highOfDay) {
          const entryPrice = toNumber(bar.close);
          const stopPrice = min([vwapSeries[index], regularBars[pullbackIndex].low]);
          const risk = entryPrice - stopPrice;
          if (risk <= 0) break;
          signals.push(createSignal(STRATEGY_ID, symbol, {
            signalDate: sessionDate,
            direction: 'long',
            entryPrice,
            stopPrice,
            targetPrice: entryPrice + (risk * 1.5),
            entryTimestamp: bar.timestamp,
            metadata: {
              gap_percent: gap,
              volume_ratio: volumeRatio,
              projectedEntryLevel: 'new high of day after VWAP pullback',
            },
          }));
          break;
        }
        highOfDay = Math.max(highOfDay, toNumber(bar.high, highOfDay));
      }
    }
    return signals;
  },

  async evaluate(signal, subsequentBars) {
    return evaluateWithOptions(signal, subsequentBars, { maxBars: 75 });
  },
};