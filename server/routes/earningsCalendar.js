/**
 * earningsCalendar.js
 * GET /api/earnings/calendar?weekOffset=0
 *
 * Returns the earnings calendar for a given week.
 * weekOffset: 0 = current week, +1 = next week, -1 = last week
 *
 * Response:
 * {
 *   weekStart: "2026-03-24",
 *   weekEnd:   "2026-03-28",
 *   days: [
 *     { date: "2026-03-24", label: "Mon Mar 24", events: [...] },
 *     ...
 *   ]
 * }
 */

const express = require('express');
const { queryWithTimeout } = require('../db/pg');

const router = express.Router();

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
  const d = toUtcMidnight(date);
  const day = d.getUTCDay(); // 0=Sun,1=Mon,...,6=Sat
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(d, offset);
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const MONTHS     = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDayLabel(date) {
  return `${DAY_LABELS[date.getUTCDay() - 1]} ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

router.get('/calendar', async (req, res) => {
  const weekOffset = parseInt(String(req.query.weekOffset || '0'), 10) || 0;
  if (Math.abs(weekOffset) > 52) {
    return res.status(400).json({ error: 'weekOffset out of range (max ±52)' });
  }

  const today   = new Date();
  const monday  = addDays(getMondayOfWeek(today), weekOffset * 7);
  const friday  = addDays(monday, 4);

  const weekStart = isoDate(monday);
  const weekEnd   = isoDate(friday);

  let dbRows = null;
  try {
    const dbResult = await queryWithTimeout(
      `SELECT
         symbol,
         COALESCE(company, company_name) AS company,
         report_date::text AS report_date,
         COALESCE(report_time, time) AS report_time,
         eps_estimate,
         eps_actual,
         COALESCE(rev_estimate, revenue_estimate) AS rev_estimate,
         rev_actual,
         expected_move_percent,
         sector,
         market_cap,
         score
       FROM earnings_events
       WHERE report_date >= $1
         AND report_date <= $2
       ORDER BY market_cap DESC NULLS LAST, symbol ASC`,
      [weekStart, weekEnd],
      { label: 'earnings.calendar', timeoutMs: 5000, maxRetries: 1, retryDelayMs: 100 }
    );
    dbRows = dbResult.rows || [];
  } catch (err) {
    console.warn('[earningsCalendar] DB unavailable, using FMP fallback:', err.message);
  }

  // If DB unavailable or empty, fall through to FMP
  if (!dbRows || dbRows.length === 0) {
    try {
      const axios = require('axios');
      const key = process.env.FMP_API_KEY;
      const fmpResp = await axios.get(`https://financialmodelingprep.com/stable/earnings-calendar`, {
        params: { from: weekStart, to: weekEnd, apikey: key },
        timeout: 8000,
      });
      const fmpData = Array.isArray(fmpResp.data) ? fmpResp.data : [];
      console.log(`[earningsCalendar] FMP returned ${fmpData.length} events`);
      dbRows = fmpData.map(r => ({
        symbol: r.symbol,
        company: r.company || r.name || r.symbol,
        report_date: r.date,
        report_time: r.time || null,
        eps_estimate: r.epsEstimated != null ? Number(r.epsEstimated) : null,
        eps_actual: r.eps != null ? Number(r.eps) : null,
        rev_estimate: null,
        rev_actual: null,
        expected_move_percent: null,
        sector: null,
        market_cap: null,
        score: null,
      })).filter(r => r.symbol);
    } catch (fmpErr) {
      console.error('[earningsCalendar] FMP fallback failed:', fmpErr.message);
      dbRows = [];
    }
  }

  // Group by day
  const byDate = new Map();
  for (const row of dbRows) {
    const d = String(row.report_date || '').slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push({
      symbol:               row.symbol,
      companyName:          row.company || null,
      reportDate:           d,
      reportTime:           row.report_time || null,
      epsEstimate:          row.eps_estimate != null ? Number(row.eps_estimate) : null,
      epsActual:            row.eps_actual   != null ? Number(row.eps_actual)   : null,
      revEstimate:          row.rev_estimate != null ? Number(row.rev_estimate) : null,
      revActual:            row.rev_actual   != null ? Number(row.rev_actual)   : null,
      expectedMovePercent:  row.expected_move_percent != null ? Number(row.expected_move_percent) : null,
      sector:               row.sector || null,
      marketCap:            row.market_cap != null ? Number(row.market_cap) : null,
      score:                row.score != null ? Number(row.score) : null,
    });
  }

  // Build Mon–Fri structure
  const days = [];
  for (let i = 0; i < 5; i++) {
    const date = addDays(monday, i);
    const d    = isoDate(date);
    days.push({
      date,
      label:  formatDayLabel(date),
      events: byDate.get(d) || [],
    });
  }

  // Flat list for frontend table consumption (d.data ?? d.rows ?? d.items pattern)
  const flatData = dbRows.map(row => ({
    symbol:               row.symbol,
    company_name:         row.company || null,
    report_date:          String(row.report_date || '').slice(0, 10),
    time:                 row.report_time || null,
    eps_estimate:         row.eps_estimate != null ? Number(row.eps_estimate) : null,
    eps_actual:           row.eps_actual   != null ? Number(row.eps_actual)   : null,
    surprise:             row.eps_estimate && row.eps_actual != null
                            ? Math.round(((row.eps_actual - row.eps_estimate) / Math.abs(row.eps_estimate || 1)) * 10000) / 100
                            : null,
    expected_move_percent: row.expected_move_percent != null ? Number(row.expected_move_percent) : null,
    market_cap:            row.market_cap != null ? Number(row.market_cap) : null,
    sector:                row.sector || null,
    score:                 row.score != null ? Number(row.score) : null,
  }));

  return res.json({
    success: true,
    weekStart,
    weekEnd,
    weekOffset,
    totalEvents: dbRows.length,
    count: dbRows.length,
    data: flatData,
    rows: flatData,
    days,
  });
});

module.exports = router;
