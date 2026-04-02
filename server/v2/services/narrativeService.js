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
  if (normalized === 'chop') return 'chop';
  return null;
}

function normalizeStrength(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'strong') return 'strong';
  if (normalized === 'weak') return 'weak';
  return null;
}

function normalizeRisk(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'low') return 'low';
  if (normalized === 'high') return 'high';
  if (normalized === 'medium') return 'medium';
  return null;
}

function normalizeTradeable(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
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

function buildGeneratedAt() {
  return new Date().toISOString();
}

function buildFallbackNarrative(symbol, screenerRow = {}) {
  const payload = getPromptPayload(symbol, screenerRow);
  const absChange = Math.abs(payload.change_percent);
  const strength = payload.confidence >= 0.7 || absChange >= 8 ? 'strong' : 'weak';
  const tradeable = payload.confidence >= 0.55 && absChange >= 3;
  const bias = payload.driver_type === 'TECHNICAL'
    ? (payload.confidence >= 0.65 ? 'continuation' : 'chop')
    : (payload.confidence >= 0.55 ? 'continuation' : 'chop');

  const risk = payload.confidence >= 0.8
    ? 'low'
    : absChange >= 12 || payload.confidence < 0.45
      ? 'high'
      : 'medium';

  const driver = payload.why;
  const peerText = payload.linked_symbols.length
    ? payload.linked_symbols.join(', ')
    : `${payload.sector} peers`;
  const watch = tradeable
    ? `Watch for confirmation versus ${peerText} and acceptance after the first pullback.`
    : `Watch for failure to hold the initial move before considering any entry.`;

  const summary = [
    `${payload.why}.`,
    strength === 'strong' ? 'The move has enough confirmation to matter intraday.' : 'The move lacks enough confirmation to trust yet.',
    tradeable ? 'It is tradeable only with clean follow-through.' : 'It is not tradeable yet without better confirmation.',
    `Most likely outcome is ${bias}. ${watch}`,
  ].join(' ');

  return {
    summary,
    driver,
    strength,
    tradeable,
    bias,
    watch,
    risk,
    generated_at: buildGeneratedAt(),
  };
}

function hasCompleteNarrativeShape(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return false;
  }

  const summary = String(parsed.summary || '').trim();
  const driver = String(parsed.driver || '').trim();
  const watch = String(parsed.watch || '').trim();
  const strength = normalizeStrength(parsed.strength);
  const tradeable = normalizeTradeable(parsed.tradeable);
  const bias = normalizeBias(parsed.bias);
  const risk = normalizeRisk(parsed.risk);

  return Boolean(summary && driver && watch && strength && tradeable !== null && bias && risk);
}

function normalizeNarrativeResponse(parsed, fallback) {
  if (!hasCompleteNarrativeShape(parsed)) {
    return fallback;
  }

  const summary = String(parsed.summary || '').trim();
  const driver = String(parsed.driver || '').trim();
  const watch = String(parsed.watch || '').trim();
  return {
    summary,
    driver,
    strength: normalizeStrength(parsed.strength),
    tradeable: normalizeTradeable(parsed.tradeable),
    bias: normalizeBias(parsed.bias),
    watch,
    risk: normalizeRisk(parsed.risk),
    generated_at: buildGeneratedAt(),
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
            'You are an experienced intraday trader.',
            'Given this stock data, answer:',
            '1. What is actually driving this move? (be specific)',
            '2. Is this move strong or weak?',
            '3. Is this tradeable or not?',
            '4. What is the most likely outcome? (continuation, fade, chop)',
            '5. What specific signal should a trader watch next?',
            'Be concise. No fluff. No generic statements.',
            'Return only valid JSON with keys: summary, driver, strength, tradeable, bias, watch, risk.',
            'summary must be a concise decision-grade summary.',
            'driver must be specific and concrete.',
            'strength must be "strong" or "weak".',
            'tradeable must be a boolean true or false.',
            'bias must be "continuation", "reversal", or "chop".',
            'watch must be one actionable sentence.',
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