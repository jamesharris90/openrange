function detectCatalyst({
  news,
  earnings,
  priceChangePercent,
  rvol,
}) {
  if (news && news.length > 0) {
    return {
      type: 'NEWS',
      strength: 3,
    };
  }

  if (earnings && earnings.isToday) {
    return {
      type: 'EARNINGS',
      strength: 3,
    };
  }

  if (priceChangePercent >= 5 && rvol >= 2) {
    return {
      type: 'TECHNICAL_BREAKOUT',
      strength: 2,
    };
  }

  if (rvol >= 3) {
    return {
      type: 'VOLUME_SPIKE',
      strength: 1,
    };
  }

  return null;
}

module.exports = {
  detectCatalyst,
};