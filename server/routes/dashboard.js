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
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

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
    fmpGet('/quote', { symbol: '^VIX' }),
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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

function parseNarrativeResponse(content) {
  const text = String(content || '').trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (_error) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch (_innerError) {
        return null;
      }
    }
  }

  return null;
}

function fmtPrice(value) {
  const num = Number(value);
  return Number.isFinite(num) ? `$${num.toFixed(2)}` : 'N/A';
}

function getIndex(snapshot, symbol) {
  return (snapshot?.indices || []).find((item) => item.symbol === symbol) || null;
}

function buildRuleBasedBriefing(session, snapshot, conditions) {
  const spy = getIndex(snapshot, 'SPY');
  const qqq = getIndex(snapshot, 'QQQ');
  const iwm = getIndex(snapshot, 'IWM');
  const vix = getIndex(snapshot, 'VIX');
  const fear = snapshot?.fear || null;
  const gainers = (snapshot?.gainers || []).slice(0, 3);
  const losers = (snapshot?.losers || []).slice(0, 3);
  const actives = (snapshot?.active || []).slice(0, 3);
  const earnings = (snapshot?.earnings || []).slice(0, 6);
  const sectors = (snapshot?.sectors || []).slice(0, 3);
  const headlines = (snapshot?.news || []).slice(0, 4);
  const conditionsList = Array.isArray(conditions) ? conditions.filter(Boolean) : [];

  const sections = [
    {
      title: 'LAST TRADING SESSION',
      bullets: [
        `SPY is at ${fmtPrice(spy?.price)} with ${formatPct(spy?.changesPercentage)}, while QQQ is at ${fmtPrice(qqq?.price)} with ${formatPct(qqq?.changesPercentage)}.`,
        `Russell 2000 is at ${fmtPrice(iwm?.price)} with ${formatPct(iwm?.changesPercentage)}, which keeps small caps in the active intraday conversation.`,
        actives.length > 0
          ? `Most active names are ${actives.map((row) => `${row.symbol} ${formatPct(row.changesPercentage)} on ${(Number(row.volume || 0) / 1e6).toFixed(1)}M shares`).join(', ')}.`
          : 'Most-active tape is thin enough that traders should verify participation before trusting any breakout.',
        gainers.length > 0
          ? `Leaders are ${gainers.map((row) => `${row.symbol} at ${fmtPrice(row.price)} (${formatPct(row.changesPercentage)})`).join(', ')}.`
          : 'No strong upside leadership is standing out in the live dashboard snapshot.',
      ],
    },
    {
      title: 'LATEST NEWS',
      bullets: headlines.length > 0
        ? headlines.map((item) => `${item.symbol || 'MKT'}: ${item.title}`)
        : ['Headline flow is light in the current snapshot, so price action is likely being driven more by tape and positioning than fresh news.'],
    },
    {
      title: 'WEEKLY TRENDS',
      bullets: [
        `SPY ${formatPct(spy?.changesPercentage)} and QQQ ${formatPct(qqq?.changesPercentage)} imply a mixed large-cap tone rather than a clean one-way trend day.`,
        sectors.length > 0
          ? `Top sector tone is ${sectors.map((item) => `${item.sector} ${formatPct(item.changesPercentage)}`).join(', ')}.`
          : 'Sector breadth is not populated in the current snapshot, so weekly leadership should be confirmed from price rather than inferred.',
        losers.length > 0
          ? `Weak pockets include ${losers.map((row) => `${row.symbol} ${formatPct(row.changesPercentage)}`).join(', ')}, which suggests rotation is still selective.`
          : 'There is no concentrated downside basket in the snapshot, which points to a fragmented rather than broad risk-off tape.',
      ],
    },
    {
      title: 'RISK ASSESSMENT',
      bullets: [
        `VIX is ${fmtPrice(vix?.price)} with ${formatPct(vix?.changesPercentage)}, which keeps intraday volatility elevated enough to punish late entries.`,
        fear
          ? `Fear and Greed reads ${Number(fear.value) || 0} (${fear.valueClassification || 'Neutral'}), so overall sentiment is not at an extreme yet.`
          : 'Sentiment data is unavailable in the snapshot, so risk should be framed from price and volatility first.',
        `Current session is ${session?.label || String(session?.phase || 'unknown').toUpperCase()}, and active windows can increase false breaks as liquidity shifts.`,
      ],
    },
    {
      title: 'CONDITIONS & SETUPS',
      bullets: [
        conditionsList.length > 0
          ? `Detected conditions are ${conditionsList.join(', ')}, so setup selection should match the live tape instead of forcing a single playbook.`
          : 'No explicit system conditions were passed, so execution should stay reactive to the tape rather than predictive.',
        gainers.length > 0
          ? `Momentum attention will stay on ${gainers.map((row) => row.symbol).join(', ')}, but only if volume expansion continues after the open rotation.`
          : 'Without clear gainers, continuation setups need stronger confirmation than usual.',
        losers.length > 0
          ? `Fade and mean-reversion interest may cluster around ${losers.map((row) => row.symbol).join(', ')}, especially if they fail to reclaim VWAP.`
          : 'If laggards do not separate from the pack, mean-reversion opportunities will likely stay stock-specific.',
        earnings.length > 0
          ? `Earnings names in focus include ${earnings.slice(0, 4).map((row) => `${row.symbol} ${row.time || 'TBC'}`).join(', ')}, which can distort normal intraday behaviour.`
          : 'With no earnings concentration, sector and index flows should matter more than event risk.',
      ],
    },
    {
      title: 'SUMMARY',
      bullets: [
        `This looks like a ${Number(vix?.price) >= 20 ? 'higher-volatility' : 'moderate-volatility'} session with mixed index leadership and selective single-name movement.`,
        `Key dashboard anchors are SPY ${fmtPrice(spy?.price)}, QQQ ${fmtPrice(qqq?.price)}, and VIX ${fmtPrice(vix?.price)}.`,
        'The next 1-4 hours should favor traders who wait for confirmation around VWAP, opening range levels, and volume follow-through rather than chasing first prints.',
      ],
    },
  ];

  return {
    sections,
    fallback: true,
    message: 'OpenAI narrative unavailable; generated from live market data.',
    generatedAt: new Date().toISOString(),
  };
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
    const fallback = buildRuleBasedBriefing(session, snapshot, conditions);
    return res.json(fallback);
  }

  try {
    const prompt = buildPrompt(session, snapshot, conditions);

    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      max_tokens: 1200,
      temperature: 0.65,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = completion.choices[0]?.message?.content || '';
    const parsed = parseNarrativeResponse(raw);

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
    const fallback = buildRuleBasedBriefing(session, snapshot, conditions);
    return res.json(fallback);
  }
});

module.exports = router;
