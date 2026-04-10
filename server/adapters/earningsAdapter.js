function mapEarnings(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];

  return safeRows.map((r) => ({
    symbol: r?.symbol,
    timestamp: r?.report_date,
    eps_estimate: r?.eps_estimate ?? null,
    eps_actual: r?.eps_actual ?? null,
    revenue_estimate: r?.rev_estimate ?? null,
    revenue_actual: r?.rev_actual ?? null,
    surprise_eps: r?.eps_surprise_pct ?? null,
    surprise_revenue: r?.rev_surprise_pct ?? null,
  }));
}

module.exports = {
  mapEarnings,
};
