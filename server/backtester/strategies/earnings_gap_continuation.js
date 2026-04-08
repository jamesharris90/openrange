const {
  averageDailyVolumeBeforeDate,
  computeEarningsBeat,
  createSignal,
  evaluateWithOptions,
  gapPercent,
  getDailyBarOnDate,
  getNextDailyOpen,
  isDateInScanRange,
  sortBars,
  toDateKey,
  toNumber,
} = require('./_common');

const STRATEGY_ID = 'earnings_gap_continuation';

module.exports = {
  id: STRATEGY_ID,
  name: 'Earnings Gap Continuation',
  category: 'daily_catalyst',
  timeframe: 'daily',
  holdPeriod: 'multi_day',
  dataRequired: 'daily_ohlcv',

  async scan(symbol, dailyBars, context) {
    const bars = sortBars(dailyBars, 'date');
    const signals = [];
    for (let index = 1; index < bars.length - 1; index += 1) {
      const bar = bars[index];
      const dateKey = toDateKey(bar.date);
      if (!isDateInScanRange(dateKey, context.scanRange)) continue;
      const event = (context.earnings || []).find((candidate) => toDateKey(candidate.report_date) === dateKey);
      if (!event) continue;
      const previousClose = toNumber(bars[index - 1].close);
      const currentOpen = toNumber(bar.open);
      const nextOpen = getNextDailyOpen(bars, dateKey);
      const marketCap = toNumber(context.fundamentals.marketCap);
      const avgVolume = averageDailyVolumeBeforeDate(bars, dateKey, 20);
      const gap = gapPercent(currentOpen, previousClose);
      if (nextOpen === null || marketCap === null || marketCap < 500000000 || (avgVolume || 0) < 500000 || gap === null || Math.abs(gap) < 4) continue;

      const bullishClose = toNumber(bar.close) > currentOpen;
      const bearishClose = toNumber(bar.close) < currentOpen;
      const direction = gap > 0 ? 'long' : 'short';
      if ((direction === 'long' && !bullishClose) || (direction === 'short' && !bearishClose)) continue;

      const entryPrice = nextOpen;
      const stopPrice = direction === 'long' ? toNumber(bar.low) : toNumber(bar.high);
      const risk = direction === 'long' ? entryPrice - stopPrice : stopPrice - entryPrice;
      if (risk <= 0) continue;
      signals.push(createSignal(STRATEGY_ID, symbol, {
        signalDate: dateKey,
        entryDate: toDateKey(bars[index + 1].date),
        direction,
        entryPrice,
        stopPrice,
        targetPrice: direction === 'long' ? entryPrice + (risk * 1.5) : entryPrice - (risk * 1.5),
        metadata: {
          gap_percent: gap,
          earnings_beat: computeEarningsBeat(event),
          projectedEntryLevel: 'next-day open after earnings gap follow-through',
        },
      }));
    }
    return signals;
  },

  async evaluate(signal, subsequentBars) {
    return evaluateWithOptions(signal, subsequentBars, { maxBars: 5 });
  },
};