const OpenAI = require('openai');
const logger = require('../logger');

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

async function generateMorningNarrative(payload = {}) {
  const client = getClient();
  if (!client) {
    logger.warn('[MCP] OPENAI_API_KEY missing; using fallback narrative');
    return buildFallbackNarrative(payload);
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const systemPrompt = [
    'You are OpenRange Intelligence MCP.',
    'Return only valid JSON with keys: overview, risk, catalysts, watchlist.',
    'overview and risk are concise strings.',
    'catalysts and watchlist are arrays of strings.',
  ].join(' ');

  const userPayload = JSON.stringify(payload).slice(0, 12000);
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await client.chat.completions.create({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Create the morning intelligence narrative from this context: ${userPayload}`,
          },
        ],
      });

      const content = response?.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);
      return {
        overview: String(parsed.overview || '').trim() || 'No overview generated.',
        risk: String(parsed.risk || '').trim() || 'No risk summary generated.',
        catalysts: Array.isArray(parsed.catalysts) ? parsed.catalysts.map((v) => String(v)).slice(0, 6) : [],
        watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist.map((v) => String(v)).slice(0, 8) : [],
      };
    } catch (error) {
      lastError = error;
      logger.warn('[MCP] Narrative generation attempt failed', {
        attempt,
        message: error.message,
      });
      await new Promise((resolve) => setTimeout(resolve, attempt * 400));
    }
  }

  logger.error('[MCP] Narrative generation failed; falling back', {
    message: lastError?.message || 'Unknown error',
  });
  return buildFallbackNarrative(payload);
}

module.exports = {
  generateMorningNarrative,
};
