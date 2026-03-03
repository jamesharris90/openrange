// @ts-nocheck

const ET_TIMEZONE = 'America/New_York';

function toEtDateParts(date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
  };
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function etDateString(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function formatDateTimeEt(dateString, hour, minute, second = 0) {
  return `${dateString} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

function getSessionWindow(daysBack = 3) {
  const sessions = [];
  const now = new Date();

  for (let i = 0; i < daysBack; i += 1) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() - i);

    const { year, month, day } = toEtDateParts(d);
    const date = etDateString(year, month, day);

    sessions.push({
      date,
      from: formatDateTimeEt(date, 4, 0, 0),
      to: formatDateTimeEt(date, 20, 0, 0),
    });
  }

  return sessions;
}

module.exports = {
  getSessionWindow,
};
