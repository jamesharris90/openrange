const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const {
  computeImportance,
  httpGetText,
  isDryRun,
  makeSourceId,
  runCalendarJob,
  upsertEvents,
} = require('./_helpers');

const SOURCE_NAME = 'fvap_elections';
const URL = 'https://www.fvap.gov/guide/upcoming-elections';

const MONTHS = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

function toDateString(monthName, day, year) {
  const month = MONTHS[String(monthName || '').trim().toLowerCase()];
  if (!month) return null;
  return `${year}-${month}-${String(day).padStart(2, '0')}`;
}

function extractElectionEvents(html) {
  const text = String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const regex = /((Presidential|General|Primary|Senate|Governor|Federal)[^\.]{0,120}?)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/gi;
  const events = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const title = match[1].trim();
    const eventDate = toDateString(match[3], match[4], match[5]);
    if (!eventDate) continue;
    const normalizedTitle = title.toLowerCase();
    if (!/(presidential|general|primary|senate|governor|federal)/.test(normalizedTitle)) continue;
    events.push({
      event_type: 'ELECTION',
      event_date: eventDate,
      title,
      description: 'Upcoming election from FVAP guide',
      source: 'FVAP',
      source_id: makeSourceId(['fvap', title, eventDate]),
      source_url: URL,
      importance: normalizedTitle.includes('presidential') ? 9 : normalizedTitle.includes('general') ? 8 : computeImportance('ELECTION'),
      confidence: 'confirmed',
      metadata: {
        category: normalizedTitle.includes('presidential') ? 'presidential' : normalizedTitle.includes('primary') ? 'primary' : 'general',
      },
      raw_payload: { title, eventDate },
    });
  }
  return events;
}

async function runIngest(options = {}) {
  return runCalendarJob('fvap_elections_ingest', async () => {
    const dryRun = isDryRun(options);
    const html = await httpGetText(URL, {
      sourceName: SOURCE_NAME,
      fingerprint: (text) => text.includes('upcoming elections') || text.includes('Upcoming Elections'),
    });
    const events = extractElectionEvents(html);
    const persistence = await upsertEvents(events, null, { dryRun });
    return { dryRun, fetched: 1, candidateEvents: events.length, ...persistence };
  }, options);
}

module.exports = {
  extractElectionEvents,
  runIngest,
};