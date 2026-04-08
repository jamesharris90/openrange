/**
 * ipoCalendar.js
 * GET /api/ipo/calendar?weekOffset=0
 *
 * Serves IPO calendar from the ipo_calendar DB table.
 * If data for the requested week is stale (>6h) or missing, triggers a
 * background refresh from FMP /stable/ipos-calendar and upserts into DB.
 */

const express = require('express');
const axios   = require('axios');
const { queryWithTimeout } = require('../db/pg');

const router = express.Router();
const FMP_BASE        = 'https://financialmodelingprep.com';
const REQUEST_TIMEOUT = 15_000;
const CACHE_TTL_MS    = 6 * 60 * 60 * 1000; // 6 hours

// ── date helpers ──────────────────────────────────────────────────────────────

function toUtcMidnight(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
function isoDate(date) {
  return date.toISOString().slice(0, 10);
}
function addDays(date, n) {
  const out = new Date(date);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}
function getMondayOfWeek(date) {
  const d   = toUtcMidnight(date);
  const day = d.getUTCDay();
  const off = day === 0 ? -6 : 1 - day;
  return addDays(d, off);
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const MONTHS     = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDayLabel(date) {
  const dow = date.getUTCDay();
  if (dow === 0 || dow === 6) return null;
  return `${DAY_LABELS[dow - 1]} ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

// ── FMP fetch + upsert ────────────────────────────────────────────────────────

async function fetchAndUpsertIpos(from, to) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return 0;

  let raw = [];
  try {
    const resp = await axios.get(`${FMP_BASE}/stable/ipos-calendar`, {
      params: { from, to, apikey: apiKey },
      timeout: REQUEST_TIMEOUT,
      validateStatus: () => true,
    });
    if (resp.status === 200 && Array.isArray(resp.data)) {
      raw = resp.data;
    }
  } catch (err) {
    console.error('[ipoCalendar] FMP fetch error:', err.message);
    return 0;
  }

  if (!raw.length) return 0;

  // Batch-quote for live price/mcap enrichment
  const symbols = [...new Set(raw.map(i => i.symbol).filter(Boolean))];
  const quoteMap = new Map();
  const profileMap = new Map();

  try {
    const qResp = await axios.get(`${FMP_BASE}/stable/batch-quote`, {
      params: { symbols: symbols.join(','), apikey: apiKey },
      timeout: REQUEST_TIMEOUT,
      validateStatus: () => true,
    });
    if (qResp.status === 200 && Array.isArray(qResp.data)) {
      for (const q of qResp.data) {
        if (q.symbol) quoteMap.set(q.symbol.toUpperCase(), q);
      }
    }
  } catch (_) {}

  // Fetch profiles in batches of 10 to get sector/industry/description
  for (let i = 0; i < symbols.length; i += 10) {
    const batch = symbols.slice(i, i + 10).join(',');
    try {
      const pResp = await axios.get(`${FMP_BASE}/stable/profile`, {
        params: { symbol: batch, apikey: apiKey },
        timeout: REQUEST_TIMEOUT,
        validateStatus: () => true,
      });
      if (pResp.status === 200 && Array.isArray(pResp.data)) {
        for (const p of pResp.data) {
          if (p.symbol) profileMap.set(p.symbol.toUpperCase(), p);
        }
      }
    } catch (_) {}
  }

  let upserted = 0;
  for (const item of raw) {
    const symbol    = item.symbol || null;
    const eventDate = String(item.date || item.daa || '').slice(0, 10);
    if (!symbol || !eventDate) continue;

    const priceRangeStr = item.priceRange || null;
    const q = quoteMap.get(symbol.toUpperCase()) || {};
    const p = profileMap.get(symbol.toUpperCase()) || {};

    // Prefer FMP calendar data, fall back to live quote for market_cap
    const marketCap = item.marketCap != null ? Number(item.marketCap)
      : (q.marketCap && q.marketCap > 0 ? Number(q.marketCap) : null);
    const listingPrice = q.price != null ? Number(q.price) : null;

    try {
      await queryWithTimeout(
        `INSERT INTO ipo_calendar
           (symbol, event_date, company, exchange, actions, price_range, shares, market_cap,
            sector, industry, description, listing_price, source, raw_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'fmp',$13)
         ON CONFLICT (symbol, event_date, actions) DO UPDATE SET
           company       = EXCLUDED.company,
           exchange      = EXCLUDED.exchange,
           price_range   = EXCLUDED.price_range,
           shares        = EXCLUDED.shares,
           market_cap    = COALESCE(EXCLUDED.market_cap, ipo_calendar.market_cap),
           sector        = COALESCE(EXCLUDED.sector, ipo_calendar.sector),
           industry      = COALESCE(EXCLUDED.industry, ipo_calendar.industry),
           description   = COALESCE(EXCLUDED.description, ipo_calendar.description),
           listing_price = COALESCE(EXCLUDED.listing_price, ipo_calendar.listing_price),
           raw_json      = EXCLUDED.raw_json,
           ingested_at   = NOW()`,
        [
          symbol,
          eventDate,
          item.company || item.name || null,
          item.exchange || null,
          item.actions || 'Expected',
          priceRangeStr,
          item.shares != null ? Number(item.shares) : null,
          marketCap,
          p.sector || null,
          p.industry || null,
          p.description ? String(p.description).slice(0, 500) : null,
          listingPrice,
          JSON.stringify(item),
        ],
        { label: 'ipo.upsert', timeoutMs: 3000, maxRetries: 0 }
      );
      upserted++;
    } catch (err) {
      // ignore individual upsert errors
    }
  }

  console.log(`[ipoCalendar] upserted ${upserted}/${raw.length} IPOs for ${from}–${to}`);
  return upserted;
}

// ── staleness check ───────────────────────────────────────────────────────────

async function isWeekStale(weekStart) {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT MAX(ingested_at) AS last_ingested
       FROM ipo_calendar
       WHERE event_date >= $1::date
         AND event_date <= ($1::date + INTERVAL '6 days')`,
      [weekStart],
      { label: 'ipo.staleCheck', timeoutMs: 2000, maxRetries: 0 }
    );
    const last = rows[0]?.last_ingested;
    if (!last) return true;
    return (Date.now() - new Date(last).getTime()) > CACHE_TTL_MS;
  } catch {
    return true;
  }
}

// ── route ─────────────────────────────────────────────────────────────────────

router.get('/calendar', async (req, res) => {
  const weekOffset = parseInt(String(req.query.weekOffset || '0'), 10) || 0;
  if (Math.abs(weekOffset) > 52) {
    return res.status(400).json({ error: 'weekOffset out of range (max ±52)' });
  }

  const today     = new Date();
  const monday    = addDays(getMondayOfWeek(today), weekOffset * 7);
  const friday    = addDays(monday, 4);
  const weekStart = isoDate(monday);
  const weekEnd   = isoDate(friday);

  // Background refresh if stale (don't block the response)
  isWeekStale(weekStart).then(async (stale) => {
    if (stale) {
      await fetchAndUpsertIpos(weekStart, weekEnd);
    }
  }).catch(() => {});

  try {
    const { rows } = await queryWithTimeout(
      `SELECT symbol, event_date::text AS event_date, company, exchange, actions,
              price_range, shares, market_cap, listing_price, sector, industry, description
       FROM ipo_calendar
       WHERE event_date >= $1::date
         AND event_date <= $2::date
       ORDER BY event_date ASC, market_cap DESC NULLS LAST, symbol ASC`,
      [weekStart, weekEnd],
      { label: 'ipo.calendar', timeoutMs: 5000, maxRetries: 1, retryDelayMs: 200 }
    );

    // Group by date
    const byDate = new Map();
    for (const row of rows) {
      const d = String(row.event_date || '').slice(0, 10);
      if (!d) continue;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push({
        symbol:        row.symbol,
        companyName:   row.company || null,
        exchange:      row.exchange || null,
        actions:       row.actions || null,
        priceRange:    row.price_range || null,
        sharesOffered: row.shares != null ? Number(row.shares) : null,
        marketCap:     row.market_cap != null ? Number(row.market_cap) : null,
        listingPrice:  row.listing_price != null ? Number(row.listing_price) : null,
        sector:        row.sector || null,
        industry:      row.industry || null,
        description:   row.description || null,
        ipoDate:       d,
      });
    }

    // Build Mon–Fri structure
    const days = [];
    for (let i = 0; i < 5; i++) {
      const date  = addDays(monday, i);
      const d     = isoDate(date);
      const label = formatDayLabel(date);
      if (!label) continue;
      days.push({ date: d, label, events: byDate.get(d) || [] });
    }

    return res.json({
      weekStart,
      weekEnd,
      weekOffset,
      totalEvents: rows.length,
      days,
    });
  } catch (err) {
    console.error('[ipoCalendar] DB error', err.message);
    return res.status(500).json({ error: err.message || 'Failed to load IPO calendar' });
  }
});

// ── exported helper for scheduler ─────────────────────────────────────────────

async function refreshIpoCalendar(weeksAhead = 4) {
  const today  = new Date();
  const monday = getMondayOfWeek(today);
  let total = 0;
  for (let i = 0; i <= weeksAhead; i++) {
    const from = isoDate(addDays(monday, i * 7));
    const to   = isoDate(addDays(monday, i * 7 + 4));
    total += await fetchAndUpsertIpos(from, to);
  }
  return total;
}

module.exports = router;
module.exports.refreshIpoCalendar = refreshIpoCalendar;
