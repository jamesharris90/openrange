const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const {
  computeImportance,
  httpGetJson,
  httpGetText,
  isDryRun,
  makeSourceId,
  runCalendarJob,
  upsertEvents,
} = require('./_helpers');

const SOURCE_NAME = 'fed_fomc';
const JSON_URL = 'https://www.federalreserve.gov/json/calendar.json';
const HTML_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';

function buildEventDate(monthValue, daysValue) {
  const month = String(monthValue || '').trim();
  const dayText = String(daysValue || '').trim();
  const firstDay = dayText.split(/\D+/).find(Boolean);
  if (!month || !firstDay) return null;
  return `${month}-${String(firstDay).padStart(2, '0')}`;
}

function normalizeFedEvent(row) {
  const type = String(row?.type || '').trim().toUpperCase();
  const title = String(row?.title || '').trim();
  if (type !== 'FOMC' && !title.toUpperCase().includes('FOMC')) {
    return null;
  }

  const eventDate = buildEventDate(row?.month, row?.days);
  if (!eventDate) return null;

  return {
    event_type: 'FOMC',
    event_date: eventDate,
    event_time: row?.time ? String(row.time).trim() : null,
    title,
    description: row?.description ? String(row.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null,
    source: 'FederalReserve',
    source_id: makeSourceId(['fed', type, title, eventDate]),
    source_url: JSON_URL,
    importance: computeImportance('FOMC'),
    confidence: 'confirmed',
    metadata: {
      fed_type: type,
      month: row?.month || null,
      days: row?.days || null,
      live: row?.live || null,
      location: row?.location || null,
    },
    raw_payload: row,
  };
}

function parseFallbackHtml(html) {
  const matches = [...String(html || '').matchAll(/((January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:-| and )\d{0,2},\s+\d{4})/gi)];
  return matches.map((match, index) => ({
    event_type: 'FOMC',
    event_date: null,
    title: `FOMC Meeting ${index + 1}`,
    description: match[1],
    source: 'FederalReserve',
    source_id: makeSourceId(['fed-html', match[1]]),
    source_url: HTML_URL,
    importance: 10,
    confidence: 'confirmed',
    metadata: { fallback_html_match: match[1] },
    raw_payload: { text: match[1] },
  })).filter((item) => item.description);
}

async function runIngest(options = {}) {
  return runCalendarJob('fomc_ingest', async () => {
    const dryRun = isDryRun(options);
    try {
      const payload = await httpGetJson(JSON_URL, {
        sourceName: SOURCE_NAME,
        fingerprint: (data) => Array.isArray(data?.events),
        expectedNonEmpty: true,
      });
      const events = (payload.events || []).map(normalizeFedEvent).filter(Boolean);
      const persistence = await upsertEvents(events, null, { dryRun });
      return { dryRun, source: 'json', fetched: payload.events.length, candidateEvents: events.length, ...persistence };
    } catch (error) {
      const html = await httpGetText(HTML_URL, {
        sourceName: SOURCE_NAME,
        fingerprint: (text) => text.includes('Meeting calendars and information') || text.includes('FOMC'),
      });
      const events = parseFallbackHtml(html);
      const persistence = await upsertEvents(events, null, { dryRun });
      return { dryRun, source: 'html_fallback', fetched: events.length, candidateEvents: events.length, fallbackReason: error.message, ...persistence };
    }
  }, options);
}

module.exports = {
  JSON_URL,
  HTML_URL,
  normalizeFedEvent,
  parseFallbackHtml,
  runIngest,
};