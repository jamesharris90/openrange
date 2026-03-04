const express = require('express');
const axios = require('axios');
const market = require('../services/marketDataService');
const { pool } = require('../db/pg');
const router = express.Router();

const FMP_STABLE = 'https://financialmodelingprep.com/stable';

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

async function fetchFmpQuoteMap(symbols) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey || !symbols.length) return new Map();

  const map = new Map();
  const chunks = [];
  for (let i = 0; i < symbols.length; i += 200) chunks.push(symbols.slice(i, i + 200));

  await Promise.allSettled(
    chunks.map(async (chunk) => {
      try {
        const res = await axios.get(`${FMP_STABLE}/quote`, {
          params: { symbol: chunk.join(','), apikey: apiKey },
          timeout: 15000,
          validateStatus: () => true,
        });
        const rows = Array.isArray(res.data) ? res.data : [];
        for (const q of rows) {
          const sym = String(q?.symbol || '').toUpperCase();
          if (sym) map.set(sym, q);
        }
      } catch (_err) { /* ignore */ }
    })
  );

  return map;
}

router.get('/api/earnings', async (req, res) => {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'FMP_API_KEY missing' });

  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  const from = req.query.from;
  const to = req.query.to;
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 25, 100));

  try {
    const response = await axios.get('https://financialmodelingprep.com/stable/earnings-calendar', {
      params: {
        symbol: symbol || undefined,
        from: from || undefined,
        to: to || undefined,
        limit,
        apikey: apiKey,
      },
      timeout: 30000,
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) {
      return res.status(502).json({ error: 'Failed to fetch earnings', detail: `status ${response.status}` });
    }

    const rows = Array.isArray(response.data) ? response.data : [];
    return res.json(rows.map((item) => ({
      symbol: String(item?.symbol || '').toUpperCase(),
      date: item?.date || item?.reportDate || null,
      time: item?.time || null,
      epsEstimate: item?.epsEstimated ?? item?.epsEstimate ?? null,
      epsActual: item?.eps ?? item?.epsActual ?? null,
      revenueEstimate: item?.revenueEstimated ?? item?.revenueEstimate ?? null,
      revenueActual: item?.revenue ?? item?.revenueActual ?? null,
    })));
  } catch (err) {
    return res.status(502).json({ error: 'Failed to fetch earnings', detail: err.message });
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
      const [quoteMap, beatsMap] = await Promise.all([
        fetchFmpQuoteMap(symbols),
        fetchBeatsInLast4(symbols, from),
      ]);

      const earnings = dbResult.rows.map((row) => {
        const q = quoteMap.get(row.symbol) || {};
        const price = Number.isFinite(Number(q.price)) ? Number(q.price) : null;
        const avg200 = Number.isFinite(Number(q.priceAvg200)) ? Number(q.priceAvg200) : null;
        const high52 = Number.isFinite(Number(q.yearHigh)) ? Number(q.yearHigh) : null;
        const avgVol = Number.isFinite(Number(q.avgVolume)) ? Number(q.avgVolume) : null;
        const curVol = Number.isFinite(Number(q.volume)) ? Number(q.volume) : null;

        return {
          symbol:              row.symbol,
          date:                row.date,
          hour:                row.report_time || null,
          companyName:         String(q.name || '').trim() || null,
          epsEstimate:         row.eps_estimate  != null ? Number(row.eps_estimate)  : null,
          epsActual:           row.eps_actual    != null ? Number(row.eps_actual)    : null,
          surprisePercent:     row.eps_surprise_pct != null ? Number(row.eps_surprise_pct) : null,
          revenueEstimate:     row.rev_estimate  != null ? Number(row.rev_estimate)  : null,
          revenueActual:       row.rev_actual    != null ? Number(row.rev_actual)    : null,
          marketCap:           Number.isFinite(Number(q.marketCap)) ? Number(q.marketCap)
                               : (row.market_cap != null ? Number(row.market_cap) : null),
          price,
          change:              Number.isFinite(Number(q.change)) ? Number(q.change) : null,
          changePercent:       Number.isFinite(Number(q.changesPercentage)) ? Number(q.changesPercentage) : null,
          avgVolume:           avgVol,
          volume:              curVol,
          rvol:                avgVol && curVol && avgVol > 0 ? +(curVol / avgVol).toFixed(2) : null,
          floatShares:         row.float_shares != null ? Number(row.float_shares) : null,
          sharesShort:         null,
          shortPercentOfFloat: null,
          preMarketPrice:      null,
          preMarketChange:     null,
          preMarketChangePercent: null,
          fiftyTwoWeekHigh:    high52,
          twoHundredDayAverage: avg200,
          dist200MA:           avg200 && price ? +(((price - avg200) / avg200) * 100).toFixed(2) : null,
          dist52WH:            high52 && price ? +(((price - high52) / high52) * 100).toFixed(2) : null,
          analystRating:       null,
          sector:              row.sector || null,
          industry:            row.industry || null,
          beatsInLast4:        beatsMap.get(row.symbol) ?? null,
        };
      });

      return res.json({ earnings, from: from || null, to: to || null });
    }

    // ── Fallback: FMP /stable/earnings-calendar ──
    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) {
      return res.json({ earnings: [], from: from || null, to: to || null, error: 'FMP_API_KEY missing' });
    }
    const fmpRes = await axios.get(`${FMP_STABLE}/earnings-calendar`, {
      params: { from, to, apikey: apiKey },
      timeout: 15000,
      validateStatus: () => true,
    });
    if (fmpRes.status < 200 || fmpRes.status >= 300) {
      return res.json({ earnings: [], from: from || null, to: to || null, error: `FMP returned ${fmpRes.status}` });
    }
    const fmpRows = Array.isArray(fmpRes.data) ? fmpRes.data : [];
    const fmpSymbols = [...new Set(fmpRows.map((r) => r.symbol).filter(Boolean))];
    const [fmpQuoteMap, fmpBeatsMap] = fmpSymbols.length
      ? await Promise.all([fetchFmpQuoteMap(fmpSymbols), fetchBeatsInLast4(fmpSymbols, from)])
      : [new Map(), new Map()];
    const earnings = fmpRows.map((item) => {
      const q = fmpQuoteMap.get(String(item.symbol || '').toUpperCase()) || {};
      const price  = Number.isFinite(Number(q.price))      ? Number(q.price)      : null;
      const avg200 = Number.isFinite(Number(q.priceAvg200)) ? Number(q.priceAvg200) : null;
      const high52 = Number.isFinite(Number(q.yearHigh))   ? Number(q.yearHigh)   : null;
      const avgVol = Number.isFinite(Number(q.avgVolume))  ? Number(q.avgVolume)  : null;
      const curVol = Number.isFinite(Number(q.volume))     ? Number(q.volume)     : null;
      return {
        symbol:              String(item.symbol || '').toUpperCase(),
        date:                item.date || null,
        hour:                item.time || null,
        companyName:         String(q.name || item.name || '').trim() || null,
        epsEstimate:         item.epsEstimated   != null ? Number(item.epsEstimated)   : null,
        epsActual:           item.eps            != null ? Number(item.eps)            : null,
        surprisePercent:     item.surprisePercent != null ? Number(item.surprisePercent) : null,
        revenueEstimate:     item.revenueEstimated != null ? Number(item.revenueEstimated) : null,
        revenueActual:       item.revenue        != null ? Number(item.revenue)        : null,
        marketCap:           Number.isFinite(Number(q.marketCap)) ? Number(q.marketCap) : null,
        price,
        change:              Number.isFinite(Number(q.change)) ? Number(q.change) : null,
        changePercent:       Number.isFinite(Number(q.changesPercentage)) ? Number(q.changesPercentage) : null,
        avgVolume:           avgVol,
        volume:              curVol,
        rvol:                avgVol && curVol && avgVol > 0 ? +(curVol / avgVol).toFixed(2) : null,
        floatShares:         null,
        sharesShort:         null,
        shortPercentOfFloat: null,
        preMarketPrice:      null,
        preMarketChange:     null,
        preMarketChangePercent: null,
        fiftyTwoWeekHigh:    high52,
        twoHundredDayAverage: avg200,
        dist200MA:           avg200 && price ? +(((price - avg200) / avg200) * 100).toFixed(2) : null,
        dist52WH:            high52 && price ? +(((price - high52) / high52) * 100).toFixed(2) : null,
        analystRating:       null,
        sector:              null,
        industry:            null,
        beatsInLast4:        fmpBeatsMap.get(String(item.symbol || '').toUpperCase()) ?? null,
      };
    });
    return res.json({ earnings, from: from || null, to: to || null });
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
