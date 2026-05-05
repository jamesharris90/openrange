const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const {
  computeImportance,
  httpGetJson,
  isDryRun,
  makeSourceId,
  normalizeDate,
  runCalendarJob,
  upsertEvents,
} = require('./_helpers');

const SOURCE_NAME = 'clinicaltrials_gov';
const BASE_URL = 'https://clinicaltrials.gov/api/v2/studies';
const MAX_STUDIES_PER_RUN = 1000;

function getNested(obj, pathSegments, fallback = null) {
  let current = obj;
  for (const segment of pathSegments) {
    if (!current || typeof current !== 'object') return fallback;
    current = current[segment];
  }
  return current == null ? fallback : current;
}

function normalizeStudy(study) {
  const identification = study?.protocolSection?.identificationModule || {};
  const statusModule = study?.protocolSection?.statusModule || {};
  const sponsorName = getNested(study, ['protocolSection', 'sponsorCollaboratorsModule', 'leadSponsor', 'name']);
  const nctId = identification.nctId || null;
  const title = identification.briefTitle || identification.officialTitle || nctId;
  const completionDate = normalizeDate(statusModule?.completionDateStruct?.date || statusModule?.primaryCompletionDateStruct?.date);
  if (!nctId || !title || !completionDate) return null;

  return {
    event_type: 'CLINICAL_TRIAL_READOUT',
    event_date: completionDate,
    symbol: null,
    title,
    description: sponsorName ? `Lead sponsor: ${sponsorName}` : null,
    source: 'ClinicalTrials.gov',
    source_id: nctId,
    source_url: `https://clinicaltrials.gov/study/${nctId}`,
    importance: computeImportance('CLINICAL_TRIAL_READOUT'),
    confidence: 'estimated',
    metadata: {
      nct_id: nctId,
      sponsor_name: sponsorName,
      overall_status: statusModule.overallStatus || null,
      completion_date_type: statusModule.completionDateStruct?.type || statusModule.primaryCompletionDateStruct?.type || null,
      phase: getNested(study, ['protocolSection', 'designModule', 'phases'], []),
    },
    raw_payload: study,
  };
}

async function fetchPage(pageToken) {
  const params = {
    'query.term': 'AREA[Phase]PHASE3 AND (AREA[OverallStatus]RECRUITING OR AREA[OverallStatus]ACTIVE_NOT_RECRUITING)',
    pageSize: 100,
  };
  if (pageToken) params.pageToken = pageToken;
  return httpGetJson(BASE_URL, {
    sourceName: SOURCE_NAME,
    params,
    fingerprint: (data) => Array.isArray(data?.studies),
  });
}

async function runIngest(options = {}) {
  return runCalendarJob('clinical_trials_ingest', async () => {
    const dryRun = isDryRun(options);
    const maxStudies = Math.min(Number(options.maxStudies || MAX_STUDIES_PER_RUN), MAX_STUDIES_PER_RUN);
    const events = [];
    let fetched = 0;
    let nextPageToken = null;

    do {
      const payload = await fetchPage(nextPageToken);
      const studies = Array.isArray(payload.studies) ? payload.studies : [];
      fetched += studies.length;
      events.push(...studies.map(normalizeStudy).filter(Boolean));
      nextPageToken = payload.nextPageToken || null;
    } while (nextPageToken && fetched < maxStudies);

    const persistence = await upsertEvents(events.slice(0, maxStudies), null, { dryRun });
    return { dryRun, fetched, candidateEvents: events.length, ...persistence };
  }, options);
}

module.exports = {
  BASE_URL,
  MAX_STUDIES_PER_RUN,
  normalizeStudy,
  runIngest,
};