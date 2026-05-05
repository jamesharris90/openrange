const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const {
  addDays,
  computeImportance,
  httpGetJson,
  isDryRun,
  makeSourceId,
  parseFredDate,
  parseFredReleaseTime,
  runCalendarJob,
  upsertEvents,
} = require('./_helpers');

const SOURCE_NAME = 'fred_economic';
const BASE_URL = 'https://api.stlouisfed.org/fred/release/dates';
const FRED_API_KEY = process.env.FRED_API_KEY;
const RELEASES = Object.freeze({
  10: { name: 'Consumer Price Index', importance: 9, type: 'CPI' },
  46: { name: 'Employment Situation', importance: 10, type: 'NFP' },
  11: { name: 'Producer Price Index', importance: 7, type: 'PPI' },
  21: { name: 'GDP', importance: 8, type: 'GDP' },
  175: { name: 'Retail Sales', importance: 7, type: 'RETAIL_SALES' },
  54: { name: 'Unemployment Insurance Weekly Claims', importance: 6, type: 'JOBLESS_CLAIMS' },
  151: { name: 'New Residential Construction', importance: 5, type: 'HOUSING' },
  18: { name: 'Industrial Production', importance: 6, type: 'INDPRO' },
  91: { name: 'Personal Income and Outlays (PCE)', importance: 8, type: 'PCE' },
  82: { name: 'ISM Manufacturing PMI', importance: 7, type: 'ISM_PMI' },
});

function normalizeReleaseEvent(releaseId, release, dateValue) {
  const eventDate = parseFredDate(dateValue);
  if (!eventDate) return null;
  return {
    event_type: 'ECONOMIC_RELEASE',
    event_date: eventDate,
    event_time: parseFredReleaseTime(release.type),
    title: release.name,
    description: `${release.name} scheduled release`,
    source: 'FRED',
    source_id: makeSourceId([releaseId, eventDate]),
    source_url: BASE_URL,
    importance: release.importance || computeImportance('ECONOMIC_RELEASE', { release_type: release.type }),
    confidence: 'confirmed',
    metadata: {
      release_id: releaseId,
      release_name: release.name,
      release_type: release.type,
    },
    raw_payload: { release_id: releaseId, date: eventDate, release },
  };
}

async function fetchReleaseDates(releaseId, options = {}) {
  if (!FRED_API_KEY) {
    throw new Error('FRED_API_KEY is not configured');
  }

  const maxAttempts = Number(options.maxAttempts ?? 3);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await httpGetJson(BASE_URL, {
        sourceName: SOURCE_NAME,
        params: {
          release_id: releaseId,
          include_release_dates_with_no_data: 'false',
          api_key: FRED_API_KEY,
          file_type: 'json',
          realtime_start: options.fromDate,
          realtime_end: options.toDate,
        },
        fingerprint: (data) => Array.isArray(data?.release_dates),
        expectedNonEmpty: true,
      });
    } catch (error) {
      if (!String(error?.message || '').includes('status 500') || attempt === maxAttempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }

  return { release_dates: [] };
}

async function runIngest(options = {}) {
  return runCalendarJob('fred_economic_ingest', async () => {
    const dryRun = isDryRun(options);
    const today = options.today || new Date().toISOString().slice(0, 10);
    const fromDate = options.fromDate || today;
    const toDate = options.toDate || addDays(today, 90);
    const events = [];
    let fetched = 0;
    const failedReleaseIds = [];

    for (const [releaseId, release] of Object.entries(RELEASES)) {
      let payload;
      try {
        payload = await fetchReleaseDates(releaseId, { fromDate, toDate });
      } catch (error) {
        failedReleaseIds.push(releaseId);
        continue;
      }
      const rows = (payload.release_dates || [])
        .map((item) => normalizeReleaseEvent(releaseId, release, item.date))
        .filter((item) => item && item.event_date >= fromDate && item.event_date <= toDate);
      fetched += payload.release_dates?.length || 0;
      events.push(...rows);
    }

    const persistence = await upsertEvents(events, null, { dryRun });
    return { dryRun, fetched, candidateEvents: events.length, failedReleaseIds, ...persistence };
  }, options);
}

module.exports = {
  BASE_URL,
  RELEASES,
  fetchReleaseDates,
  normalizeReleaseEvent,
  runIngest,
};