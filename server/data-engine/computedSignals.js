function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function buildComputedSignals(universe, logger = console) {
  const out = new Map();

  universe.forEach((row) => {
    const marketCap = Number(row.marketCap || 0);
    const volume = Number(row.volume || 0);
    const dollarVol = Number(row.dollarVolume || volume * Number(row.price || 0));
    const catalyst = Boolean(row.hasRecentCatalyst || row.hasRecentNews);
    const rvol = Number(row.relativeVolume || 0);

    const momentum = clamp((Number(row.return1D || 0) * 5) + (rvol * 10), 0, 100);
    const structure = clamp((Number(row.rangeExpansionScore || 0) * 15) + (row.aboveVwap ? 20 : 0), 0, 100);
    const liquidity = clamp((Math.log10(Math.max(dollarVol, 1)) - 3) * 20, 0, 100);
    const risk = clamp((100 - liquidity) + Math.max(0, 20 - marketCap / 1e9), 0, 100);

    // floatShares: prefer Yahoo Finance Layer B2 value, fall back to base row.float
    const floatShares = Number(row.floatShares || row.float || 0);

    out.set(row.symbol, {
      lowFloatFlag: floatShares > 0 && floatShares < 20_000_000,
      microcapFlag: marketCap > 0 && marketCap < 300_000_000,
      highRvolFlag: rvol >= 2,
      inPlayFlag: catalyst && volume > 500_000,
      momentumScore: momentum,
      structureScore: structure,
      liquidityScore: liquidity,
      riskScore: risk,
    });
  });

  logger.info('Computed signals complete', { symbols: out.size });
  return out;
}

module.exports = {
  buildComputedSignals,
};
