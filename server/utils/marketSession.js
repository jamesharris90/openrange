function getEasternTimeParts(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );

  return {
    weekday: parts.weekday || 'Mon',
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
  };
}

function getMarketSession(now = new Date()) {
  const { weekday, hour, minute } = getEasternTimeParts(now);
  if (weekday === 'Sat' || weekday === 'Sun') {
    return 'CLOSED';
  }

  const totalMinutes = (hour * 60) + minute;
  const premarketStart = 4 * 60;
  const marketOpen = (9 * 60) + 30;
  const marketClose = 16 * 60;
  const afterHoursEnd = 20 * 60;

  if (totalMinutes >= premarketStart && totalMinutes < marketOpen) {
    return 'PREMARKET';
  }
  if (totalMinutes >= marketOpen && totalMinutes < marketClose) {
    return 'OPEN';
  }
  if (totalMinutes >= marketClose && totalMinutes < afterHoursEnd) {
    return 'POSTMARKET';
  }

  return 'CLOSED';
}

module.exports = {
  getEasternTimeParts,
  getMarketSession,
};