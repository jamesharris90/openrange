'use strict';

/**
 * dashboard.js
 *
 * Routes for the Intelligence Dashboard.
 * All FMP calls use the /stable/ base URL — legacy /v3/ /v4/ are blocked.
 *
 * GET  /api/dashboard/snapshot  — parallel FMP data fetch, 60s cache
 * POST /api/dashboard/briefing  — OpenAI analyst narrative, 3min cache per phase
 */

const express = require('express');
const axios = require('axios');
const OpenAI = require('openai');

const router = express.Router();

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const FMP_KEY = process.env.FMP_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

// ── In-memory cache ──────────────────────────────────────────────────────────

const _cache = new Map();

function isCacheValid(key, ttlMs) {
  const entry = _cache.get(key);
  return Boolean(entry) && (Date.now() - entry.ts) < ttlMs;
}

function getCached(key) {
  return _cache.get(key)?.data;
}

function setCache(key, data) {
  _cache.set(key, { data, ts: Date.now() });
}

// ── FMP helpers ──────────────────────────────────────────────────────────────

async function fmpGet(path, params = {}) {
  if (!FMP_KEY) throw new Error('FMP_API_KEY not configured');
  const resp = await axios.get(`${FMP_BASE}${path}`, {
    params: { ...params, apikey: FMP_KEY },
    timeout: 10000,
    validateStatus: () => true,
  });
  if (resp.status >= 400) {
    throw new Error(`FMP ${path} returned status ${resp.status}`);
  }
  if (Array.isArray(resp.data)) return resp.data;
  if (resp.data && Array.isArray(resp.data.data)) return resp.data.data;
  return [];
}

function mapStockRow(r) {
  return {
    symbol: String(r.symbol || '').toUpperCase(),
    name: String(r.name || r.companyName || ''),
    price: Number(r.price) || 0,
    changesPercentage: Number(
      r.changesPercentage ?? r.changePercentage ?? r.change_percent ?? 0
    ),
    volume: Number(r.volume) || 0,
  };
}

function formatPct(n) {
  const num = Number(n) || 0;
  return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
}

// ── GET /api/dashboard/snapshot ──────────────────────────────────────────────

router.get('/snapshot', async (_req, res) => {
  const CACHE_TTL_MS = 60 * 1000;

  if (isCacheValid('snapshot', CACHE_TTL_MS)) {
    return res.json(getCached('snapshot'));
  }

  const today = new Date().toISOString().slice(0, 10);

  const [
    gainersResult,
    losersResult,
    activesResult,
    spyResult,
    diaResult,
    qqqResult,
    iwmResult,
    vixResult,
    sectorsResult,
    earningsResult,
    newsResult,
    fearResult,
  ] = await Promise.allSettled([
    fmpGet('/biggest-gainers'),
    fmpGet('/biggest-losers'),
    fmpGet('/most-actives'),
    fmpGet('/quote', { symbol: 'SPY' }),
    fmpGet('/quote', { symbol: 'DIA' }),
    fmpGet('/quote', { symbol: 'QQQ' }),
    fmpGet('/quote', { symbol: 'IWM' }),
    fmpGet('/quote', { symbol: 'VIX' }),
    fmpGet('/sectors-performance'),
    fmpGet('/earnings-calendar', { from: today, to: today }),
    fmpGet('/news/stock-latest', { page: 0, limit: 20 }),
    fmpGet('/fear-and-greed', { limit: 1 }),
  ]);

  // ── Indices ────────────────────────────────────────────────────────────────
  const indexDefs = [
    { result: spyResult, symbol: 'SPY', label: 'S&P 500' },
    { result: diaResult, symbol: 'DIA', label: 'Dow Jones' },
    { result: qqqResult, symbol: 'QQQ', label: 'Nasdaq' },
    { result: iwmResult, symbol: 'IWM', label: 'Russell 2K' },
    { result: vixResult, symbol: 'VIX', label: 'VIX' },
  ];
  const indices = indexDefs.map(({ result, symbol, label }) => {
    const row = result.status === 'fulfilled' ? (result.value[0] || {}) : {};
    return {
      symbol,
      label,
      price: Number(row.price) || 0,
      changesPercentage: Number(
        row.changesPercentage ?? row.changePercentage ?? row.change_percent ?? 0
      ),
    };
  });

  // ── Sectors ────────────────────────────────────────────────────────────────
  const rawSectors = sectorsResult.status === 'fulfilled' ? sectorsResult.value : [];
  const sectors = rawSectors
    .map((s) => ({
      sector: String(s.sector || s.name || ''),
      changesPercentage: Number(s.changesPercentage ?? s.change ?? 0),
    }))
    .filter((s) => s.sector)
    .sort((a, b) => b.changesPercentage - a.changesPercentage);

  // ── Fear & Greed ───────────────────────────────────────────────────────────
  const rawFear = fearResult.status === 'fulfilled' ? fearResult.value : [];
  const fearItem = Array.isArray(rawFear) ? rawFear[0] : null;
  const fear = fearItem
    ? {
        value: Number(fearItem.value ?? fearItem.score ?? 50),
        valueClassification: String(
          fearItem.valueClassification || fearItem.classification || 'Neutral'
        ),
      }
    : null;

  // ── News ───────────────────────────────────────────────────────────────────
  const rawNews = newsResult.status === 'fulfilled' ? newsResult.value : [];
  const news = rawNews.slice(0, 12).map((n) => ({
    symbol: String(n.symbol || ''),
    title: String(n.title || n.headline || ''),
    url: String(n.url || ''),
    site: String(n.site || n.publisher || ''),
    publishedDate: String(n.publishedDate || n.published_at || ''),
  }));

  // ── Earnings ───────────────────────────────────────────────────────────────
  const rawEarnings = earningsResult.status === 'fulfilled' ? earningsResult.value : [];
  const earnings = rawEarnings.slice(0, 30).map((e) => ({
    symbol: String(e.symbol || ''),
    time: String(e.time || 'TBC'),
    epsEstimated: e.epsEstimated ?? null,
    revenueEstimated: e.revenueEstimated ?? null,
  }));

  // ── Gainers / Losers / Active ──────────────────────────────────────────────
  const gainers =
    gainersResult.status === 'fulfilled'
      ? gainersResult.value.slice(0, 10).map(mapStockRow)
      : [];
  const losers =
    losersResult.status === 'fulfilled'
      ? losersResult.value.slice(0, 8).map(mapStockRow)
      : [];
  const active =
    activesResult.status === 'fulfilled'
      ? activesResult.value.slice(0, 10).map(mapStockRow)
      : [];

  const snapshot = {
    gainers,
    losers,
    active,
    indices,
    sectors,
    earnings,
    news,
    fear,
    timestamp: new Date().toISOString(),
  };

  setCache('snapshot', snapshot);
  return res.json(snapshot);
});

// ── POST /api/dashboard/briefing ─────────────────────────────────────────────

function getOpenAIClient() {
  if (!OPENAI_KEY) return null;
  return new OpenAI({ apiKey: OPENAI_KEY });
}

function buildPrompt(session, snapshot, conditions) {
  const sp = (snapshot?.indices || []).find((i) => i.symbol === 'SPY');
  const vix = (snapshot?.indices || []).find((i) => i.symbol === 'VIX');

  const fearText = snapshot?.fear
    ? `${snapshot.fear.value} (${snapshot.fear.valueClassification})`
    : 'N/A';

  const indicesText = (snapshot?.indices || [])
    .map((i) => `${i.label}: $${Number(i.price).toFixed(2)} (${formatPct(i.changesPercentage)})`)
    .join(' | ');

  const sectorsText = (snapshot?.sectors || [])
    .slice(0, 8)
    .map((s) => `${s.sector}: ${formatPct(s.changesPercentage)}`)
    .join(' | ');

  const gainersText = (snapshot?.gainers || [])
    .slice(0, 6)
    .map(
      (g) =>
        `${g.symbol} ${formatPct(g.changesPercentage)} vol:${(Number(g.volume) / 1e6).toFixed(1)}M @$${Number(g.price).toFixed(2)}`
    )
    .join(', ');

  const losersText = (snapshot?.losers || [])
    .slice(0, 4)
    .map((l) => `${l.symbol} ${formatPct(l.changesPercentage)}`)
    .join(', ');

  const activesText = (snapshot?.active || [])
    .slice(0, 6)
    .map(
      (a) =>
        `${a.symbol} vol:${(Number(a.volume) / 1e6).toFixed(1)}M ${formatPct(a.changesPercentage)}`
    )
    .join(', ');

  const allEarnings = snapshot?.earnings || [];
  const earningsBMO = allEarnings
    .filter(
      (e) =>
        e.time?.toUpperCase().includes('BMO') || e.time?.toLowerCase().includes('pre')
    )
    .map((e) => e.symbol)
    .join(', ') || 'None';
  const earningsAMC = allEarnings
    .filter(
      (e) =>
        e.time?.toUpperCase().includes('AMC') || e.time?.toLowerCase().includes('after')
    )
    .map((e) => e.symbol)
    .join(', ') || 'None';

  const newsText = (snapshot?.news || [])
    .slice(0, 8)
    .map((n) => `[${n.symbol || 'MKT'}] ${n.title}`)
    .join('\n');

  const conditionsText = Array.isArray(conditions) ? conditions.join(', ') : '';
  const orbLine = session?.orbWindow ? '\n⚡ OPENING RANGE WINDOW IS LIVE' : '';
  const ukLine = session?.ukWindow ? '\n🇬🇧 UK PRIME TRADING WINDOW ACTIVE (2:30-4:00 PM)' : '';

  return `You are the market intelligence engine for OpenRange Terminal, a US equity trading platform. Your job is to produce a structured market briefing in JSON format.

IMPORTANT: You do NOT prescribe strategies. You describe CONDITIONS and let the trader decide. The user trades multiple approaches — ORB, VWAP reversion, mean reversion, swing trades, momentum, gap plays, sector rotation — the data determines what is favourable, not you.

CURRENT SESSION: ${session?.label || String(session?.phase || 'unknown').toUpperCase()} (Phase: ${session?.phase || 'unknown'})
ET: ${session?.et || 'N/A'} | UK: ${session?.uk || 'N/A'} | ${session?.date || ''}
Next event: ${session?.nextEvent || 'N/A'} in ${session?.countdown || 'N/A'}${orbLine}${ukLine}

━━ LIVE DATA ━━
INDICES: ${indicesText}
VIX: ${vix ? `$${Number(vix.price).toFixed(2)} (${formatPct(vix.changesPercentage)})` : 'N/A'}
FEAR & GREED: ${fearText}
SECTORS: ${sectorsText}
TOP GAINERS: ${gainersText}
TOP LOSERS: ${losersText}
MOST ACTIVE: ${activesText}
EARNINGS TODAY: ${allEarnings.length} total | Before Open: ${earningsBMO} | After Close: ${earningsAMC}

━━ SYSTEM CONDITIONS DETECTED ━━
${conditionsText}

━━ HEADLINES ━━
${newsText}

Respond with ONLY valid JSON (no markdown fences, no preamble) using this exact structure:

{
  "sections": [
    {
      "title": "SECTION_TITLE",
      "bullets": ["bullet 1", "bullet 2", ...]
    }
  ]
}

Generate EXACTLY these 6 sections in this order. Each bullet is a single standalone insight in clear, accessible language with specific numbers, tickers, prices.

1. LAST TRADING SESSION (4-5 bullets) — Price action, range, open vs close, volume, key intraday moves, moving average context.
2. LATEST NEWS (4-5 bullets) — Most important stories driving the market. Connect headlines to specific tickers and sectors.
3. WEEKLY TRENDS (3-4 bullets) — Zoom out: what has the market done over the past week? Trend forming or breaking? Key weekly levels?
4. RISK ASSESSMENT (3-4 bullets) — VIX level and direction, Fear & Greed, volatility regime, position sizing implications. Specific numbers.
5. CONDITIONS & SETUPS (4-5 bullets) — What is the environment telling you? What types of setups do these conditions historically favour? Tie to specific tickers. DO NOT tell the trader what to buy or sell.
6. SUMMARY (3-4 bullets) — Overall market character. Key levels to watch. What the next 1-4 hours could bring. Overall risk posture (risk-on, risk-off, mixed/neutral).

TOTAL: Under 500 words. Each bullet 1-2 sentences max. Plain English.`;
}

router.post('/briefing', async (req, res) => {
  const { session, snapshot, conditions } = req.body || {};
  const phase = String(session?.phase || 'unknown');
  const cacheKey = `briefing_${phase}`;

  if (isCacheValid(cacheKey, 3 * 60 * 1000)) {
    return res.json(getCached(cacheKey));
  }

  const client = getOpenAIClient();

  if (!client) {
    const fallback = {
      sections: [],
      fallback: true,
      message: 'AI narrative engine requires OpenAI API key. All market data is live below.',
      generatedAt: new Date().toISOString(),
    };
    return res.json(fallback);
  }

  try {
    const prompt = buildPrompt(session, snapshot, conditions);

    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1200,
      temperature: 0.65,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = completion.choices[0]?.message?.content || '';
    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(clean);

    if (!parsed.sections || !Array.isArray(parsed.sections)) {
      throw new Error('Invalid narrative structure from OpenAI');
    }

    const result = {
      sections: parsed.sections,
      generatedAt: new Date().toISOString(),
    };

    setCache(cacheKey, result);
    return res.json(result);
  } catch (err) {
    console.error('[DASHBOARD_BRIEFING] error:', err.message);
    const fallback = {
      sections: [],
      fallback: true,
      message: `AI narrative generation failed. All market data is live below.`,
      generatedAt: new Date().toISOString(),
    };
    return res.json(fallback);
  }
});

module.exports = router;
