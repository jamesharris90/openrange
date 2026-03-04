const { symbolsFromEnv, runIngestionJob } = require('./_helpers');

function normalizeNews(payload, symbol) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .map((row) => ({
      symbol,
      headline: row.title || row.headline || '',
      source: row.site || row.source || 'FMP',
      url: row.url || null,
      published_at: row.publishedDate || row.published_at || row.date || null,
    }))
    .filter((row) => row.headline && row.published_at);
}

async function runNewsIngestion(symbols = symbolsFromEnv()) {
  return runIngestionJob({
    jobName: 'fmp_news_ingest',
    endpointBuilder: (symbol) => `/stock_news?tickers=${encodeURIComponent(symbol)}&limit=100`,
    normalize: normalizeNews,
    table: 'news_articles',
    conflictTarget: 'symbol,url,published_at',
    symbols,
  });
}

module.exports = {
  runNewsIngestion,
};
