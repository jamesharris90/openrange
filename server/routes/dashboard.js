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
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

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

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizePhase(session = {}) {
  const raw = String(session?.phase || session?.label || '').trim().toLowerCase();
  if (raw.includes('pre')) return 'pre_market';
  if (raw.includes('open') || raw.includes('morning')) return 'open';
  if (raw.includes('mid') || raw.includes('lunch') || raw.includes('noon')) return 'mid_day';
  if (raw.includes('close') || raw.includes('power')) return 'close';
  return 'open';
}

function nextPsychologicalLevel(price) {
  const value = toNumber(price, 0);
  if (value <= 0) return 'N/A';

  let step = 0.1;
  if (value >= 1 && value < 5) step = 0.25;
  else if (value >= 5 && value < 20) step = 0.5;
  else if (value >= 20 && value < 100) step = 1;
  else if (value >= 100) step = 5;

  const target = Math.ceil((value + Number.EPSILON) / step) * step;
  return `$${target.toFixed(step >= 1 ? 0 : 2).replace(/\.00$/, '')}`;
}

function deriveSpyTrend(snapshot) {
  const spy = getIndex(snapshot, 'SPY');
  const change = toNumber(spy?.changesPercentage, 0);
  if (change >= 0.5) return 'bullish drive';
  if (change > 0) return 'constructive grind';
  if (change <= -0.5) return 'risk-off pressure';
  return 'mixed / flat tape';
}

function buildGuardrail(snapshot, conditions = []) {
  const vix = getIndex(snapshot, 'VIX');
  const vixPrice = toNumber(vix?.price, 0);
  const vixChange = toNumber(vix?.changesPercentage, 0);
  const joinedConditions = Array.isArray(conditions) ? conditions.join(' ').toLowerCase() : '';
  const hasEventRisk = /(fomc|cpi|powell|fed|jobs|nfp|red folder)/.test(joinedConditions);

  if (vixPrice >= 25 || vixChange >= 5 || hasEventRisk) {
    return 'GUARDRAIL: No-Trade Zone active.';
  }

  return null;
}

function deriveTickerScenario(phase, row) {
  const move = Math.abs(toNumber(row?.changesPercentage, 0));
  const volume = toNumber(row?.volume, 0);
  if (phase === 'open' || phase === 'close') {
    return move >= 8 || volume >= 2_000_000 ? 'Intraday' : 'Scalp';
  }
  return volume >= 1_500_000 ? 'Intraday' : 'Scalp';
}

function deriveConfidence(row) {
  const move = Math.abs(toNumber(row?.changesPercentage, 0));
  const volumeMillions = toNumber(row?.volume, 0) / 1_000_000;
  const score = 50 + Math.min(move * 2, 20) + Math.min(volumeMillions * 4, 20);
  return Math.max(45, Math.min(Math.round(score), 92));
}

function buildTickerEvidence(row, phase) {
  const move = formatPct(row?.changesPercentage);
  const volumeMillions = (toNumber(row?.volume, 0) / 1_000_000).toFixed(1);
  const target = nextPsychologicalLevel(row?.price);
  const phaseText = phase === 'pre_market'
    ? 'Gap quality matters more than open-drive follow-through here.'
    : phase === 'mid_day'
      ? 'Mid-day participation must hold or the move risks degrading into chop.'
      : phase === 'close'
        ? 'Late-session flow matters most because squeezes and hedging can accelerate into the bell.'
        : 'Open-drive follow-through is the key read because early commitment separates real leaders from noise.';

  return [
    `${row.symbol} is ${move} on ${volumeMillions}M shares at ${fmtPrice(row.price)}, which is enough expansion to keep it on the tape-reader shortlist.`,
    `${phaseText} Next psychological level is ${target}.`,
  ];
}

function toQuickLookSections(quickLook) {
  const bullets = (quickLook?.in_play || []).map((item) => {
    const evidenceText = Array.isArray(item.evidence) ? item.evidence.join(' ') : '';
    return `${item.ticker} | ${item.scenario} | ${item.target} | ${item.confidence}% confidence. ${evidenceText}`.trim();
  });

  const sections = [
    {
      title: 'MARKET TEMPERATURE',
      bullets: [quickLook?.market_temperature || 'No market temperature available.'],
    },
    {
      title: 'IN PLAY',
      bullets: bullets.length > 0 ? bullets : ['No tickers met the evidence threshold in the current snapshot.'],
    },
  ];

  if (quickLook?.guardrail) {
    sections.push({
      title: 'GUARDRAIL',
      bullets: [quickLook.guardrail],
    });
  }

  return sections;
}

function normalizeQuickLookResponse(parsed, session, snapshot, conditions) {
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const marketTemperature = String(parsed.market_temperature || '').trim();
  const inPlay = Array.isArray(parsed.in_play) ? parsed.in_play.slice(0, 3) : [];
  if (!marketTemperature || inPlay.length === 0) {
    return null;
  }

  const normalizedInPlay = inPlay
    .map((item) => {
      const ticker = String(item?.ticker || '').trim().toUpperCase();
      const scenario = String(item?.scenario || '').trim() || 'Intraday';
      const target = String(item?.target || '').trim() || 'N/A';
      const confidence = Math.max(0, Math.min(100, Math.round(toNumber(item?.confidence, 0))));
      const evidence = Array.isArray(item?.evidence)
        ? item.evidence.map((entry) => String(entry || '').trim()).filter(Boolean)
        : [];
      if (!ticker || !target || evidence.length === 0) {
        return null;
      }
      return { ticker, scenario, target, confidence, evidence };
    })
    .filter(Boolean)
    .slice(0, 3);

  if (normalizedInPlay.length === 0) {
    return null;
  }

  const result = {
    market_temperature: marketTemperature,
    in_play: normalizedInPlay,
    guardrail: typeof parsed.guardrail === 'string' && parsed.guardrail.trim() ? parsed.guardrail.trim() : buildGuardrail(snapshot, conditions),
    generatedAt: new Date().toISOString(),
    source: 'openai',
  };

  result.sections = toQuickLookSections(result);
  result.phase = normalizePhase(session);
  return result;
}

function buildRuleBasedBriefing(session, snapshot, conditions) {
  const spy = getIndex(snapshot, 'SPY');
  const vix = getIndex(snapshot, 'VIX');
  const phase = normalizePhase(session);
  const gainers = (snapshot?.gainers || []).slice(0, 3);
  const spyTrend = deriveSpyTrend(snapshot);
  const vixText = `${fmtPrice(vix?.price)} (${formatPct(vix?.changesPercentage)})`;
  const guardrail = buildGuardrail(snapshot, conditions);
  const marketTemperature = phase === 'pre_market'
    ? `Pre-market temperature is ${spyTrend}; VIX is ${vixText}, so the tape should be judged on whether gaps hold with real participation rather than on headline excitement alone.`
    : phase === 'mid_day'
      ? `Mid-day temperature is ${spyTrend}; VIX is ${vixText}, so the base case is chop unless leaders keep volume and hold key levels.`
      : phase === 'close'
        ? `Power-hour temperature is ${spyTrend}; VIX is ${vixText}, so late positioning and squeeze risk matter more than early range noise.`
        : `Open-drive temperature is ${spyTrend}; VIX is ${vixText}, so the key read is whether opening range commitment holds or fades.`;

  const inPlay = gainers.map((row) => ({
    ticker: row.symbol,
    scenario: deriveTickerScenario(phase, row),
    target: nextPsychologicalLevel(row.price),
    confidence: deriveConfidence(row),
    evidence: buildTickerEvidence(row, phase),
  }));

  const result = {
    market_temperature: marketTemperature,
    in_play: inPlay,
    guardrail,
    fallback: true,
    message: 'OpenAI narrative unavailable; generated from live market data.',
    generatedAt: new Date().toISOString(),
    source: 'fallback',
    phase,
  };

  result.sections = toQuickLookSections(result);
  return result;
}

function buildPrompt(session, snapshot, conditions) {
  const sp = (snapshot?.indices || []).find((i) => i.symbol === 'SPY');
  const vix = (snapshot?.indices || []).find((i) => i.symbol === 'VIX');

  const topGainers = (snapshot?.gainers || []).slice(0, 8).map((row) => ({
    symbol: row.symbol,
    price: toNumber(row.price, 0),
    changesPercentage: toNumber(row.changesPercentage, 0),
    volume: toNumber(row.volume, 0),
  }));
  const phase = normalizePhase(session);
  const conditionsText = Array.isArray(conditions) ? conditions.filter(Boolean).join(', ') : '';
  const context = {
    current_time_ET: session?.et || 'N/A',
    market_phase: phase,
    top_gainers_json: topGainers,
    vix_index: {
      price: toNumber(vix?.price, 0),
      changesPercentage: toNumber(vix?.changesPercentage, 0),
    },
    spy_trend: {
      price: toNumber(sp?.price, 0),
      changesPercentage: toNumber(sp?.changesPercentage, 0),
      description: deriveSpyTrend(snapshot),
    },
    conditions: conditionsText,
    headlines: (snapshot?.news || []).slice(0, 6).map((item) => ({
      symbol: item.symbol || 'MKT',
      title: item.title,
    })),
  };

  return `Role: Expert US Equities Tape Reader & Risk Manager.
Objective: Provide a Quick Look analysis of US market data based on the current trading phase.

STRICT INPUT DATA:
${JSON.stringify(context, null, 2)}

NARRATIVE GUIDELINES:
1. The So What: do not repeat the price without inference. Explain what the tape implies.
2. Phase-Specific Logic:
   - Pre-Market: focus on the Catalyst. Why is it moving? Is the gap holding or fading?
   - Open/Drive: focus on the Commitment. Which sector is leading? What is the ORB status?
   - Mid-Day: focus on the Trap. Identify chop vs consolidation.
   - Power Hour: focus on the Close. Who is squeezing into the bell?
3. The Move Forecast:
   - How Far: identify the next major psychological level or daily resistance.
   - Probability: assign a Likelihood Score as Low, Med, or High based on volume alignment.
4. Rule Book Filter:
   - If VIX is spiking or if conditions imply a Red Folder event within 30 minutes, explicitly state: GUARDRAIL: No-Trade Zone active.
5. Everything added needs evidence from the supplied input. If evidence is weak, say so.
6. Do not recommend buying or selling. This is market analysis, not trade advice.

Respond with ONLY valid JSON using this exact shape:
{
  "market_temperature": "one sentence",
  "in_play": [
    {
      "ticker": "ABC",
      "scenario": "Scalp or Intraday",
      "target": "$12.50",
      "confidence": 72,
      "evidence": ["evidence sentence 1", "evidence sentence 2"]
    }
  ],
  "guardrail": "GUARDRAIL: No-Trade Zone active." 
}

Rules for output:
- Return exactly 3 in_play tickers.
- market_temperature must be one sentence.
- confidence must be an integer percentage.
- evidence must be concrete and reference volume, phase, VIX, SPY trend, headlines, or conditions when relevant.
- If no guardrail is active, set guardrail to an empty string.`;
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

    const result = normalizeQuickLookResponse(parsed, session, snapshot, conditions);
    if (!result) {
      throw new Error('Invalid quick look structure from OpenAI');
    }

    setCache(cacheKey, result);
    return res.json(result);
  } catch (err) {
    console.error('[DASHBOARD_BRIEFING] error:', err.message);
    const fallback = buildRuleBasedBriefing(session, snapshot, conditions);
    return res.json(fallback);
  }
});

module.exports = router;
