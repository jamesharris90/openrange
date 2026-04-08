const OpenAI = require('openai');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const NARRATIVE_CACHE_TTL_MS = 5 * 60 * 1000;
const narrativeCache = new Map();

function isMcpPayload(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && (
      Object.prototype.hasOwnProperty.call(value, 'why')
      || Object.prototype.hasOwnProperty.call(value, 'what')
      || Object.prototype.hasOwnProperty.call(value, 'trade_score')
      || Object.prototype.hasOwnProperty.call(value, 'action')
    );
}

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

function normalizeSetupType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'momentum continuation') return 'momentum continuation';
  if (normalized === 'mean reversion') return 'mean reversion';
  if (normalized === 'breakout') return 'breakout';
  if (normalized === 'fade') return 'fade';
  if (normalized === 'chop / avoid') return 'chop / avoid';
  return null;
}

function hasActionableTrigger(text) {
  const normalized = String(text || '').toLowerCase();
  return /(vwap reclaim|break of high|break above|hold of support|hold above|failure of level|failure of vwap|break below|intraday high|intraday low|opening range)/.test(normalized);
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

function getMcpPromptPayload(mcp = {}) {
  const risk = mcp && typeof mcp === 'object' ? (mcp.risk || {}) : {};
  const expectedMove = mcp && typeof mcp === 'object' ? (mcp.expected_move || {}) : {};

  return {
    action: String(mcp.action || 'AVOID').toUpperCase(),
    trade_score: toNumber(mcp.trade_score, 0),
    confidence: toNumber(mcp.confidence, 0),
    trade_quality: String(mcp.trade_quality || 'LOW').toUpperCase(),
    summary: String(mcp.summary || '').trim(),
    why: String(mcp.why || '').trim(),
    what: String(mcp.what || '').trim(),
    where: String(mcp.where || '').trim(),
    when: String(mcp.when || '').trim(),
    confidence_reason: String(mcp.confidence_reason || '').trim(),
    improve: String(mcp.improve || '').trim(),
    expected_move_percent: toNumber(expectedMove.percent, 0),
    expected_move_label: String(expectedMove.label || 'LOW').toUpperCase(),
    risk: {
      entry: Number.isFinite(Number(risk.entry)) ? Number(risk.entry) : null,
      invalidation: Number.isFinite(Number(risk.invalidation)) ? Number(risk.invalidation) : null,
      reward: Number.isFinite(Number(risk.reward)) ? Number(risk.reward) : null,
      rr: Number.isFinite(Number(risk.rr)) ? Number(risk.rr) : null,
    },
  };
}

function getCacheKey(symbol, screenerRow = {}) {
  return JSON.stringify(getPromptPayload(symbol, screenerRow));
}

function getMcpCacheKey(mcp = {}) {
  return JSON.stringify(getMcpPromptPayload(mcp));
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

function buildMcpFallbackNarrative(mcp = {}) {
  const payload = getMcpPromptPayload(mcp);
  const expectedMove = payload.expected_move_percent > 0
    ? ` Expected move is about ${payload.expected_move_percent.toFixed(1)}%.`
    : '';
  const riskSentence = payload.risk.entry !== null && payload.risk.invalidation !== null
    ? ` Entry references ${payload.risk.entry} with invalidation near ${payload.risk.invalidation}.`
    : '';

  return {
    summary: payload.summary || 'No clear edge right now.',
    explanation: [
      payload.why,
      payload.what,
      payload.where,
      payload.when,
    ].filter(Boolean).join(' ')
      + expectedMove
      + riskSentence,
    generated_at: buildGeneratedAt(),
  };
}

async function buildMcpNarrative(mcp) {
  const fallback = buildMcpFallbackNarrative(mcp);
  const cacheKey = getMcpCacheKey(mcp);
  const cached = getCachedNarrative(cacheKey);
  if (cached) {
    return cached;
  }

  const client = getClient();
  if (!client) {
    setCachedNarrative(cacheKey, fallback);
    return fallback;
  }

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You are an institutional trading analyst.',
            'Convert the supplied MCP decision object into a clean, concise human explanation.',
            'Do not change the trade decision, score, risk, or logic.',
            'Return only valid JSON with keys: summary, explanation.',
            'summary must stay aligned to the MCP decision.',
            'explanation must be 2-4 sentences, concrete, and trader-readable.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify(getMcpPromptPayload(mcp)),
        },
      ],
    });

    const content = response?.choices?.[0]?.message?.content || '';
    const parsed = parseJsonResponse(content);
    const narrative = {
      summary: String(parsed?.summary || fallback.summary).trim() || fallback.summary,
      explanation: String(parsed?.explanation || fallback.explanation).trim() || fallback.explanation,
      generated_at: buildGeneratedAt(),
    };

    setCachedNarrative(cacheKey, narrative);
    return narrative;
  } catch (_error) {
    setCachedNarrative(cacheKey, fallback);
    return fallback;
  }
}

function getMoveDirection(changePercent) {
  return toNumber(changePercent, 0) >= 0 ? 'up' : 'down';
}

function getSetupType({ bias, tradeable, rvol, change_percent: changePercent }) {
  const absChange = Math.abs(toNumber(changePercent, 0));
  const rvolValue = toNumber(rvol, 0);

  if (!tradeable || bias === 'chop') {
    return 'chop / avoid';
  }

  if (bias === 'reversal') {
    return absChange >= 5 ? 'fade' : 'mean reversion';
  }

  if (bias === 'continuation' && (rvolValue >= 3 || absChange >= 6)) {
    return 'breakout';
  }

  return 'momentum continuation';
}

function getConfidenceReason({ confidence, latest_news_at: latestNewsAt, rvol, change_percent: changePercent }) {
  const confidenceValue = clamp(toNumber(confidence, 0), 0, 1);
  const rvolValue = toNumber(rvol, 0);
  const absChange = Math.abs(toNumber(changePercent, 0));
  const freshNews = Boolean(latestNewsAt) && (Date.now() - Date.parse(latestNewsAt)) <= 24 * 60 * 60 * 1000;

  if (confidenceValue >= 0.8) {
    return freshNews
      ? 'High RVOL with fresh news catalyst and strong continuation behaviour'
      : 'High RVOL with a clean directional move and strong intraday participation';
  }

  if (confidenceValue >= 0.4) {
    return freshNews || rvolValue >= 2 || absChange >= 4
      ? 'Partial confirmation from flow, price expansion, or catalyst timing'
      : 'Some confirmation is present, but the move still lacks full alignment';
  }

  return 'Weak move or no clear catalyst confirmation behind the tape';
}

function getActionableWatch({ bias, tradeable, change_percent: changePercent }) {
  const direction = getMoveDirection(changePercent);

  if (!tradeable || bias === 'chop') {
    return direction === 'up'
      ? 'Watch for failure of level at VWAP or rejection at the intraday high.'
      : 'Watch for failure of level at VWAP or break below the intraday low.';
  }

  if (bias === 'reversal') {
    return direction === 'up'
      ? 'Watch for hold of support at VWAP and failure of level at the intraday high.'
      : 'Watch for VWAP reclaim and hold of support above the intraday low.';
  }

  return direction === 'up'
    ? 'Watch for VWAP reclaim and break of high above the intraday high.'
    : 'Watch for failure of VWAP reclaim and break below the intraday low.';
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
  const setup_type = getSetupType({
    bias,
    tradeable,
    rvol: screenerRow?.rvol,
    change_percent: payload.change_percent,
  });
  const confidence_reason = getConfidenceReason({
    confidence: payload.confidence,
    latest_news_at: screenerRow?.latest_news_at,
    rvol: screenerRow?.rvol,
    change_percent: payload.change_percent,
  });
  const watch = getActionableWatch({
    bias,
    tradeable,
    change_percent: payload.change_percent,
  });

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
    setup_type,
    confidence_reason,
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
  const setupType = normalizeSetupType(parsed.setup_type);
  const confidenceReason = String(parsed.confidence_reason || '').trim();
  const risk = normalizeRisk(parsed.risk);

  return Boolean(
    summary
    && driver
    && watch
    && hasActionableTrigger(watch)
    && strength
    && tradeable !== null
    && bias
    && setupType
    && confidenceReason
    && risk
  );
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
    setup_type: normalizeSetupType(parsed.setup_type),
    confidence_reason: String(parsed.confidence_reason || '').trim(),
    watch,
    risk: normalizeRisk(parsed.risk),
    generated_at: buildGeneratedAt(),
  };
}

async function buildNarrative(symbol, screenerRow) {
  if (isMcpPayload(symbol) && screenerRow === undefined) {
    return buildMcpNarrative(symbol);
  }

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
            'Return only valid JSON with keys: summary, driver, strength, tradeable, bias, setup_type, confidence_reason, watch, risk.',
            'summary must be a concise decision-grade summary.',
            'driver must be specific and concrete.',
            'strength must be "strong" or "weak".',
            'tradeable must be a boolean true or false.',
            'bias must be "continuation", "reversal", or "chop".',
            'setup_type must be one of: momentum continuation, mean reversion, breakout, fade, chop / avoid.',
            'confidence_reason must explain why confidence is high, medium, or low.',
            'watch must be one actionable sentence with a specific trigger such as VWAP reclaim, break of high, hold of support, or failure of level.',
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