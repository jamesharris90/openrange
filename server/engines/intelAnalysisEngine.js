const axios = require('axios');
const db = require('../db');
const { buildContext } = require('./mcpContextEngine');

function parseMaybeJson(content) {
  const text = String(content || '').trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (_err) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch (_ignored) {
        return null;
      }
    }
  }

  return null;
}

function normalizeAnalysis(parsed = {}) {
  return {
    summary: String(parsed.summary || ''),
    impact: String(parsed.impact || ''),
    relevant_tickers: Array.isArray(parsed.relevant_tickers)
      ? parsed.relevant_tickers.map((t) => String(t || '').toUpperCase()).filter(Boolean).slice(0, 12)
      : [],
    tradeability_score: Number.isFinite(Number(parsed.tradeability_score))
      ? Number(parsed.tradeability_score)
      : 0,
  };
}

async function analyseIntel(news) {
  console.log('[INTEL AI] analysing headline');

  const headline = String(news?.headline || '');
  const context = await buildContext(headline);

  const apiKey = process.env.PPLX_API_KEY;
  const model = process.env.PPLX_MODEL || 'sonar-pro';

  let analysis = {
    summary: 'Analysis unavailable: missing AI credentials.',
    impact: 'unknown',
    relevant_tickers: [],
    tradeability_score: 0,
  };

  if (apiKey) {
    const promptContext = {
      headline,
      market_context: context.market,
      sector_performance: context.sectorPerformance,
      recent_radar_signals: context.signals,
    };

    try {
      const response = await axios.post(
        'https://api.perplexity.ai/chat/completions',
        {
          model,
          messages: [
            {
              role: 'system',
              content: 'You are an institutional market intelligence assistant. Return strict JSON only with keys: summary, impact, relevant_tickers, tradeability_score.',
            },
            {
              role: 'user',
              content: `Analyse this market news with context and return JSON only: ${JSON.stringify(promptContext)}`,
            },
          ],
          temperature: 0.1,
          max_tokens: 300,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 7000,
          validateStatus: () => true,
        }
      );

      if (response.status < 300) {
        const content = response.data?.choices?.[0]?.message?.content || '';
        const parsed = parseMaybeJson(content);
        if (parsed && typeof parsed === 'object') {
          analysis = normalizeAnalysis(parsed);
        }
      }
    } catch (_err) {
      // Preserve fallback analysis.
    }
  }

  if (news?.id) {
    await db.query(
      `UPDATE news_articles
       SET ai_analysis = $1
       WHERE id = $2`,
      [JSON.stringify(analysis), news.id]
    );
    console.log('[INTEL AI] analysis stored');
  }

  return {
    ...analysis,
    context,
  };
}

module.exports = { analyseIntel };
