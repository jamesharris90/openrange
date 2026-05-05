const ECONOMIC_RELEASE_CATEGORY_MAP = new Map([
  [10, 'CPI'],
  [46, 'NFP'],
  [11, 'PPI'],
]);

const TIER_ONE_EVENT_TYPES = new Set([
  'FDA_APPROVAL',
  'PDUFA',
  'TRIAL_SUCCESS',
  'CLINICAL_TRIAL_READOUT',
  'CONTRACT_AWARD',
  'REGULATORY_CLEARANCE',
  'GUIDANCE_RAISE',
]);

const TIER_TWO_EVENT_TYPES = new Set([
  'EARNINGS',
  'FOMC',
  'ECONOMIC_RELEASE',
]);

const TIER_THREE_EVENT_TYPES = new Set([
  'ANALYST_UPGRADE',
  'CONFERENCE',
  'PARTNERSHIP',
  'INSIDER_BUYING',
  'IPO_LOCKUP',
  'LOCKUP_EXPIRY',
  'SPINOFF',
  'M_AND_A',
]);

function normalizeType(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeDateString(value) {
  if (!value) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return `${trimmed}T00:00:00.000Z`;
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }

    return trimmed;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function readMapValue(container, key) {
  if (!container || !key) return null;
  if (container instanceof Map) {
    return container.get(key) ?? null;
  }
  if (typeof container === 'object') {
    return container[key] ?? null;
  }
  return null;
}

/**
 * Map an event_calendar event_type to the lossy v0 EventCategory enum.
 * Example: mapEventTypeToCategory('LOCKUP_EXPIRY') -> 'IPO_LOCKUP'
 * Example: mapEventTypeToCategory('ECONOMIC_RELEASE', { fred_release_id: 10 }) -> 'CPI'
 */
function mapEventTypeToCategory(eventType, metadata = {}) {
  const normalizedType = normalizeType(eventType);
  const releaseId = Number(metadata?.fred_release_id ?? metadata?.release_id ?? metadata?.releaseId);

  switch (normalizedType) {
    case 'FOMC':
      return 'FOMC';
    case 'ECONOMIC_RELEASE':
      return ECONOMIC_RELEASE_CATEGORY_MAP.get(releaseId) || 'GENERIC';
    case 'EARNINGS':
      return 'EARNINGS';
    case 'IPO':
    case 'IPO_DISCLOSURE':
    case 'IPO_PROSPECTUS':
      return 'GENERIC';
    case 'LOCKUP_EXPIRY':
      return 'IPO_LOCKUP';
    case 'STOCK_SPLIT':
      return 'GENERIC';
    case 'PDUFA':
      return 'PDUFA';
    case 'CLINICAL_TRIAL_READOUT':
      return 'TRIAL_SUCCESS';
    case 'INDEX_REBALANCE':
      return 'GENERIC';
    case 'CONFERENCE':
      return 'CONFERENCE';
    case 'ELECTION':
    case 'ADVERSE_EVENT_SPIKE':
    case 'DRUG_RECALL':
    case 'PATENT_EXPIRY':
    case 'OTHER':
    default:
      return 'GENERIC';
  }
}

/**
 * Convert event importance plus hard overrides into the v0 EventTier scale.
 * Example: mapImportanceToTier(8, 'EARNINGS') -> 2
 * Example: mapImportanceToTier(4, 'LOCKUP_EXPIRY') -> 3
 */
function mapImportanceToTier(importance, eventType) {
  const normalizedType = normalizeType(eventType);
  if (TIER_ONE_EVENT_TYPES.has(normalizedType)) return 1;
  if (TIER_TWO_EVENT_TYPES.has(normalizedType)) return 2;
  if (TIER_THREE_EVENT_TYPES.has(normalizedType)) return 3;

  const numericImportance = Number(importance);
  if (numericImportance >= 9) return 1;
  if (numericImportance >= 7) return 2;
  if (numericImportance >= 5) return 3;
  return 4;
}

function to24HourTime(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})\s*([ap])\.m\.?$/i);
  if (!match) return undefined;

  let hours = Number(match[1]);
  const minutes = match[2];
  const meridiem = match[3].toLowerCase();

  if (meridiem === 'p' && hours < 12) hours += 12;
  if (meridiem === 'a' && hours === 12) hours = 0;

  return `${String(hours).padStart(2, '0')}:${minutes}`;
}

/**
 * Normalize event time values into the limited v0 display format.
 * Example: extractTime('BMO', 'EARNINGS') -> 'BMO'
 * Example: extractTime('2:00 p.m.', 'FOMC') -> '14:00'
 */
function extractTime(eventTime, eventType) {
  const raw = String(eventTime || '').trim();
  if (!raw) {
    return normalizeType(eventType) === 'FOMC' ? '19:00' : undefined;
  }

  if (/bmo/i.test(raw)) return 'BMO';
  if (/amc/i.test(raw)) return 'AMC';
  if (/^\d{1,2}:\d{2}$/.test(raw)) return raw;

  const converted = to24HourTime(raw);
  if (converted) return converted;

  return undefined;
}

/**
 * Transform an event_calendar row into the v0 CatalystEvent shape.
 * Example: transformEventToCatalystEvent({ id: 1, event_type: 'EARNINGS', symbol: 'AAPL', ... })
 * -> { id: '1', symbol: 'AAPL', category: 'EARNINGS', tier: 2, ... }
 */
function transformEventToCatalystEvent(eventRow, smartMoneyMap, watchlistSet, historicalMoveMap) {
  const metadata = eventRow?.metadata && typeof eventRow.metadata === 'object' ? eventRow.metadata : {};
  const symbol = String(eventRow?.symbol || '').trim().toUpperCase();
  const category = mapEventTypeToCategory(eventRow?.event_type, metadata);
  const tier = mapImportanceToTier(eventRow?.importance, eventRow?.event_type === 'CLINICAL_TRIAL_READOUT' ? 'TRIAL_SUCCESS' : eventRow?.event_type);
  const avgHistoricalMove = readMapValue(historicalMoveMap, symbol);
  const smartMoneyConcentration = readMapValue(smartMoneyMap, symbol);
  const isWatchlist = Boolean(symbol && watchlistSet instanceof Set && watchlistSet.has(symbol));

  return {
    id: String(eventRow?.id),
    symbol,
    title: eventRow?.title || '',
    category,
    tier,
    date: normalizeDateString(eventRow?.event_date),
    time: extractTime(eventRow?.event_time, eventRow?.event_type),
    impliedMove: null,
    avgHistoricalMove: Number.isFinite(Number(avgHistoricalMove)) ? Number(avgHistoricalMove) : null,
    smartMoneyConcentration: Number.isFinite(Number(smartMoneyConcentration)) ? Number(smartMoneyConcentration) : null,
    description: eventRow?.description || null,
    isWatchlist,
  };
}

module.exports = {
  mapEventTypeToCategory,
  mapImportanceToTier,
  extractTime,
  transformEventToCatalystEvent,
};