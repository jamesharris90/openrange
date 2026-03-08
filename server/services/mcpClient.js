const OpenAI = require('openai');
const logger = require('../logger');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

function buildFallbackNarrative(payload = {}) {
  const market = Array.isArray(payload.market) ? payload.market.slice(0, 4) : [];
  const signals = Array.isArray(payload.signals) ? payload.signals.slice(0, 5) : [];
  const news = Array.isArray(payload.news) ? payload.news.slice(0, 5) : [];

  return {
    overview: market.length
      ? `Market snapshot covers ${market.map((m) => m.symbol).filter(Boolean).join(', ')}.`
      : 'Market snapshot unavailable at generation time.',
    risk: news.length ? 'Risk posture is headline-sensitive; monitor macro and earnings catalysts.' : 'Risk posture neutral.',
    catalysts: news.map((item) => item.headline).filter(Boolean).slice(0, 3),
    watchlist: signals.map((item) => item.symbol).filter(Boolean).slice(0, 5),
  };
}

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new OpenAI({ apiKey });
}

async function requestJsonFromMcp({ systemPrompt, userPrompt, fallback }) {
  const client = getClient();
  if (!client) {
    logger.warn('[MCP] OPENAI_API_KEY missing; using fallback response');
    return fallback();
  }

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });

      const content = response?.choices?.[0]?.message?.content || '{}';
      return JSON.parse(content);
    } catch (error) {
      lastError = error;
      logger.warn('[MCP] JSON request attempt failed', {
        model: MODEL,
        attempt,
        message: error.message,
      });
      await new Promise((resolve) => setTimeout(resolve, attempt * 400));
    }
  }

  logger.error('[MCP] JSON request failed; using fallback', {
    model: MODEL,
    message: lastError?.message || 'Unknown error',
  });
  return fallback();
}

function fallbackSignalExplanations(signals = []) {
  const explanations = {};
  for (const signal of signals) {
    const symbol = String(signal?.symbol || '').toUpperCase();
    if (!symbol) continue;
    const strategy = signal?.strategy || 'Setup';
    const catalyst = signal?.catalyst_headline || 'No major catalyst headline';
    explanations[symbol] = {
      signal_explanation: `${symbol} ${strategy}: ${catalyst}.`,
      rationale: `Score supported by gap/volume structure and catalyst context for ${symbol}.`,
    };
  }
  return { explanations };
}

async function generateSignalExplanations(signals = []) {
  const cleanSignals = Array.isArray(signals) ? signals.slice(0, 20) : [];
  const signalPayload = JSON.stringify(cleanSignals).slice(0, 12000);

  const parsed = await requestJsonFromMcp({
    systemPrompt: [
      'You are OpenRange Intelligence MCP.',
      'Return only valid JSON with shape: {"explanations": {"SYMBOL": {"signal_explanation": string, "rationale": string}}}.',
      'Keep each explanation concise, specific, and trading-focused.',
    ].join(' '),
    userPrompt: `Generate signal explanations for these signals: ${signalPayload}`,
    fallback: () => fallbackSignalExplanations(cleanSignals),
  });

  return parsed?.explanations && typeof parsed.explanations === 'object'
    ? parsed.explanations
    : fallbackSignalExplanations(cleanSignals).explanations;
}

function fallbackMarketNarratives(payload = {}) {
  const themes = [
    { sector: 'AI', keywords: ['ai', 'artificial intelligence', 'nvda', 'amd', 'semiconductor'] },
    { sector: 'Semiconductors', keywords: ['semiconductor', 'chip', 'soxx', 'smh', 'nvda', 'amd'] },
    { sector: 'Energy', keywords: ['energy', 'oil', 'xle', 'crude', 'natural gas'] },
    { sector: 'Defense', keywords: ['defense', 'contract', 'dod', 'pentagon'] },
    { sector: 'Healthcare', keywords: ['healthcare', 'fda', 'biotech', 'drug'] },
    { sector: 'Rate cuts', keywords: ['rate cut', 'fed', 'fomc', 'yield', 'inflation'] },
    { sector: 'China stimulus', keywords: ['china', 'stimulus', 'beijing'] },
  ];

  const textBlob = [
    ...(payload?.catalysts || []).map((row) => row?.headline || ''),
    ...(payload?.news || []).map((row) => row?.headline || ''),
  ].join(' ').toLowerCase();

  const narratives = themes
    .filter((theme) => theme.keywords.some((keyword) => textBlob.includes(keyword)))
    .map((theme) => ({
      sector: theme.sector,
      narrative: `${theme.sector} narrative is active based on recent catalysts and headlines.`,
      confidence: 0.62,
      affected_symbols: (payload?.catalysts || [])
        .map((row) => String(row?.symbol || '').toUpperCase())
        .filter(Boolean)
        .slice(0, 5),
    }));

  return narratives.length
    ? narratives
    : [{ sector: 'Macro', narrative: 'No dominant narrative detected from recent headlines.', confidence: 0.45, affected_symbols: [] }];
}

async function generateMarketNarratives(payload = {}) {
  const userPayload = JSON.stringify(payload).slice(0, 14000);

  const parsed = await requestJsonFromMcp({
    systemPrompt: [
      'You are OpenRange Intelligence MCP.',
      'Summarize emerging market narratives from headlines and catalysts.',
      'Return only valid JSON with key: narratives.',
      'narratives must be an array of objects with keys: sector, narrative, confidence, affected_symbols.',
      'confidence is a number between 0 and 1, affected_symbols is an array of ticker strings.',
    ].join(' '),
    userPrompt: `Create structured narratives from this context: ${userPayload}`,
    fallback: () => ({ narratives: fallbackMarketNarratives(payload) }),
  });

  const rows = Array.isArray(parsed?.narratives) ? parsed.narratives : fallbackMarketNarratives(payload);
  return rows.map((row) => ({
    sector: String(row?.sector || 'Macro'),
    narrative: String(row?.narrative || 'Narrative unavailable'),
    confidence: Number.isFinite(Number(row?.confidence)) ? Number(row.confidence) : 0.5,
    affected_symbols: Array.isArray(row?.affected_symbols)
      ? row.affected_symbols.map((v) => String(v).toUpperCase()).slice(0, 10)
      : [],
  }));
}

async function generateMorningNarrative(payload = {}) {
  const userPayload = JSON.stringify(payload).slice(0, 12000);
  const parsed = await requestJsonFromMcp({
    systemPrompt: [
      'You are OpenRange Intelligence MCP.',
      'Return only valid JSON with keys: overview, risk, catalysts, watchlist.',
      'overview and risk are concise strings.',
      'catalysts and watchlist are arrays of strings.',
    ].join(' '),
    userPrompt: `Create the morning intelligence narrative from this context: ${userPayload}`,
    fallback: () => buildFallbackNarrative(payload),
  });

  return {
    overview: String(parsed?.overview || '').trim() || 'No overview generated.',
    risk: String(parsed?.risk || '').trim() || 'No risk summary generated.',
    catalysts: Array.isArray(parsed?.catalysts) ? parsed.catalysts.map((v) => String(v)).slice(0, 6) : [],
    watchlist: Array.isArray(parsed?.watchlist) ? parsed.watchlist.map((v) => String(v)).slice(0, 8) : [],
  };
}

module.exports = {
  generateMorningNarrative,
  generateSignalExplanations,
  generateMarketNarratives,
};
