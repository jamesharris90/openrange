const {
  averageDailyVolumeBeforeDate,
  buildIntradayDailyMap,
  createSignal,
  evaluateWithOptions,
  findNewsWithinHours,
  getPreviousClose,
  getRegularSessionBars,
  isDateInScanRange,
  min,
  toNumber,
} = require('./_common');

const STRATEGY_ID = 'red_to_green_long';

module.exports = {
  id: STRATEGY_ID,
  name: 'Red to Green Long',
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
      if (bars.length < 30) continue;
      const avgDailyVolume = averageDailyVolumeBeforeDate(context.dailyBars, sessionDate, 20);
      const previousClose = getPreviousClose(context.dailyBars, sessionDate);
      const open = toNumber(bars[0].open);
      if ((avgDailyVolume || 0) < 300000 || previousClose === null || open >= previousClose) continue;
      if (!findNewsWithinHours(context.news, `${sessionDate}T23:59:59Z`, 48).length) continue;

      const openingLow = min(bars.slice(0, 30).map((bar) => bar.low));
      for (let index = 5; index < 30; index += 1) {
        const bar = bars[index];
        const priorVolumes = bars.slice(Math.max(0, index - 5), index).map((candidate) => candidate.volume);
        const avgVolume = priorVolumes.length ? priorVolumes.reduce((sumValue, value) => sumValue + toNumber(value, 0), 0) / priorVolumes.length : 0;
        if (toNumber(bar.close) > previousClose && toNumber(bar.volume, 0) >= avgVolume * 2) {
          const entryPrice = toNumber(bar.close);
          const stopPrice = openingLow;
          const risk = entryPrice - stopPrice;
          if (risk <= 0) continue;
          signals.push(createSignal(STRATEGY_ID, symbol, {
            signalDate: sessionDate,
            direction: 'long',
            entryPrice,
            stopPrice,
            targetPrice: entryPrice + (risk * 1.5),
            entryTimestamp: bar.timestamp,
            metadata: {
              previous_close: previousClose,
              projectedEntryLevel: 'close back above prior close on volume',
            },
          }));
          break;
        }
      }
    }
    return signals;
  },

  async evaluate(signal, subsequentBars) {
    return evaluateWithOptions(signal, subsequentBars, { maxBars: 75 });
  },
};