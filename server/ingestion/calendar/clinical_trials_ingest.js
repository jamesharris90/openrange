const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const {
  computeImportance,
  flagSystemHealth,
  httpGetJson,
  isDryRun,
  makeSourceId,
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

function normalizeClinicalTrialsDate(rawDate) {
  if (!rawDate || typeof rawDate !== 'string') return null;
  const trimmed = rawDate.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const yearMonthMatch = trimmed.match(/^(\d{4})-(\d{2})$/);
  if (yearMonthMatch) {
    const year = parseInt(yearMonthMatch[1], 10);
    const month = parseInt(yearMonthMatch[2], 10);
    if (month < 1 || month > 12) return null;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${yearMonthMatch[1]}-${yearMonthMatch[2]}-${String(lastDay).padStart(2, '0')}`;
  }

  const yearMatch = trimmed.match(/^(\d{4})$/);
  if (yearMatch) {
    return `${yearMatch[1]}-12-31`;
  }

  return null;
}

function getCompletionDateDetails(statusModule = {}) {
  const completionDateStruct = statusModule?.completionDateStruct || statusModule?.primaryCompletionDateStruct || {};
  const primaryCompletionDateStruct = statusModule?.primaryCompletionDateStruct || {};
  const rawDate = completionDateStruct?.date || primaryCompletionDateStruct?.date || null;
  const dateType = completionDateStruct?.type || primaryCompletionDateStruct?.type || null;
  const normalizedDate = normalizeClinicalTrialsDate(rawDate);
  const precision = typeof rawDate === 'string'
    ? (/^\d{4}-\d{2}-\d{2}$/.test(rawDate.trim()) ? 'day' : /^\d{4}-\d{2}$/.test(rawDate.trim()) ? 'month' : /^\d{4}$/.test(rawDate.trim()) ? 'year' : 'invalid')
    : 'missing';

  return {
    rawDate,
    dateType,
    normalizedDate,
    precision,
  };
}

function normalizeStudy(study) {
  const identification = study?.protocolSection?.identificationModule || {};
  const statusModule = study?.protocolSection?.statusModule || {};
  const sponsorName = getNested(study, ['protocolSection', 'sponsorCollaboratorsModule', 'leadSponsor', 'name']);
  const nctId = identification.nctId || null;
  const title = identification.briefTitle || identification.officialTitle || nctId;
  const completionDateDetails = getCompletionDateDetails(statusModule);
  if (!nctId || !title || !completionDateDetails.normalizedDate) return null;
  const confidence = completionDateDetails.dateType === 'ANTICIPATED' || completionDateDetails.precision !== 'day'
    ? 'estimated'
    : 'confirmed';

  return {
    event_type: 'CLINICAL_TRIAL_READOUT',
    event_date: completionDateDetails.normalizedDate,
    symbol: null,
    title,
    description: sponsorName ? `Lead sponsor: ${sponsorName}` : null,
    source: 'ClinicalTrials.gov',
    source_id: nctId,
    source_url: `https://clinicaltrials.gov/study/${nctId}`,
    importance: computeImportance('CLINICAL_TRIAL_READOUT'),
    confidence,
    metadata: {
      nct_id: nctId,
      sponsor_name: sponsorName,
      overall_status: statusModule.overallStatus || null,
      completion_date_raw: completionDateDetails.rawDate,
      completion_date_type: completionDateDetails.dateType,
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
      for (const study of studies) {
        const nctId = getNested(study, ['protocolSection', 'identificationModule', 'nctId'], 'unknown');
        const statusModule = study?.protocolSection?.statusModule || {};
        const completionDateDetails = getCompletionDateDetails(statusModule);

        if (!completionDateDetails.rawDate) {
          await flagSystemHealth(
            SOURCE_NAME,
            'parse_error',
            'info',
            `ClinicalTrials missing completion date for ${nctId}`,
            { nct_id: nctId }
          );
          continue;
        }

        if (!completionDateDetails.normalizedDate) {
          await flagSystemHealth(
            SOURCE_NAME,
            'parse_error',
            'warning',
            `ClinicalTrials malformed completion date for ${nctId}: ${completionDateDetails.rawDate}`,
            { nct_id: nctId, completion_date_raw: completionDateDetails.rawDate }
          );
          continue;
        }

        const normalizedStudy = normalizeStudy(study);
        if (normalizedStudy) {
          events.push(normalizedStudy);
        }
      }
      nextPageToken = payload.nextPageToken || null;
    } while (nextPageToken && fetched < maxStudies);

    const persistence = await upsertEvents(events.slice(0, maxStudies), null, { dryRun });
    return { dryRun, fetched, candidateEvents: events.length, ...persistence };
  }, options);
}

module.exports = {
  BASE_URL,
  MAX_STUDIES_PER_RUN,
  normalizeClinicalTrialsDate,
  normalizeStudy,
  runIngest,
};