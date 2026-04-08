function evaluateWatchlistCandidate({
  news,
  earnings,
  dailyChangePercent,
  atr,
  price,
}) {
  const move = Number.isFinite(Number(dailyChangePercent))
    ? Math.abs(Number(dailyChangePercent))
    : 0;

  if (earnings && earnings.isUpcoming) {
    return {
      watch_reason: 'EARNINGS_UPCOMING',
      priority: 3,
    };
  }

  if (news && news.length > 0) {
    return {
      watch_reason: 'NEWS_PENDING',
      priority: 3,
    };
  }

  if (move >= 4) {
    return {
      watch_reason: 'LARGE_MOVE',
      priority: 3,
    };
  }

  if (atr && price && (atr / price) > 0.05) {
    return {
      watch_reason: 'HIGH_VOLATILITY',
      priority: 1,
    };
  }

  return null;
}

module.exports = {
  evaluateWatchlistCandidate,
};