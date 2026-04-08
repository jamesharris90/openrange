function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function enrichOpportunity(row, context) {
  const safeRow = row && typeof row === 'object' ? row : {};
  const safeContext = context && typeof context === 'object' ? context : {};

  const symbol = normalizeSymbol(safeRow.symbol);
  const market = (safeContext.marketMap && safeContext.marketMap[symbol]) || {};
  const metrics = (safeContext.metricsMap && safeContext.metricsMap[symbol]) || {};
  const news = (safeContext.newsMap && safeContext.newsMap[symbol]) || [];
  const earnings = safeContext.earningsMap ? safeContext.earningsMap[symbol] : null;

  const price = Number(safeRow.price ?? market.price) || 0;
  const change_percent = Number(safeRow.change_percent ?? market.change_percent) || 0;

  let relative_volume = 0;
  const metricsVolume = Number(metrics.volume);
  const metricsAvgVolume = Number(metrics.avg_volume_30d);

  if (Number.isFinite(metricsVolume) && Number.isFinite(metricsAvgVolume) && metricsAvgVolume > 0) {
    relative_volume = metricsVolume / metricsAvgVolume;
  } else {
    const marketVolume = Number(market.volume);
    const marketAvgVolume = Number(market.avg_volume_30d);
    if (Number.isFinite(marketVolume) && Number.isFinite(marketAvgVolume) && marketAvgVolume > 0) {
      relative_volume = marketVolume / marketAvgVolume;
    } else {
      const existingRvol = Number(safeRow.relative_volume ?? safeRow.rvol ?? market.relative_volume ?? metrics.relative_volume);
      relative_volume = Number.isFinite(existingRvol) ? existingRvol : 0;
    }
  }

  const float_shares = safeRow.float_shares ?? metrics.float_shares ?? null;
  const short_float = safeRow.short_float ?? metrics.short_float ?? null;
  const atr_percent = safeRow.atr_percent ?? metrics.atr_percent ?? null;
  const vwap = safeRow.vwap ?? metrics.vwap ?? market.vwap ?? null;
  const gap_percent = Number(safeRow.gap_percent ?? metrics.gap_percent) || 0;

  let catalyst_type = 'technical';
  let catalyst_strength = 10;

  if (earnings) {
    catalyst_type = 'earnings';
    catalyst_strength += 30;
  }

  if (news.length > 0) {
    catalyst_type = 'news';
    catalyst_strength += 20;
  }

  if (gap_percent > 5) {
    catalyst_strength += 20;
  }

  return {
    ...safeRow,
    symbol,
    price,
    change_percent,
    relative_volume,
    float_shares,
    short_float,
    atr_percent,
    vwap,
    gap_percent,
    catalyst_type,
    catalyst_strength,
    earnings_flag: !!earnings,
    news_count: news.length,
  };
}

module.exports = {
  enrichOpportunity,
};
