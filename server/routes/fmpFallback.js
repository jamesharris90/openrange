'use strict';

/**
 * fmpFallback.js
 *
 * FMP-direct endpoints that bypass the DB entirely.
 * Used when the DB pool is exhausted or tables are empty.
 * All data comes from live FMP stable API calls.
 *
 * Mounted at /api in index.js.
 */

const express = require('express');
const axios = require('axios');
const { queryWithTimeout } = require('../db/pg');

const router = express.Router();

const FMP_KEY = process.env.FMP_API_KEY;
const FMP_BASE = 'https://financialmodelingprep.com/stable';
const DEFAULT_TIMEOUT = 8000;

// In-memory cache to avoid hammering FMP on every request
const _cache = new Map();

function cached(key, ttlMs, fn) {
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return Promise.resolve(hit.data);
  return fn().then((data) => {
    _cache.set(key, { data, ts: Date.now() });
    return data;
  });
}

async function fmp(path, params = {}) {
  if (!FMP_KEY) throw new Error('FMP_API_KEY not configured');
  const url = `${FMP_BASE}${path}`;
  const response = await axios.get(url, {
    params: { ...params, apikey: FMP_KEY },
    timeout: DEFAULT_TIMEOUT,
    validateStatus: () => true,
  });
  if (response.status >= 400) throw new Error(`FMP ${path} returned ${response.status}`);
  return Array.isArray(response.data) ? response.data : (response.data?.data || []);
}

// ─── Quote batch helper ─────────────────────────────────────────────────────

async function fetchFmpQuotes(symbols = []) {
  const uniq = [...new Set(symbols.filter(Boolean).map((s) => s.toUpperCase()))].slice(0, 50);
  if (uniq.length === 0) return [];

  // FMP stable quote endpoint uses symbol= param (not symbols=)
  const results = await Promise.allSettled(
    uniq.map((sym) =>
      cached(`fmp_quote_${sym}`, 30000, () =>
        fmp('/quote', { symbol: sym }).then((rows) => rows[0] || null)
      )
    )
  );

  return results
    .map((r) => (r.status === 'fulfilled' ? r.value : null))
    .filter(Boolean)
    .map((q) => ({
      symbol: String(q.symbol || '').toUpperCase(),
      price: Number(q.price) || 0,
      change_percent: Number(q.changePercentage || q.changesPercentage || q.change_percent) || 0,
      volume: Number(q.volume) || 0,
      avg_volume_30d: Number(q.avgVolume) || 0,
      relative_volume: q.avgVolume > 0 ? Math.round((Number(q.volume) / Number(q.avgVolume)) * 100) / 100 : 1,
      market_cap: Number(q.marketCap) || 0,
      sector: q.sector || null,
      updated_at: new Date().toISOString(),
      source: 'fmp_direct',
    }));
}

// ─── Write-through: persist FMP quotes to market_quotes table ────────────────

async function writeQuotesToDb(quotes) {
  if (!quotes || quotes.length === 0) return;
  try {
    const payload = quotes.map((q) => ({
      symbol: q.symbol,
      price: String(Number(q.price).toFixed(4)),
      change_percent: String(Number(q.change_percent).toFixed(4)),
      volume: String(Math.round(Number(q.volume) || 0)),
      market_cap: String(Math.round(Number(q.market_cap) || 0)),
      sector: q.sector || null,
    }));

    await queryWithTimeout(
      `INSERT INTO market_quotes (symbol, price, change_percent, volume, market_cap, sector, updated_at)
       SELECT r.symbol, r.price::numeric, r.change_percent::numeric,
              r.volume::bigint, r.market_cap::bigint, r.sector, NOW()
       FROM json_to_recordset($1::json) AS r(
         symbol text, price text, change_percent text,
         volume text, market_cap text, sector text
       )
       WHERE r.symbol IS NOT NULL AND r.symbol <> ''
       ON CONFLICT (symbol) DO UPDATE SET
         price          = EXCLUDED.price,
         change_percent = EXCLUDED.change_percent,
         volume         = EXCLUDED.volume,
         market_cap     = EXCLUDED.market_cap,
         sector         = COALESCE(EXCLUDED.sector, market_quotes.sector),
         updated_at     = NOW()`,
      [JSON.stringify(payload)],
      { timeoutMs: 8000, label: 'fmp_fallback.write_market_quotes', maxRetries: 0 }
    );
  } catch (err) {
    // Fire-and-forget: log only, never throw
    console.warn('[FMP_FALLBACK] market_quotes write failed', err.message);
  }
}

// ─── /api/fmp/quotes ────────────────────────────────────────────────────────
// GET /api/fmp/quotes?symbols=AAPL,TSLA,SPY
router.get('/fmp/quotes', async (req, res) => {
  const raw = String(req.query.symbols || '').trim();
  const symbols = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  try {
    const data = await fetchFmpQuotes(symbols);
    // Write to DB in background — keeps market_quotes table fresh
    writeQuotesToDb(data).catch(() => {});
    return res.json({ success: true, count: data.length, data, source: 'fmp_direct' });
  } catch (err) {
    return res.json({ success: false, count: 0, data: [], error: err.message });
  }
});

// ─── /api/fmp/screener ──────────────────────────────────────────────────────
// GET /api/fmp/screener?tab=gainers|losers|active|news
// Returns a ranked universe directly from FMP market screener
router.get('/fmp/screener', async (req, res) => {
  const tab = String(req.query.tab || 'active').toLowerCase();
  const limit = Math.min(Number(req.query.pageSize) || 50, 200);

  try {
    let rows = [];

    if (tab === 'gainers') {
      rows = await cached('fmp_gainers', 60000, () => fmp('/biggest-gainers'));
    } else if (tab === 'losers') {
      rows = await cached('fmp_losers', 60000, () => fmp('/biggest-losers'));
    } else {
      rows = await cached('fmp_actives', 60000, () => fmp('/most-actives'));
    }

    const mapped = rows.slice(0, limit).map((r, i) => ({
      symbol: String(r.symbol || r.ticker || '').toUpperCase(),
      price: Number(r.price) || 0,
      change_percent: Number(r.changesPercentage || r.changePercentage || r.change_percent) || 0,
      volume: Number(r.volume) || 0,
      avg_volume_30d: Number(r.avgVolume) || 0,
      relative_volume: r.avgVolume > 0 ? Math.round((Number(r.volume) / Number(r.avgVolume)) * 100) / 100 : 1,
      market_cap: Number(r.marketCap) || 0,
      sector: r.sector || 'Unknown',
      catalyst_type: tab === 'gainers' ? 'BREAKOUT' : tab === 'losers' ? 'BREAKDOWN' : 'HIGH_VOLUME',
      score: Math.max(0, 100 - i * 2),
      stage: 'ACTIVE',
      source: 'fmp_direct',
    })).filter((r) => r.symbol);

    // Write to DB in background
    writeQuotesToDb(mapped).catch(() => {});
    return res.json({
      success: true,
      count: mapped.length,
      rows: mapped,
      data: mapped,
      market_mode: 'RECENT',
      source: 'fmp_direct',
    });
  } catch (err) {
    return res.json({ success: false, count: 0, rows: [], data: [], error: err.message });
  }
});

// ─── /api/fmp/news ──────────────────────────────────────────────────────────
// GET /api/fmp/news?symbol=AAPL&limit=50
router.get('/fmp/news', async (req, res) => {
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  const limit = Math.min(Number(req.query.limit) || 30, 200);

  try {
    let rows;
    if (symbol) {
      rows = await cached(`fmp_news_${symbol}`, 120000, () =>
        fmp('/news/stock', { symbol, limit: String(limit) })
      );
    } else {
      rows = await cached('fmp_news_general', 120000, () =>
        fmp('/fmp-articles', { limit: String(limit) })
      );
    }

    const mapped = rows.slice(0, limit).map((r) => ({
      id: r.id || r.url || r.link,
      symbol: symbol || (Array.isArray(r.tickers) ? r.tickers[0] : r.tickers) || null,
      headline: r.title || r.headline,
      summary: r.text || r.summary || r.content || null,
      source: r.site || r.source || r.author,
      publisher: r.site || r.source || r.author,
      url: r.url || r.link,
      published_at: r.publishedDate || r.publishedAt || r.date,
      sentiment: r.sentiment || null,
      catalyst_type: 'NEWS',
      sector: null,
      source_type: 'fmp_direct',
    }));

    return res.json({ ok: true, items: mapped, count: mapped.length });
  } catch (err) {
    return res.json({ ok: false, items: [], error: err.message });
  }
});

// ─── /api/fmp/earnings ──────────────────────────────────────────────────────
// GET /api/fmp/earnings?from=2026-03-31&to=2026-04-04
router.get('/fmp/earnings', async (req, res) => {
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  if (!from || !to) {
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - today.getDay() + 1);
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    req.query.from = monday.toISOString().slice(0, 10);
    req.query.to = friday.toISOString().slice(0, 10);
  }

  const fromDate = String(req.query.from);
  const toDate = String(req.query.to);

  try {
    const cacheKey = `fmp_earnings_${fromDate}_${toDate}`;
    const rows = await cached(cacheKey, 300000, () =>
      fmp('/earnings-calendar', { from: fromDate, to: toDate })
    );

    const mapped = rows.map((r) => ({
      symbol: String(r.symbol || '').toUpperCase(),
      company_name: r.company || r.name || r.symbol,
      report_date: r.date,
      time: r.time || 'TBD',
      eps_estimate: r.epsEstimated != null ? Number(r.epsEstimated) : null,
      eps_actual: r.eps != null ? Number(r.eps) : null,
      surprise: r.epsEstimated && r.eps != null
        ? Math.round(((r.eps - r.epsEstimated) / Math.abs(r.epsEstimated || 1)) * 10000) / 100
        : null,
      expected_move_percent: null,
      market_cap: null,
      sector: null,
      score: null,
    })).filter((r) => r.symbol);

    return res.json({ success: true, count: mapped.length, data: mapped, source: 'fmp_direct' });
  } catch (err) {
    return res.json({ success: false, count: 0, data: [], error: err.message });
  }
});

// ─── /api/fmp/movers ────────────────────────────────────────────────────────
// GET /api/fmp/movers — returns top movers as opportunity candidates
// Used by markets page and top-opportunities fallback
router.get('/fmp/movers', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  try {
    const [gainers, actives] = await Promise.all([
      cached('fmp_gainers', 60000, () => fmp('/biggest-gainers')),
      cached('fmp_actives', 60000, () => fmp('/most-actives')),
    ]);

    // Merge and rank
    const seen = new Set();
    const all = [...gainers, ...actives].filter((r) => {
      const sym = String(r.symbol || '').toUpperCase();
      if (!sym || seen.has(sym)) return false;
      seen.add(sym);
      return true;
    });

    const mapped = all.slice(0, limit).map((r, i) => ({
      symbol: String(r.symbol || '').toUpperCase(),
      price: Number(r.price) || 0,
      change_percent: Number(r.changesPercentage || r.changePercentage) || 0,
      volume: Number(r.volume) || 0,
      relative_volume: r.avgVolume > 0 ? Number(r.volume) / Number(r.avgVolume) : 1,
      confidence: Math.max(30, 90 - i * 3),
      expected_move_percent: Math.abs(Number(r.changesPercentage || r.changePercentage)) || 0,
      why_moving: `${r.name || r.symbol} ${Number(r.changesPercentage) > 0 ? 'up' : 'down'} ${Math.abs(Number(r.changesPercentage || 0)).toFixed(1)}% on elevated volume`,
      how_to_trade: 'Monitor for continuation past premarket range. Wait for open-range break confirmation.',
      why: `${r.name || r.symbol} ${Number(r.changesPercentage) > 0 ? 'up' : 'down'} ${Math.abs(Number(r.changesPercentage || 0)).toFixed(1)}% on elevated volume`,
      how: 'Monitor for continuation past premarket range. Wait for open-range break confirmation.',
      source: 'fmp_direct',
      updated_at: new Date().toISOString(),
    }));

    return res.json({ success: true, count: mapped.length, data: mapped, source: 'fmp_direct' });
  } catch (err) {
    return res.json({ success: false, count: 0, data: [], error: err.message });
  }
});

// ─── /api/fmp/research/:symbol ──────────────────────────────────────────────
// GET /api/fmp/research/AAPL — full symbol data object from FMP
router.get('/fmp/research/:symbol', async (req, res) => {
  const symbol = String(req.params.symbol || '').toUpperCase().trim();
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  try {
    const [quote, profile, newsItems] = await Promise.allSettled([
      cached(`fmp_quote_${symbol}`, 30000, () => fmp('/quote', { symbol }).then((r) => r[0] || null)),
      cached(`fmp_profile_${symbol}`, 300000, () => fmp('/profile', { symbol }).then((r) => r[0] || null)),
      cached(`fmp_news_${symbol}`, 120000, () => fmp('/news/stock', { symbol, limit: '8' })),
    ]);

    const q = quote.status === 'fulfilled' ? quote.value : null;
    const p = profile.status === 'fulfilled' ? profile.value : null;
    const news = newsItems.status === 'fulfilled' ? newsItems.value : [];

    if (!q && !p) return res.json({ success: false, error: 'No FMP data for symbol' });

    const chg = Number(q?.changePercentage || q?.changesPercentage || 0);
    const price = Number(q?.price || 0);

    const data = {
      symbol,
      company_name: p?.companyName || q?.name || symbol,
      sector: p?.sector || q?.sector || null,
      industry: p?.industry || null,
      price,
      change_percent: chg,
      volume: Number(q?.volume) || 0,
      avg_volume_30d: Number(q?.avgVolume) || 0,
      relative_volume: q?.avgVolume > 0 ? Math.round((Number(q?.volume) / Number(q?.avgVolume)) * 100) / 100 : 1,
      market_cap: Number(q?.marketCap || p?.mktCap) || 0,
      description: p?.description || null,
      news: news.slice(0, 5).map((n) => ({
        headline: n.title,
        source: n.site,
        url: n.url,
        published_at: n.publishedDate,
      })),
      source: 'fmp_direct',
      updated_at: new Date().toISOString(),
    };

    return res.json({ success: true, data });
  } catch (err) {
    return res.json({ success: false, error: err.message });
  }
});

// ─── /api/data-flow-status ──────────────────────────────────────────────────
// Public endpoint — no auth required
router.get('/data-flow-status', (req, res) => {
  const fmpOk = Boolean(FMP_KEY);
  return res.json({
    ok: fmpOk,
    fmp_configured: fmpOk,
    cache_entries: _cache.size,
    status: fmpOk ? 'FMP_DIRECT_AVAILABLE' : 'NO_DATA_SOURCES',
    endpoints: {
      quotes: '/api/fmp/quotes',
      screener: '/api/fmp/screener',
      news: '/api/fmp/news',
      earnings: '/api/fmp/earnings',
      movers: '/api/fmp/movers',
      research: '/api/fmp/research/:symbol',
    },
    ts: new Date().toISOString(),
  });
});

module.exports = router;
module.exports.fetchFmpQuotes = fetchFmpQuotes;
