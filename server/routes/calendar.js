const express = require('express');

const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { transformEventToCatalystEvent } = require('../services/calendarTransform');
const { computeAvgHistoricalMoveForSymbols } = require('../services/historicalMoveCalculator');
const { getCurrentWatchlistSymbols, getWatchlistCacheUpdatedAt } = require('../services/watchlistDeriver');
const { getSmartMoneyConcentration } = require('../services/smartMoneyConcentration');

const router = express.Router();

const BASE_EVENT_SELECT = `
  SELECT
    id,
    event_type,
    event_date::text AS event_date,
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
    ingested_at,
    updated_at
  FROM event_calendar
`;

function currentDateInTimezone(timeZone = 'Europe/London') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseDate(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : trimmed;
}

function parseMonth(value) {
  const trimmed = String(value || '').trim();
  if (!/^\d{4}-\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}-01T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : trimmed;
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function parseLimit(value, defaultValue = 200, maxValue = 500) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.min(maxValue, Math.trunc(parsed));
}

function parseTierList(value) {
  if (!value) return null;
  const tiers = String(value)
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((tier) => Number.isInteger(tier) && tier >= 1 && tier <= 4);

  return tiers.length > 0 ? [...new Set(tiers)] : null;
}

function parseSymbolList(value) {
  if (!value) return null;
  const symbols = String(value)
    .split(',')
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);

  return symbols.length > 0 ? [...new Set(symbols)] : null;
}

function buildErrorResponse(error) {
  const payload = { error: 'Database error' };
  if (process.env.NODE_ENV !== 'production') {
    payload.detail = error.message;
  }
  return payload;
}

function extractUniqueSymbols(rows) {
  return [...new Set(rows.map((row) => String(row.symbol || '').trim().toUpperCase()).filter(Boolean))];
}

function toTodayBuckets(events) {
  const buckets = {
    bmo: [],
    intraday: [],
    amc: [],
    other: [],
  };

  events.forEach((event) => {
    if (!event.symbol) {
      buckets.other.push(event);
      return;
    }
    if (event.time === 'BMO') {
      buckets.bmo.push(event);
      return;
    }
    if (event.time === 'AMC') {
      buckets.amc.push(event);
      return;
    }
    if (/^\d{1,2}:\d{2}$/.test(String(event.time || ''))) {
      const [hours, minutes] = String(event.time).split(':').map(Number);
      const totalMinutes = (hours * 60) + minutes;
      const marketOpenMinutes = (14 * 60) + 30;
      const marketCloseMinutes = 21 * 60;
      if (totalMinutes >= marketOpenMinutes && totalMinutes <= marketCloseMinutes) {
        buckets.intraday.push(event);
      } else {
        buckets.other.push(event);
      }
      return;
    }
    buckets.other.push(event);
  });

  return buckets;
}

async function loadSupportingMaps(rows, watchlistSet) {
  const symbols = extractUniqueSymbols(rows);
  const [historicalMoveMap, smartMoneyMap] = await Promise.all([
    computeAvgHistoricalMoveForSymbols(symbols),
    getSmartMoneyConcentration(symbols),
  ]);

  return rows.map((row) => transformEventToCatalystEvent(row, smartMoneyMap, watchlistSet, historicalMoveMap));
}

router.get('/events', async (req, res) => {
  try {
    const defaultFrom = currentDateInTimezone('Europe/London');
    const from = parseDate(req.query.from) || defaultFrom;
    const to = parseDate(req.query.to) || addDays(defaultFrom, 30);
    const requestedFrom = req.query.from;
    const requestedTo = req.query.to;
    if ((requestedFrom && !parseDate(requestedFrom)) || (requestedTo && !parseDate(requestedTo))) {
      return res.status(400).json({ error: 'Invalid date. Use YYYY-MM-DD.' });
    }

    const tiers = parseTierList(req.query.tiers);
    const symbols = parseSymbolList(req.query.symbols);
    const watchlistOnly = parseBoolean(req.query.watchlistOnly);
    const limit = parseLimit(req.query.limit, 200, 500);

    const watchlistSet = await getCurrentWatchlistSymbols();
    let querySymbols = symbols;
    if (watchlistOnly) {
      const watchlistSymbols = [...watchlistSet];
      if (watchlistSymbols.length === 0) {
        return res.json({ events: [], meta: { total: 0, from, to } });
      }

      if (querySymbols && querySymbols.length > 0) {
        querySymbols = querySymbols.filter((symbol) => watchlistSet.has(symbol));
      } else {
        querySymbols = watchlistSymbols;
      }

      if (querySymbols.length === 0) {
        return res.json({ events: [], meta: { total: 0, from, to } });
      }
    }

    const conditions = ['event_date BETWEEN $1::date AND $2::date'];
    const params = [from, to];
    if (querySymbols && querySymbols.length > 0) {
      params.push(querySymbols);
      conditions.push(`symbol = ANY($${params.length}::text[])`);
    }
    params.push(limit);

    const result = await queryWithTimeout(
      `${BASE_EVENT_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY event_date ASC, importance DESC LIMIT $${params.length}`,
      params,
      {
        label: 'calendar.route.events',
        timeoutMs: 10000,
        slowQueryMs: 1000,
        poolType: 'read',
        maxRetries: 1,
      },
    );

    let events = await loadSupportingMaps(result.rows, watchlistSet);
    if (tiers) {
      const tierSet = new Set(tiers);
      events = events.filter((event) => tierSet.has(event.tier));
    }

    return res.json({
      events,
      meta: {
        total: events.length,
        from,
        to,
      },
    });
  } catch (error) {
    logger.error('calendar events endpoint failed', { error: error.message, query: req.query });
    return res.status(500).json(buildErrorResponse(error));
  }
});

router.get('/events/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid event id' });
    }

    const eventResult = await queryWithTimeout(
      `${BASE_EVENT_SELECT} WHERE id = $1 LIMIT 1`,
      [id],
      {
        label: 'calendar.route.event_by_id',
        timeoutMs: 8000,
        slowQueryMs: 1000,
        poolType: 'read',
        maxRetries: 1,
      },
    );

    const eventRow = eventResult.rows[0];
    if (!eventRow) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const watchlistSet = await getCurrentWatchlistSymbols();
    const [historicalMoveMap, smartMoneyMap] = await Promise.all([
      computeAvgHistoricalMoveForSymbols(extractUniqueSymbols([eventRow])),
      getSmartMoneyConcentration(extractUniqueSymbols([eventRow])),
    ]);

    const transformed = transformEventToCatalystEvent(eventRow, smartMoneyMap, watchlistSet, historicalMoveMap);
    let relatedEvents = [];
    if (eventRow.symbol) {
      const relatedResult = await queryWithTimeout(
        `${BASE_EVENT_SELECT}
         WHERE symbol = $1
           AND id <> $2
           AND event_date BETWEEN ($3::date - INTERVAL '7 days') AND ($3::date + INTERVAL '7 days')
         ORDER BY event_date ASC, importance DESC
         LIMIT 20`,
        [String(eventRow.symbol).trim().toUpperCase(), id, eventRow.event_date],
        {
          label: 'calendar.route.related_events',
          timeoutMs: 8000,
          slowQueryMs: 1000,
          poolType: 'read',
          maxRetries: 1,
        },
      );
      relatedEvents = relatedResult.rows.map((row) => transformEventToCatalystEvent(row, smartMoneyMap, watchlistSet, historicalMoveMap));
    }

    return res.json({
      ...transformed,
      source_url: eventRow.source_url || null,
      metadata: eventRow.metadata || {},
      related_events: relatedEvents,
    });
  } catch (error) {
    logger.error('calendar event detail endpoint failed', { error: error.message, params: req.params });
    return res.status(500).json(buildErrorResponse(error));
  }
});

router.get('/heatmap', async (req, res) => {
  try {
    const defaultMonth = currentDateInTimezone('Europe/London').slice(0, 7);
    const month = parseMonth(req.query.month || defaultMonth);
    if (!month) {
      return res.status(400).json({ error: 'Invalid month. Use YYYY-MM.' });
    }

    const from = `${month}-01`;
    const to = new Date(`${from}T00:00:00Z`);
    to.setUTCMonth(to.getUTCMonth() + 1);
    to.setUTCDate(0);

    const result = await queryWithTimeout(
      `
        SELECT id, event_date::text AS event_date, importance, event_type, symbol, metadata
        FROM event_calendar
        WHERE event_date BETWEEN $1::date AND $2::date
        ORDER BY event_date ASC, importance DESC
      `,
      [from, to.toISOString().slice(0, 10)],
      {
        label: 'calendar.route.heatmap',
        timeoutMs: 10000,
        slowQueryMs: 1000,
        poolType: 'read',
        maxRetries: 1,
      },
    );

    const groupedDays = new Map();
    result.rows.forEach((row) => {
      if (!groupedDays.has(row.event_date)) {
        groupedDays.set(row.event_date, []);
      }
      groupedDays.get(row.event_date).push(row);
    });

    const days = [...groupedDays.entries()].map(([date, rows]) => ({
      date,
      events: rows.map((row) => ({
        id: String(row.id),
        symbol: row.symbol ? String(row.symbol).trim().toUpperCase() : '',
        tier: require('../services/calendarTransform').mapImportanceToTier(row.importance, row.event_type === 'CLINICAL_TRIAL_READOUT' ? 'TRIAL_SUCCESS' : row.event_type),
      })),
      heatIntensity: Math.min(1, rows.reduce((sum, row) => sum + (Number(row.importance || 0) / 10), 0)),
    }));

    return res.json({ month, days });
  } catch (error) {
    logger.error('calendar heatmap endpoint failed', { error: error.message, query: req.query });
    return res.status(500).json(buildErrorResponse(error));
  }
});

router.get('/today', async (req, res) => {
  try {
    const timeZone = String(req.query.timezone || 'Europe/London');
    const date = currentDateInTimezone(timeZone);

    const result = await queryWithTimeout(
      `${BASE_EVENT_SELECT} WHERE event_date = $1::date ORDER BY importance DESC, event_time ASC NULLS LAST`,
      [date],
      {
        label: 'calendar.route.today',
        timeoutMs: 10000,
        slowQueryMs: 1000,
        poolType: 'read',
        maxRetries: 1,
      },
    );

    const watchlistSet = await getCurrentWatchlistSymbols();
    const events = await loadSupportingMaps(result.rows, watchlistSet);
    const buckets = toTodayBuckets(events);

    return res.json({
      date,
      ...buckets,
    });
  } catch (error) {
    logger.error('calendar today endpoint failed', { error: error.message, query: req.query });
    return res.status(500).json(buildErrorResponse(error));
  }
});

router.get('/', async (_req, res) => {
  try {
    const watchlistSet = await getCurrentWatchlistSymbols();
    const symbols = [...watchlistSet].sort((left, right) => left.localeCompare(right));
    return res.json({
      symbols,
      source: 'beacon_v0_picks_5d',
      updated_at: getWatchlistCacheUpdatedAt() || new Date().toISOString(),
    });
  } catch (error) {
    logger.error('watchlist endpoint failed', { error: error.message });
    return res.status(500).json(buildErrorResponse(error));
  }
});

module.exports = router;