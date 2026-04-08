const {
  averageDailyVolumeBeforeDate,
  buildIntradayDailyMap,
  createSignal,
  evaluateWithOptions,
  getPreviousClose,
  getRegularSessionBars,
  isDateInScanRange,
  max,
  min,
  toNumber,
  VWAP,
} = require('./_common');

const STRATEGY_ID = 'vwap_reclaim_long';

module.exports = {
  id: STRATEGY_ID,
  name: 'VWAP Reclaim Long',
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
      if (bars.length < 20) continue;
      const avgDailyVolume = averageDailyVolumeBeforeDate(context.dailyBars, sessionDate, 20);
      const previousClose = getPreviousClose(context.dailyBars, sessionDate);
      const open = toNumber(bars[0].open);
      if (open < 2 || open > 50 || (avgDailyVolume || 0) < 300000 || previousClose === null || open <= previousClose) continue;

      const vwapSeries = VWAP(bars);
      const firstFifteen = bars.slice(0, 15);
      if (!firstFifteen.some((bar, index) => toNumber(bar.close) < toNumber(vwapSeries[index], Infinity))) continue;

      for (let index = 15; index < Math.min(bars.length, 120); index += 1) {
        const bar = bars[index];
        const vwap = toNumber(vwapSeries[index]);
        if (vwap === null) continue;
        const priorVolumes = bars.slice(Math.max(0, index - 10), index).map((candidate) => candidate.volume);
        const avgVolume = priorVolumes.length ? priorVolumes.reduce((sumValue, value) => sumValue + toNumber(value, 0), 0) / priorVolumes.length : 0;
        if (toNumber(bar.close) > vwap && toNumber(bar.volume, 0) >= avgVolume * 1.5) {
          const entryPrice = toNumber(bar.close);
          const stopPrice = max([toNumber(bar.low), vwap * 0.997]);
          const risk = entryPrice - stopPrice;
          if (risk <= 0) continue;
          const priorHigh = max(bars.slice(0, index + 1).map((candidate) => candidate.high));
          signals.push(createSignal(STRATEGY_ID, symbol, {
            signalDate: sessionDate,
            direction: 'long',
            entryPrice,
            stopPrice,
            targetPrice: Math.max(priorHigh || 0, entryPrice + (risk * 2)),
            entryTimestamp: bar.timestamp,
            metadata: {
              vwap_reclaim_bar: index,
              projectedEntryLevel: 'close back above VWAP with volume spike',
            },
          }));
          break;
        }
      }
    }
    return signals;
  },

  async evaluate(signal, subsequentBars) {
    return evaluateWithOptions(signal, subsequentBars, { maxBars: 60 });
  },
};