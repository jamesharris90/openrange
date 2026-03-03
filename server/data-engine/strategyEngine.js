function mk(flag, confidence, ageBars) {
  return { flag: Boolean(flag), confidence, ageBars };
}

function buildStrategyFlags(universe, logger = console) {
  const out = new Map();

  universe.forEach((row) => {
    const atrp = Number(row.atrPercent || 0);
    const rvol = Number(row.relativeVolume || 0);
    const move = Number(row.intradayMoveFromOpenPercent || 0);

    out.set(row.symbol, {
      orbPresent: mk(atrp > 1.2 && rvol > 1.5, 55, 1),
      premarketHighBreak: mk(Boolean(row.gapPercent && row.gapPercent > 1), 52, 1),
      microPullbackContinuation: mk(move > 0.5 && atrp > 1, 50, 2),
      trendDayHHHL: mk(move > 1 && atrp > 1.3, 58, 2),
      vwapReclaim: mk(Boolean(row.aboveVwap), 57, 1),
      doubleBottomReversal: mk(false, 35, 0),
      redToGreen: mk(Boolean(row.gapPercent && row.gapPercent < 0 && move > 0), 54, 1),
      volExpansionBreakout: mk(Boolean(row.rangeExpansionScore && row.rangeExpansionScore > 1.5), 60, 1),
      emaCompressionSqueeze: mk(Boolean(row.emaCompressionScore && row.emaCompressionScore < 0.8), 56, 1),
      blowOffTop: mk(Boolean(move > 8 && atrp > 4), 62, 0),
      lowerHighBreakdown: mk(Boolean(move < -1 && row.aboveVwap === false), 59, 1),
      pdhPdlLiquiditySweep: mk(Boolean(row.intradayMoveFromHighPercent && row.intradayMoveFromHighPercent < -1), 53, 1),
    });
  });

  logger.info('Strategy engine complete', { symbols: out.size });
  return out;
}

module.exports = {
  buildStrategyFlags,
};
