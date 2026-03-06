const axios = require('axios');

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function extractGeopoliticalSignals(newsItems) {
  const rows = Array.isArray(newsItems) ? newsItems : [];
  const terms = ['iran', 'middle east', 'war', 'conflict', 'tariff', 'sanction', 'fed', 'treasury'];
  const matches = [];

  for (const row of rows) {
    const text = `${row?.headline || ''} ${row?.source || ''}`.toLowerCase();
    if (terms.some((term) => text.includes(term))) {
      matches.push(row?.headline || 'Macro geopolitical headline');
    }
    if (matches.length >= 3) break;
  }

  return matches;
}

function deterministicNarrative({ indexCards = [], sectorMovers = [], newsItems = [] }) {
  const bySymbol = new Map(indexCards.map((row) => [String(row?.symbol || '').toUpperCase(), row]));
  const spy = bySymbol.get('SPY') || {};
  const vix = bySymbol.get('VIX') || {};

  const spyMove = toNumber(spy?.change_percent, 0);
  const vixMove = toNumber(vix?.change_percent, 0);
  const topSector = sectorMovers[0] || {};
  const geopolitics = extractGeopoliticalSignals(newsItems);

  const regime = spyMove > 0.5 && vixMove <= 0 ? 'risk-on momentum' : spyMove < -0.5 || vixMove > 1 ? 'risk-off rotation' : 'balanced tape';

  return {
    headline: `Market currently in ${regime}`,
    analysis: `SPY is ${spyMove >= 0 ? 'up' : 'down'} ${spyMove.toFixed(2)}% while VIX is ${vixMove >= 0 ? 'up' : 'down'} ${Math.abs(vixMove).toFixed(2)}%.`,
    sector_implications: topSector?.sector
      ? `${topSector.sector} is leading with ${toNumber(topSector?.price_change || topSector?.avg_change_percent, 0).toFixed(2)}% relative move.`
      : 'Sector leadership is mixed; favor liquid leaders only.',
    tickers_to_watch: Array.isArray(topSector?.tickers)
      ? topSector.tickers.slice(0, 4).map((item) => String(item?.symbol || '').toUpperCase()).filter(Boolean)
      : [],
    trade_plan: spyMove >= 0
      ? 'Prioritize continuation names on pullbacks into VWAP with volume confirmation.'
      : 'Prioritize mean-reversion only after reclaim levels; otherwise stay defensive with tighter risk.',
    geopolitical_signals: geopolitics,
    source: 'deterministic',
  };
}

function parseLlmJson(content) {
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

async function generateRadarNarrative(input, options = {}) {
  const fallback = deterministicNarrative(input || {});
  const apiKey = options.apiKey || process.env.PPLX_API_KEY;
  const model = options.model || process.env.PPLX_MODEL || 'sonar-pro';

  if (!apiKey) {
    return fallback;
  }

  const prompt = {
    indices: (input?.indexCards || []).slice(0, 6),
    sector_movers: (input?.sectorMovers || []).slice(0, 5),
    top_news: (input?.newsItems || []).slice(0, 8),
    geopolitical_signals: extractGeopoliticalSignals(input?.newsItems || []),
  };

  try {
    const response = await axios.post(
      'https://api.perplexity.ai/chat/completions',
      {
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a real-time market narrative engine. Return only valid JSON with keys: headline, analysis, sector_implications, tickers_to_watch (array), trade_plan.',
          },
          {
            role: 'user',
            content: `Generate narrative JSON from this context: ${JSON.stringify(prompt)}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 220,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 1400,
        validateStatus: () => true,
      }
    );

    if (response.status >= 300) {
      return fallback;
    }

    const content = response.data?.choices?.[0]?.message?.content || '';
    const parsed = parseLlmJson(content);
    if (!parsed || typeof parsed !== 'object') {
      return fallback;
    }

    return {
      headline: parsed.headline || fallback.headline,
      analysis: parsed.analysis || fallback.analysis,
      sector_implications: parsed.sector_implications || fallback.sector_implications,
      tickers_to_watch: Array.isArray(parsed.tickers_to_watch) ? parsed.tickers_to_watch.slice(0, 6) : fallback.tickers_to_watch,
      trade_plan: parsed.trade_plan || fallback.trade_plan,
      geopolitical_signals: fallback.geopolitical_signals,
      source: 'llm',
    };
  } catch (_error) {
    return fallback;
  }
}

module.exports = {
  generateRadarNarrative,
};
