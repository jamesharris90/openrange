function mapOHLC(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];

  return safeRows.map((r) => ({
    symbol: r?.symbol,
    timestamp: r?.timestamp,
    open: r?.open,
    high: r?.high,
    low: r?.low,
    close: r?.close,
    volume: Number(r?.volume) || 0,
  }));
}

module.exports = {
  mapOHLC,
};
