const axios = require('axios');

const POSITIVE = ['beat', 'surge', 'upgrade', 'growth', 'strong', 'record'];
const NEGATIVE = ['miss', 'downgrade', 'lawsuit', 'probe', 'weak', 'decline'];

function scoreSentiment(text = '') {
  const t = String(text).toLowerCase();
  let score = 0;
  POSITIVE.forEach((w) => {
    if (t.includes(w)) score += 1;
  });
  NEGATIVE.forEach((w) => {
    if (t.includes(w)) score -= 1;
  });
  return score;
}

function extractSymbols(headline = '') {
  const matches = String(headline).match(/\b[A-Z]{1,5}\b/g) || [];
  return [...new Set(matches)];
}

async function fetchLatestNews(apiKey) {
  const url = `https://financialmodelingprep.com/stable/news/general-latest?apikey=${apiKey}`;
  const response = await axios.get(url, { timeout: 30000, validateStatus: () => true });
  if (response.status === 429) throw new Error('News endpoint rate limited (429)');
  if (response.status < 200 || response.status >= 300) return [];
  return Array.isArray(response.data) ? response.data : [];
}

async function processNews(universe, apiKey, logger = console) {
  const rows = await fetchLatestNews(apiKey);
  const bySymbol = new Map();
  const universeSet = new Set(universe.map((r) => r.symbol));

  for (const article of rows) {
    const headline = article.title || article.headline || '';
    const symbols = extractSymbols(headline).filter((s) => universeSet.has(s));
    const ts = new Date(article.publishedDate || article.date || Date.now()).getTime();
    const sentiment = scoreSentiment(`${headline} ${article.text || ''}`);

    for (const symbol of symbols) {
      const bucket = bySymbol.get(symbol) || [];
      bucket.push({
        timestamp: ts,
        category: article.site || article.category || 'general',
        headline,
        sentiment,
        source: article.site || article.source || 'unknown',
      });
      bySymbol.set(symbol, bucket);
    }
  }

  const now = Date.now();
  const out = new Map();
  universe.forEach((row) => {
    const items = (bySymbol.get(row.symbol) || []).sort((a, b) => b.timestamp - a.timestamp);
    const latest = items[0];
    const within24h = items.filter((n) => now - n.timestamp <= 24 * 60 * 60 * 1000);
    const sentimentScore = within24h.length
      ? within24h.reduce((acc, n) => acc + n.sentiment, 0) / within24h.length
      : 0;

    out.set(row.symbol, {
      hasRecentNews: Boolean(latest && now - latest.timestamp <= 6 * 60 * 60 * 1000),
      newsRecencyMinutes: latest ? Math.floor((now - latest.timestamp) / 60000) : null,
      newsCount24h: within24h.length,
      newsSentimentScore: sentimentScore,
      newsCategoryTag: latest?.category || null,
      gapWithCatalyst: Boolean(latest),
      latestNews: latest || null,
    });
  });

  logger.info('News processor complete', { symbols: out.size, articles: rows.length });
  return out;
}

module.exports = {
  processNews,
};
