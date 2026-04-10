const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { queryWithTimeout, pool } = require('../db/pg');

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch (_error) {
    body = text;
  }
  return {
    status: response.status,
    body,
  };
}

async function run() {
  const queries = {
    ticker_universe_columns: "SELECT column_name FROM information_schema.columns WHERE table_name = 'ticker_universe' ORDER BY ordinal_position",
    shell_count: "SELECT COUNT(*)::int AS count FROM ticker_universe WHERE industry ILIKE '%shell%' OR industry ILIKE '%blank%' OR industry ILIKE '%acquisition%'",
    fs_industries: "SELECT industry, COUNT(*)::int AS count FROM ticker_universe WHERE sector = 'Financial Services' GROUP BY industry ORDER BY count DESC LIMIT 25",
    market_quotes_columns: "SELECT column_name FROM information_schema.columns WHERE table_name = 'market_quotes' ORDER BY ordinal_position",
    market_metrics_columns: "SELECT column_name FROM information_schema.columns WHERE table_name = 'market_metrics' ORDER BY ordinal_position",
  };

  const db = {};
  for (const [key, sql] of Object.entries(queries)) {
    const result = await queryWithTimeout(sql, [], {
      timeoutMs: 15000,
      label: `premarket_screener_audit.${key}`,
      maxRetries: 0,
    });
    db[key] = result.rows;
  }

  const apiKey = process.env.FMP_API_KEY;
  const fmp = {
    prePostMarketTrade: await fetchJson(`https://financialmodelingprep.com/stable/pre-post-market-trade/AAPL?apikey=${apiKey}`),
    quote: await fetchJson(`https://financialmodelingprep.com/stable/quote/AAPL?apikey=${apiKey}`),
  };

  console.log(JSON.stringify({ db, fmp }, null, 2));
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });