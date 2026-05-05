const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { fmpFetch } = require('../../services/fmpClient');
const {
  addDays,
  computeImportance,
  flagSystemHealth,
  isDryRun,
  makeSourceId,
  normalizeDate,
  resolveSystemFlag,
  runCalendarJob,
  upsertEvents,
} = require('./_helpers');

const SOURCE_NAME = 'fmp_ipo';

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeIpoRow(row) {
  const eventDate = normalizeDate(row?.date || row?.filingDate || row?.acceptedDate);
  const symbol = String(row?.symbol || '').trim().toUpperCase() || null;
  if (!eventDate || !symbol) return null;
  const marketCap = toNumber(row?.marketCap);

  return {
    event_type: 'IPO',
    event_date: eventDate,
    symbol,
    title: `${symbol} IPO`,
    description: row?.company ? `${row.company} IPO on ${row.exchange || 'unknown exchange'}` : `${symbol} IPO`,
    source: 'FMP',
    source_id: makeSourceId(['ipo', symbol, eventDate]),
    source_url: '/stable/ipos-calendar',
    importance: computeImportance('IPO', { marketCap }),
    confidence: String(row?.actions || '').toLowerCase().includes('expected') ? 'estimated' : 'confirmed',
    metadata: {
      company: row?.company || null,
      exchange: row?.exchange || null,
      shares: toNumber(row?.shares),
      price_range: row?.priceRange || null,
      marketCap,
      status: row?.actions || null,
    },
    raw_payload: row,
  };
}

function normalizeDisclosureRow(row) {
  const eventDate = normalizeDate(row?.date || row?.filingDate || row?.acceptedDate);
  const symbol = String(row?.symbol || '').trim().toUpperCase() || null;
  if (!eventDate || !symbol) return null;
  return {
    event_type: 'IPO_DISCLOSURE',
    event_date: eventDate,
    symbol,
    title: `${symbol} IPO disclosure`,
    description: row?.company || null,
    source: 'FMP',
    source_id: makeSourceId(['ipo_disclosure', symbol, eventDate, row?.form || row?.cik]),
    source_url: '/stable/ipos-disclosure',
    importance: 6,
    confidence: 'confirmed',
    metadata: {
      company: row?.company || null,
      form: row?.form || null,
      cik: row?.cik || null,
    },
    raw_payload: row,
  };
}

function normalizeProspectusRow(row) {
  const eventDate = normalizeDate(row?.date || row?.filingDate || row?.acceptedDate);
  const symbol = String(row?.symbol || '').trim().toUpperCase() || null;
  if (!eventDate || !symbol) return null;
  return {
    event_type: 'IPO_PROSPECTUS',
    event_date: eventDate,
    symbol,
    title: `${symbol} IPO prospectus`,
    description: row?.company || null,
    source: 'FMP',
    source_id: makeSourceId(['ipo_prospectus', symbol, eventDate, row?.form || row?.cik]),
    source_url: '/stable/ipos-prospectus',
    importance: 6,
    confidence: 'confirmed',
    metadata: {
      company: row?.company || null,
      form: row?.form || null,
      cik: row?.cik || null,
    },
    raw_payload: row,
  };
}

function buildLockupEvent(ipoEvent) {
  return {
    event_type: 'LOCKUP_EXPIRY',
    event_date: addDays(ipoEvent.event_date, 180),
    symbol: ipoEvent.symbol,
    title: `${ipoEvent.symbol} estimated lockup expiry`,
    description: 'Derived as IPO date + 180 days',
    source: 'derived_from_ipo',
    source_id: makeSourceId(['lockup', ipoEvent.symbol, ipoEvent.event_date]),
    source_url: ipoEvent.source_url,
    importance: computeImportance('LOCKUP_EXPIRY', ipoEvent.metadata || {}),
    confidence: 'estimated',
    metadata: {
      base_ipo_date: ipoEvent.event_date,
      derivation_method: 'ipo_plus_180d',
      marketCap: ipoEvent.metadata?.marketCap || null,
    },
    raw_payload: ipoEvent.raw_payload,
  };
}

async function safeFmpFetch(sourceName, endpoint, params) {
  try {
    const payload = await fmpFetch(endpoint, params);
    await resolveSystemFlag(sourceName, 'endpoint_unreachable');
    await resolveSystemFlag(sourceName, 'rate_limited');
    return Array.isArray(payload) ? payload : [];
  } catch (error) {
    await flagSystemHealth(sourceName, Number(error?.status || 0) === 429 ? 'rate_limited' : 'endpoint_unreachable', 'warning', error.message, { endpoint, params });
    return [];
  }
}

async function runIngest(options = {}) {
  return runCalendarJob('fmp_ipo_ingest', async () => {
    const dryRun = isDryRun(options);
    const today = options.today || new Date().toISOString().slice(0, 10);
    const calendarFrom = options.calendarFrom || today;
    const calendarTo = options.calendarTo || addDays(today, 90);
    const docFrom = options.docFrom || addDays(today, -30);
    const docTo = options.docTo || addDays(today, 30);

    const [ipos, disclosures, prospectuses] = await Promise.all([
      safeFmpFetch(SOURCE_NAME, '/ipos-calendar', { from: calendarFrom, to: calendarTo }),
      safeFmpFetch(`${SOURCE_NAME}_disclosure`, '/ipos-disclosure', { from: docFrom, to: docTo }),
      safeFmpFetch(`${SOURCE_NAME}_prospectus`, '/ipos-prospectus', { from: docFrom, to: docTo }),
    ]);

    const ipoEvents = ipos.map(normalizeIpoRow).filter(Boolean);
    const lockupEvents = ipoEvents.map(buildLockupEvent).filter((item) => item.event_date);
    const disclosureEvents = disclosures.map(normalizeDisclosureRow).filter(Boolean);
    const prospectusEvents = prospectuses.map(normalizeProspectusRow).filter(Boolean);
    const allEvents = [...ipoEvents, ...lockupEvents, ...disclosureEvents, ...prospectusEvents];
    const persistence = await upsertEvents(allEvents, null, { dryRun });

    return {
      dryRun,
      fetched: ipos.length + disclosures.length + prospectuses.length,
      candidateEvents: allEvents.length,
      ipoCount: ipoEvents.length,
      lockupCount: lockupEvents.length,
      disclosureCount: disclosureEvents.length,
      prospectusCount: prospectusEvents.length,
      ...persistence,
    };
  }, options);
}

module.exports = {
  buildLockupEvent,
  normalizeDisclosureRow,
  normalizeIpoRow,
  normalizeProspectusRow,
  runIngest,
};