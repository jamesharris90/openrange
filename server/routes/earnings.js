const express = require('express');
const market = require('../services/marketDataService');
const { pool } = require('../db/pg');
const router = express.Router();

/**
 * Batch-fetch FMP /stable/quote for up to 200 symbols at a time.
 * Returns a Map keyed by uppercase symbol.
 */
/**
 * Compute beatsInLast4 for a list of symbols using historical earnings_events data.
 * Returns a Map<symbol, beatsInLast4_count>.
 */
async function fetchBeatsInLast4(symbols, beforeDate) {
  if (!symbols.length) return new Map();
  try {
    const result = await pool.query(
      `SELECT symbol, COUNT(*)::int FILTER (WHERE eps_actual > eps_estimate) AS beats
       FROM (
         SELECT symbol, eps_actual, eps_estimate,
                ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY report_date DESC) AS rn
         FROM earnings_events
         WHERE symbol = ANY($1)
           AND report_date < $2
           AND eps_actual IS NOT NULL
           AND eps_estimate IS NOT NULL
       ) t
       WHERE rn <= 4
       GROUP BY symbol`,
      [symbols, beforeDate],
    );
    const map = new Map();
    for (const row of result.rows) map.set(row.symbol, row.beats);
    return map;
  } catch {
    return new Map();
  }
}

router.get('/api/earnings', async (req, res) => {
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  const from = req.query.from;
  const to = req.query.to;
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 25, 100));

  try {
    const where = [];
    const params = [];

    if (symbol) {
      params.push(symbol);
      where.push(`symbol = $${params.length}`);
    }
    if (from) {
      params.push(from);
      where.push(`report_date >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      where.push(`report_date <= $${params.length}`);
    }

    params.push(limit);

    const query = `
      SELECT symbol,
             report_date::text AS date,
             report_time AS time,
             eps_estimate AS "epsEstimate",
             eps_actual AS "epsActual",
             rev_estimate AS "revenueEstimate",
             rev_actual AS "revenueActual"
      FROM earnings_events
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY report_date ASC, symbol ASC
      LIMIT $${params.length}`;

    const { rows } = await pool.query(query, params);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch earnings', detail: err.message });
  }
});

router.get('/api/earnings/calendar', async (req, res) => {
  const from = req.query.from;
  const to = req.query.to;

  try {
    // ── DB-first: query earnings_events populated by FMP ingestion ──
    const dbResult = await pool.query(
      `SELECT
         symbol,
         report_date::text  AS date,
         report_time,
         eps_estimate,
         eps_actual,
         eps_surprise_pct,
         rev_estimate,
         rev_actual,
         market_cap,
         float              AS float_shares,
         sector,
         industry
       FROM earnings_events
       WHERE report_date BETWEEN $1 AND $2
       ORDER BY report_date ASC, symbol ASC`,
      [from, to],
    );

    if (dbResult.rows.length > 0) {
      const symbols = [...new Set(dbResult.rows.map((r) => r.symbol))];
      const beatsMap = await fetchBeatsInLast4(symbols, from);

      const earnings = dbResult.rows.map((row) => {
        return {
          symbol:              row.symbol,
          date:                row.date,
          hour:                row.report_time || null,
          companyName:         null,
          epsEstimate:         row.eps_estimate  != null ? Number(row.eps_estimate)  : null,
          epsActual:           row.eps_actual    != null ? Number(row.eps_actual)    : null,
          surprisePercent:     row.eps_surprise_pct != null ? Number(row.eps_surprise_pct) : null,
          revenueEstimate:     row.rev_estimate  != null ? Number(row.rev_estimate)  : null,
          revenueActual:       row.rev_actual    != null ? Number(row.rev_actual)    : null,
          marketCap:           row.market_cap != null ? Number(row.market_cap) : null,
          price:               null,
          change:              null,
          changePercent:       null,
          avgVolume:           null,
          volume:              null,
          rvol:                null,
          floatShares:         row.float_shares != null ? Number(row.float_shares) : null,
          sharesShort:         null,
          shortPercentOfFloat: null,
          preMarketPrice:      null,
          preMarketChange:     null,
          preMarketChangePercent: null,
          fiftyTwoWeekHigh:    null,
          twoHundredDayAverage: null,
          dist200MA:           null,
          dist52WH:            null,
          analystRating:       null,
          sector:              row.sector || null,
          industry:            row.industry || null,
          beatsInLast4:        beatsMap.get(row.symbol) ?? null,
        };
      });

      return res.json({ earnings, from: from || null, to: to || null });
    }
    return res.json({ earnings: [], from: from || null, to: to || null });
  } catch (err) {
    res.json({ earnings: [], from: from || null, to: to || null, error: 'Failed to fetch earnings calendar', detail: err.message });
  }
});

router.get('/api/earnings-research/:ticker', async (req, res) => {
  const ticker = (req.params.ticker || '').trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9.^-]{1,10}$/.test(ticker)) {
    return res.status(400).json({ error: 'Invalid ticker symbol' });
  }
  try {
    const data = await market.getEarningsResearch(ticker);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch earnings research data', detail: err.message });
  }
});

module.exports = router;
