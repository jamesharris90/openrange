const OpenAI = require('openai');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const NARRATIVE_CACHE_TTL_MS = 5 * 60 * 1000;
const narrativeCache = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBias(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'continuation') return 'continuation';
  if (normalized === 'reversal') return 'reversal';
  return 'unclear';
}

function normalizeStrength(value) {
  return String(value || '').trim().toLowerCase() === 'strong' ? 'strong' : 'weak';
}

function normalizeRisk(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'low') return 'low';
  if (normalized === 'high') return 'high';
  return 'medium';
}

function parseJsonResponse(content) {
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

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  return new OpenAI({ apiKey });
}

function getPromptPayload(symbol, screenerRow = {}) {
  return {
    symbol: String(symbol || '').toUpperCase(),
    why: String(screenerRow.why || ''),
    driver_type: String(screenerRow.driver_type || 'TECHNICAL'),
    confidence: clamp(toNumber(screenerRow.confidence, 0.4), 0, 1),
    linked_symbols: Array.isArray(screenerRow.linked_symbols)
      ? screenerRow.linked_symbols.map((item) => String(item || '').toUpperCase()).filter(Boolean).slice(0, 5)
      : [],
    change_percent: toNumber(screenerRow.change_percent, 0),
    sector: String(screenerRow.sector || 'Unknown'),
  };
}

function getCacheKey(symbol, screenerRow = {}) {
  return JSON.stringify(getPromptPayload(symbol, screenerRow));
}

function getCachedNarrative(key) {
  const cached = narrativeCache.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    narrativeCache.delete(key);
    return null;
  }

  return cached.value;
}

function setCachedNarrative(key, value) {
  narrativeCache.set(key, {
    value,
    expiresAt: Date.now() + NARRATIVE_CACHE_TTL_MS,
  });
}

function buildFallbackNarrative(symbol, screenerRow = {}) {
  const payload = getPromptPayload(symbol, screenerRow);
  const absChange = Math.abs(payload.change_percent);
  const linkedText = payload.linked_symbols.length
    ? ` Related names: ${payload.linked_symbols.join(', ')}.`
    : '';

  const strength = payload.confidence >= 0.7 || absChange >= 8 ? 'strong' : 'weak';
  const bias = payload.driver_type === 'TECHNICAL'
    ? (payload.confidence >= 0.65 ? 'continuation' : 'unclear')
    : (payload.confidence >= 0.55 ? 'continuation' : 'unclear');

  const risk = payload.confidence >= 0.8
    ? 'low'
    : absChange >= 12 || payload.confidence < 0.45
      ? 'high'
      : 'medium';

  const summary = [
    `${payload.why}.`,
    `Move quality looks ${strength} with ${payload.confidence.toFixed(2)} confidence.`,
    bias === 'continuation'
      ? 'Favor continuation only if the stock holds trend and sector alignment.'
      : 'Treat this as less reliable and watch for a failed move before chasing.',
    `Watch ${payload.sector} peers and price acceptance after the initial move.${linkedText}`,
  ].join(' ');

  return {
    summary,
    strength,
    bias,
    risk,
  };
}

function normalizeNarrativeResponse(parsed, fallback) {
  if (!parsed || typeof parsed !== 'object') {
    return fallback;
  }

  const summary = String(parsed.summary || '').trim();
  return {
    summary: summary || fallback.summary,
    strength: normalizeStrength(parsed.strength || fallback.strength),
    bias: normalizeBias(parsed.bias || fallback.bias),
    risk: normalizeRisk(parsed.risk || fallback.risk),
  };
}

async function buildNarrative(symbol, screenerRow) {
  const fallback = buildFallbackNarrative(symbol, screenerRow);
  const cacheKey = getCacheKey(symbol, screenerRow);
  const cached = getCachedNarrative(cacheKey);
  if (cached) {
    return cached;
  }

  const client = getClient();
  if (!client) {
    setCachedNarrative(cacheKey, fallback);
    return fallback;
  }

  const promptPayload = getPromptPayload(symbol, screenerRow);

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You are a professional trader.',
            'Explain clearly:',
            '1. Why this stock is moving',
            '2. Whether the move is strong or weak',
            '3. Whether it is likely continuation or fade',
            '4. What to watch next',
            'Keep it concise and actionable.',
            'Return only valid JSON with keys: summary, strength, bias, risk.',
            'strength must be "strong" or "weak".',
            'bias must be "continuation", "reversal", or "unclear".',
            'risk must be "low", "medium", or "high".',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify(promptPayload),
        },
      ],
    });

    const content = response?.choices?.[0]?.message?.content || '';
    const parsed = parseJsonResponse(content);
    const narrative = normalizeNarrativeResponse(parsed, fallback);
    setCachedNarrative(cacheKey, narrative);
    return narrative;
  } catch (_error) {
    setCachedNarrative(cacheKey, fallback);
    return fallback;
  }
}

module.exports = {
  buildNarrative,
};