function getMarketSession(now = new Date()) {
  const utc = new Date(now);
  const hours = utc.getUTCHours();
  const minutes = utc.getUTCMinutes();

  const total = hours * 60 + minutes;

  const premarketStart = 9 * 60;
  const marketOpen = 13 * 60 + 30;
  const marketClose = 20 * 60;
  const afterHoursEnd = 24 * 60;

  if (total >= premarketStart && total < marketOpen) return 'PREMARKET';
  if (total >= marketOpen && total < marketClose) return 'OPEN';
  if (total >= marketClose && total < afterHoursEnd) return 'POSTMARKET';

  return 'CLOSED';
}

module.exports = { getMarketSession };