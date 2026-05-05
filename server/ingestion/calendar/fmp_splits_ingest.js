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

const SOURCE_NAME = 'fmp_splits';

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeSplitRow(row) {
  const eventDate = normalizeDate(row?.date || row?.paymentDate || row?.recordDate);
  const symbol = String(row?.symbol || '').trim().toUpperCase() || null;
  if (!eventDate || !symbol) return null;

  const numerator = toNumber(row?.numerator || row?.splitFromNumber);
  const denominator = toNumber(row?.denominator || row?.splitToNumber);

  return {
    event_type: 'STOCK_SPLIT',
    event_date: eventDate,
    symbol,
    title: `${symbol} stock split`,
    description: row?.label || row?.ratio || null,
    source: 'FMP',
    source_id: makeSourceId(['split', symbol, eventDate, numerator, denominator]),
    source_url: '/stable/splits-calendar',
    importance: computeImportance('STOCK_SPLIT', { numerator, denominator }),
    confidence: 'confirmed',
    metadata: {
      numerator,
      denominator,
      ratio: row?.ratio || null,
      record_date: normalizeDate(row?.recordDate),
      payment_date: normalizeDate(row?.paymentDate),
    },
    raw_payload: row,
  };
}

async function runIngest(options = {}) {
  return runCalendarJob('fmp_splits_ingest', async () => {
    const dryRun = isDryRun(options);
    const today = options.today || new Date().toISOString().slice(0, 10);
    const from = options.fromDate || today;
    const to = options.toDate || addDays(today, 90);

    let payload = [];
    try {
      payload = await fmpFetch('/splits-calendar', { from, to });
      await resolveSystemFlag(SOURCE_NAME, 'endpoint_unreachable');
      await resolveSystemFlag(SOURCE_NAME, 'rate_limited');
    } catch (error) {
      await flagSystemHealth(SOURCE_NAME, Number(error?.status || 0) === 429 ? 'rate_limited' : 'endpoint_unreachable', 'warning', error.message, { from, to });
    }

    const events = (Array.isArray(payload) ? payload : []).map(normalizeSplitRow).filter(Boolean);
    const persistence = await upsertEvents(events, null, { dryRun });
    return { dryRun, fetched: payload.length || 0, candidateEvents: events.length, ...persistence };
  }, options);
}

module.exports = {
  normalizeSplitRow,
  runIngest,
};