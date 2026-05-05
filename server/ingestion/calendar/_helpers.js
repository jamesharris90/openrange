const axios = require('axios');
const { queryWithTimeout } = require('../../db/pg');
const logger = require('../../utils/logger');

const httpClient = axios.create({
  timeout: 20000,
  validateStatus: () => true,
  headers: {
    'User-Agent': 'OpenRangeCalendar/1.0 (+read-only scheduler client)',
  },
});

const IMPORTANCE_DEFAULTS = Object.freeze({
  FOMC: 10,
  ECONOMIC_RELEASE: 7,
  EARNINGS: 8,
  IPO: 7,
  IPO_DISCLOSURE: 6,
  IPO_PROSPECTUS: 6,
  LOCKUP_EXPIRY: 5,
  STOCK_SPLIT: 6,
  PDUFA: 9,
  CLINICAL_TRIAL_READOUT: 6,
  INDEX_REBALANCE: 7,
  CONFERENCE: 5,
  ELECTION: 6,
  ADVERSE_EVENT_SPIKE: 5,
  DRUG_RECALL: 8,
  PATENT_EXPIRY: 4,
  OTHER: 5,
});

function isDryRun(options = {}) {
  if (options.dryRun === true || options.DRY_RUN === true) return true;
  const raw = String(process.env.DRY_RUN || '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

function parseFredDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  return raw ? raw.slice(0, 10) : null;
}

function parseFredReleaseTime(releaseType) {
  const normalized = String(releaseType || '').trim().toUpperCase();
  if (!normalized) return null;
  if (['CPI', 'NFP', 'PPI', 'GDP', 'RETAIL_SALES', 'JOBLESS_CLAIMS', 'HOUSING', 'PCE', 'INDPRO'].includes(normalized)) {
    return '08:30 ET';
  }
  if (normalized === 'ISM_PMI') {
    return '10:00 ET';
  }
  return null;
}

function normalizeDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  return raw.slice(0, 10);
}

function addDays(dateString, days) {
  const base = new Date(`${normalizeDate(dateString)}T00:00:00Z`);
  if (!Number.isFinite(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return base.toISOString().slice(0, 10);
}

function makeSourceId(parts = []) {
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join('::') || null;
}

function computeImportance(eventType, metadata = {}) {
  const base = IMPORTANCE_DEFAULTS[eventType] || IMPORTANCE_DEFAULTS.OTHER;

  if (eventType === 'IPO') {
    const marketCap = Number(metadata.marketCap || 0);
    if (marketCap >= 1000000000) return 9;
    if (marketCap >= 250000000) return 8;
    return base;
  }

  if (eventType === 'LOCKUP_EXPIRY') {
    return metadata.marketCap && Number(metadata.marketCap) >= 1000000000 ? 7 : base;
  }

  if (eventType === 'STOCK_SPLIT') {
    const numerator = Number(metadata.numerator || 0);
    const denominator = Number(metadata.denominator || 0);
    if (numerator > 0 && denominator > 0 && numerator < denominator) return 8;
    return base;
  }

  if (eventType === 'DRUG_RECALL') {
    const classification = String(metadata.classification || '').trim().toUpperCase();
    if (classification === 'CLASS I') return 10;
    if (classification === 'CLASS II') return 8;
    if (classification === 'CLASS III') return 6;
  }

  return base;
}

async function executeWrite(sql, params, client, label) {
  if (client && typeof client.query === 'function') {
    return client.query(sql, params);
  }

  return queryWithTimeout(sql, params, {
    label,
    timeoutMs: 30000,
    maxRetries: 0,
    poolType: 'write',
  });
}

function normalizeEvent(eventData = {}) {
  const eventType = String(eventData.event_type || 'OTHER').trim().toUpperCase();
  const eventDate = normalizeDate(eventData.event_date);
  const symbol = eventData.symbol ? String(eventData.symbol).trim().toUpperCase() : null;
  const relatedSymbols = Array.isArray(eventData.related_symbols)
    ? [...new Set(eventData.related_symbols.map((value) => String(value || '').trim().toUpperCase()).filter(Boolean))]
    : [];
  const title = String(eventData.title || '').trim();
  const source = String(eventData.source || '').trim();
  const sourceId = eventData.source_id ? String(eventData.source_id).trim() : null;

  if (!eventDate || !title || !source) {
    throw new Error('event_date, title, and source are required');
  }

  return {
    event_type: eventType,
    event_date: eventDate,
    event_time: eventData.event_time ? String(eventData.event_time).trim() : null,
    event_datetime: eventData.event_datetime || null,
    symbol,
    related_symbols: relatedSymbols,
    title,
    description: eventData.description ? String(eventData.description).trim() : null,
    source,
    source_id: sourceId,
    source_url: eventData.source_url ? String(eventData.source_url).trim() : null,
    importance: Number(eventData.importance || computeImportance(eventType, eventData.metadata || {})),
    confidence: eventData.confidence ? String(eventData.confidence).trim() : 'confirmed',
    metadata: eventData.metadata || {},
    raw_payload: eventData.raw_payload || {},
  };
}

async function upsertEvent(eventData, client, options = {}) {
  const event = normalizeEvent(eventData);
  if (isDryRun(options)) {
    return { inserted: 0, updated: 0, dryRun: true, event };
  }

  const insertResult = await executeWrite(
    `INSERT INTO event_calendar (
       event_type,
       event_date,
       event_time,
       event_datetime,
       symbol,
       related_symbols,
       title,
       description,
       source,
       source_id,
       source_url,
       importance,
       confidence,
       metadata,
       raw_payload,
       updated_at
     ) VALUES (
       $1, $2::date, $3, $4::timestamptz, $5, $6::text[], $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, NOW()
     ) ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      event.event_type,
      event.event_date,
      event.event_time,
      event.event_datetime,
      event.symbol,
      event.related_symbols,
      event.title,
      event.description,
      event.source,
      event.source_id,
      event.source_url,
      event.importance,
      event.confidence,
      JSON.stringify(event.metadata || {}),
      JSON.stringify(event.raw_payload || {}),
    ],
    client,
    'calendar.upsertEvent.insert'
  );

  if (insertResult.rowCount > 0) {
    return { inserted: 1, updated: 0, dryRun: false, event };
  }

  const updateResult = await executeWrite(
    `UPDATE event_calendar
     SET event_time = $6,
         event_datetime = $7::timestamptz,
         related_symbols = $8::text[],
         description = $9,
         source = $10,
         source_url = $11,
         importance = $12,
         confidence = $13,
         metadata = $14::jsonb,
         raw_payload = $15::jsonb,
         updated_at = NOW()
     WHERE event_type = $1
       AND event_date = $2::date
       AND COALESCE(symbol, '') = COALESCE($3, '')
       AND COALESCE(source_id, title) = COALESCE($4, $5)
     RETURNING id`,
    [
      event.event_type,
      event.event_date,
      event.symbol,
      event.source_id,
      event.title,
      event.event_time,
      event.event_datetime,
      event.related_symbols,
      event.description,
      event.source,
      event.source_url,
      event.importance,
      event.confidence,
      JSON.stringify(event.metadata || {}),
      JSON.stringify(event.raw_payload || {}),
    ],
    client,
    'calendar.upsertEvent.update'
  );

  return { inserted: 0, updated: updateResult.rowCount || 0, dryRun: false, event };
}

async function upsertEvents(events = [], client, options = {}) {
  let inserted = 0;
  let updated = 0;
  for (const event of events) {
    const result = await upsertEvent(event, client, options);
    inserted += result.inserted || 0;
    updated += result.updated || 0;
  }
  return { inserted, updated, dryRun: isDryRun(options) };
}

async function flagSystemHealth(sourceName, flagType, severity, message, metadata = {}, client, options = {}) {
  if (isDryRun(options)) {
    return { inserted: 0, updated: 0, dryRun: true };
  }

  const updateResult = await executeWrite(
    `UPDATE system_flags
     SET severity = $3,
         message = $4,
         metadata = $5::jsonb,
         last_detected_at = NOW()
     WHERE source_name = $1
       AND flag_type = $2
       AND resolved_at IS NULL
     RETURNING id`,
    [sourceName, flagType, severity, message, JSON.stringify(metadata || {})],
    client,
    'calendar.flagSystemHealth.update'
  );

  if ((updateResult.rowCount || 0) > 0) {
    return { inserted: 0, updated: updateResult.rowCount || 0, dryRun: false };
  }

  const insertResult = await executeWrite(
    `INSERT INTO system_flags (source_name, flag_type, severity, message, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id`,
    [sourceName, flagType, severity, message, JSON.stringify(metadata || {})],
    client,
    'calendar.flagSystemHealth.insert'
  );

  return { inserted: insertResult.rowCount || 0, updated: 0, dryRun: false };
}

async function resolveSystemFlag(sourceName, flagType, client, options = {}) {
  if (isDryRun(options)) {
    return { resolved: 0, dryRun: true };
  }

  const result = await executeWrite(
    `UPDATE system_flags
     SET resolved_at = NOW(),
         resolved_by = 'calendar_ingestion'
     WHERE source_name = $1
       AND flag_type = $2
       AND resolved_at IS NULL`,
    [sourceName, flagType],
    client,
    'calendar.resolveSystemFlag'
  );

  return { resolved: result.rowCount || 0, dryRun: false };
}

async function httpGetJson(url, options = {}) {
  const { sourceName = 'calendar', params, fingerprint, expectedNonEmpty = false } = options;
  let response;

  try {
    response = await httpClient.get(url, { params });
  } catch (error) {
    const flagType = String(error.message || '').toLowerCase().includes('getaddrinfo') ? 'dns_failure' : 'endpoint_unreachable';
    await flagSystemHealth(sourceName, flagType, 'critical', error.message, { url });
    throw error;
  }

  if (response.status !== 200) {
    const flagType = response.status === 429 ? 'rate_limited' : response.status === 403 ? 'blocked' : 'endpoint_unreachable';
    await flagSystemHealth(sourceName, flagType, response.status >= 500 ? 'critical' : 'warning', `HTTP ${response.status}`, { url, status: response.status });
    throw new Error(`${sourceName} request failed with status ${response.status}`);
  }

  const data = response.data;
  if (fingerprint && !fingerprint(data)) {
    await flagSystemHealth(sourceName, 'schema_drift', 'critical', 'Response fingerprint mismatch', { url });
    throw new Error(`${sourceName} response fingerprint mismatch`);
  }

  if (expectedNonEmpty) {
    const size = Array.isArray(data) ? data.length : Array.isArray(data?.results) ? data.results.length : Array.isArray(data?.events) ? data.events.length : null;
    if (size === 0) {
      await flagSystemHealth(sourceName, 'data_stale', 'warning', 'Empty response where data was expected', { url });
    }
  }

  await resolveSystemFlag(sourceName, 'endpoint_unreachable');
  await resolveSystemFlag(sourceName, 'rate_limited');
  await resolveSystemFlag(sourceName, 'blocked');
  await resolveSystemFlag(sourceName, 'schema_drift');
  return data;
}

async function httpGetText(url, options = {}) {
  const { sourceName = 'calendar', fingerprint, expectedSubstring } = options;
  let response;

  try {
    response = await httpClient.get(url, { responseType: 'text', transformResponse: [(value) => value] });
  } catch (error) {
    const flagType = String(error.message || '').toLowerCase().includes('getaddrinfo') ? 'dns_failure' : 'endpoint_unreachable';
    await flagSystemHealth(sourceName, flagType, 'critical', error.message, { url });
    throw error;
  }

  if (response.status !== 200) {
    const flagType = response.status === 429 ? 'rate_limited' : response.status === 403 ? 'blocked' : 'endpoint_unreachable';
    await flagSystemHealth(sourceName, flagType, response.status >= 500 ? 'critical' : 'warning', `HTTP ${response.status}`, { url, status: response.status });
    throw new Error(`${sourceName} request failed with status ${response.status}`);
  }

  const text = String(response.data || '');
  if (fingerprint && !fingerprint(text)) {
    await flagSystemHealth(sourceName, 'schema_drift', 'critical', 'HTML fingerprint mismatch', { url });
    throw new Error(`${sourceName} HTML fingerprint mismatch`);
  }
  if (expectedSubstring && !text.includes(expectedSubstring)) {
    await flagSystemHealth(sourceName, 'schema_drift', 'warning', 'Expected HTML marker missing', { url, expectedSubstring });
  }

  await resolveSystemFlag(sourceName, 'endpoint_unreachable');
  await resolveSystemFlag(sourceName, 'rate_limited');
  await resolveSystemFlag(sourceName, 'blocked');
  await resolveSystemFlag(sourceName, 'schema_drift');
  return text;
}

async function runCalendarJob(jobName, fn, options = {}) {
  const startedAt = Date.now();
  logger.info('calendar job start', { jobName, dryRun: isDryRun(options) });
  try {
    const result = await fn();
    logger.info('calendar job success', { jobName, durationMs: Date.now() - startedAt, ...result });
    return result;
  } catch (error) {
    logger.error('calendar job failure', { jobName, durationMs: Date.now() - startedAt, error: error.message });
    throw error;
  }
}

module.exports = {
  addDays,
  computeImportance,
  flagSystemHealth,
  httpGetJson,
  httpGetText,
  isDryRun,
  makeSourceId,
  normalizeDate,
  parseFredDate,
  parseFredReleaseTime,
  resolveSystemFlag,
  runCalendarJob,
  upsertEvent,
  upsertEvents,
};