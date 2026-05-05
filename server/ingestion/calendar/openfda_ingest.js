const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const {
  addDays,
  computeImportance,
  httpGetJson,
  isDryRun,
  makeSourceId,
  normalizeDate,
  runCalendarJob,
  upsertEvents,
} = require('./_helpers');

const SOURCE_NAME = 'openfda';
const EVENT_URL = 'https://api.fda.gov/drug/event.json';
const ENFORCEMENT_URL = 'https://api.fda.gov/drug/enforcement.json';

function toOpenFdaDate(dateString) {
  return normalizeDate(dateString)?.replace(/-/g, '') || null;
}

function firstMedicinalProduct(result) {
  const drugs = result?.patient?.drug;
  if (!Array.isArray(drugs) || drugs.length === 0) return null;
  return String(drugs[0]?.medicinalproduct || drugs[0]?.openfda?.brand_name?.[0] || '').trim() || null;
}

function normalizeRecall(result) {
  const reportDate = normalizeDate(result?.report_date || result?.recall_initiation_date);
  if (!reportDate) return null;
  const classification = String(result?.classification || '').trim().toUpperCase();
  const title = [result?.product_description, result?.reason_for_recall].filter(Boolean).join(' - ') || 'Drug recall';
  return {
    event_type: 'DRUG_RECALL',
    event_date: reportDate,
    title,
    description: result?.reason_for_recall || null,
    source: 'openFDA',
    source_id: makeSourceId(['recall', result?.recall_number || result?.event_id || reportDate]),
    source_url: ENFORCEMENT_URL,
    importance: computeImportance('DRUG_RECALL', { classification }),
    confidence: 'confirmed',
    metadata: {
      classification,
      recalling_firm: result?.recalling_firm || null,
      product_type: result?.product_type || null,
      brand_name: result?.openfda?.brand_name || [],
    },
    raw_payload: result,
  };
}

function buildSpikeEvents(results = [], threshold = 50) {
  const grouped = new Map();
  results.forEach((row) => {
    const brand = firstMedicinalProduct(row);
    if (!brand) return;
    const current = grouped.get(brand) || { count: 0, latestDate: null };
    current.count += 1;
    const receivedDate = normalizeDate(row?.receiptdate || row?.receivedate);
    if (receivedDate && (!current.latestDate || receivedDate > current.latestDate)) {
      current.latestDate = receivedDate;
    }
    grouped.set(brand, current);
  });

  return Array.from(grouped.entries())
    .filter(([, value]) => value.count > threshold)
    .map(([brand, value]) => ({
      event_type: 'ADVERSE_EVENT_SPIKE',
      event_date: value.latestDate || new Date().toISOString().slice(0, 10),
      title: `${brand} adverse event spike`,
      description: `${value.count} reports in sampled 30-day window`,
      source: 'openFDA',
      source_id: makeSourceId(['ae_spike', brand, value.latestDate]),
      source_url: EVENT_URL,
      importance: computeImportance('ADVERSE_EVENT_SPIKE'),
      confidence: 'estimated',
      metadata: { brand_name: brand, report_count: value.count, threshold },
      raw_payload: { brand_name: brand, report_count: value.count },
    }));
}

async function safeOpenFdaFetch(url, requestOptions) {
  try {
    return await httpGetJson(url, requestOptions);
  } catch (error) {
    if (String(error?.message || '').includes('status 404')) {
      return { results: [] };
    }
    throw error;
  }
}

async function runIngest(options = {}) {
  return runCalendarJob('openfda_ingest', async () => {
    const dryRun = isDryRun(options);
    const today = options.today || new Date().toISOString().slice(0, 10);
    const startDate = toOpenFdaDate(addDays(today, -30));
    const endDate = toOpenFdaDate(today);
    const eventSearch = options.eventSearch || `receivedate:[${startDate} TO ${endDate}]`;
    const enforcementSearch = options.enforcementSearch || `report_date:[${startDate} TO ${endDate}]`;

    const [eventsPayload, enforcementPayload] = await Promise.all([
      safeOpenFdaFetch(EVENT_URL, {
        sourceName: SOURCE_NAME,
        params: { limit: 100, search: eventSearch },
        fingerprint: (data) => Array.isArray(data?.results),
      }),
      safeOpenFdaFetch(ENFORCEMENT_URL, {
        sourceName: `${SOURCE_NAME}_enforcement`,
        params: { limit: 100, search: enforcementSearch },
        fingerprint: (data) => Array.isArray(data?.results),
      }),
    ]);

    const recallEvents = (enforcementPayload.results || []).map(normalizeRecall).filter(Boolean);
    const spikeEvents = buildSpikeEvents(eventsPayload.results || [], Number(options.spikeThreshold ?? 50));
    const allEvents = [...recallEvents, ...spikeEvents];
    const persistence = await upsertEvents(allEvents, null, { dryRun });
    return {
      dryRun,
      fetched: (eventsPayload.results || []).length + (enforcementPayload.results || []).length,
      candidateEvents: allEvents.length,
      recallCount: recallEvents.length,
      spikeCount: spikeEvents.length,
      ...persistence,
    };
  }, options);
}

module.exports = {
  buildSpikeEvents,
  normalizeRecall,
  runIngest,
  safeOpenFdaFetch,
};