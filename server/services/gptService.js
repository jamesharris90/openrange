const axios = require('axios');

function buildFallbackNarrative(data = {}) {
  const spy = Number(data.spy || 0);
  const qqq = Number(data.qqq || 0);
  const vix = Number(data.vix || 0);

  if (vix >= 25) {
    return 'Volatility is elevated and the tape is defensive. Expect lower breakout durability and tighter risk tolerance across single-name setups.';
  }

  if (spy > 0 && qqq > 0 && vix > 0 && vix < 18) {
    return 'Index leadership is constructive and volatility remains contained. The backdrop supports cleaner continuation behavior in names with real catalysts.';
  }

  return 'Market conditions are mixed and conviction should stay selective. Favor names with clear catalysts and avoid assuming index tailwinds will carry weak setups.';
}

async function callGPT(prompt) {
  const apiKey = process.env.PPLX_API_KEY;
  const model = process.env.PPLX_MODEL || 'sonar-pro';

  if (!apiKey) {
    return null;
  }

  try {
    const response = await axios.post(
      'https://api.perplexity.ai/chat/completions',
      {
        model,
        messages: [
          {
            role: 'system',
            content: 'You are an institutional market strategist. Return plain text only.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 180,
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

    if (response.status >= 200 && response.status < 300) {
      const content = String(response.data?.choices?.[0]?.message?.content || '').trim();
      return content || null;
    }
  } catch (_error) {
    return null;
  }

  return null;
}

async function generateNarrative(data) {
  const prompt = `You are a hedge fund trader.\n\nExplain the current market regime and what matters today.\n\nSPY change: ${data.spy}\nQQQ change: ${data.qqq}\nVIX level: ${data.vix}\nMarket regime: ${data.regime || "MIXED"}\nSector leaders: ${Array.isArray(data.sectorLeaders) ? data.sectorLeaders.map((item) => `${item.sector} ${item.change}`).join(", ") : "none"}\nSector laggers: ${Array.isArray(data.sectorLaggers) ? data.sectorLaggers.map((item) => `${item.sector} ${item.change}`).join(", ") : "none"}\n\nMax 3 sentences.\nFocus on actionable insight, not description.`;
  const completion = await callGPT(prompt);
  return completion || buildFallbackNarrative(data);
}

module.exports = {
  callGPT,
  generateNarrative,
};