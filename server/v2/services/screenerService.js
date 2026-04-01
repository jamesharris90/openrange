const axios = require('axios');
const { supabaseAdmin } = require('../../services/supabaseClient');

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeScreenerRow(row) {
  return {
    symbol: row.symbol || null,
    price: toNumber(row.price),
    change_percent: toNumber(row.change_percent),
    volume: toNumber(row.volume),
    rvol: toNumber(row.rvol),
    gap_percent: toNumber(row.gap_percent),
    latest_news_at: row.latest_news_at || null,
    earnings_date: row.earnings_date || null,
    sector: row.sector || null,
    updated_at: row.updated_at || null,
  };
}

function normalizeSymbol(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null;
}

function resolveLatestTimestamp(currentValue, nextValue) {
  if (!nextValue) return currentValue || null;
  if (!currentValue) return nextValue;

  const currentTime = Date.parse(currentValue);
  const nextTime = Date.parse(nextValue);
  if (Number.isNaN(nextTime)) return currentValue;
  if (Number.isNaN(currentTime)) return nextValue;
  return nextTime > currentTime ? nextValue : currentValue;
}

function resolveEarliestDate(currentValue, nextValue) {
  if (!nextValue) return currentValue || null;
  if (!currentValue) return nextValue;
  return nextValue < currentValue ? nextValue : currentValue;
}

function dedupeBySymbol(rows) {
  const seen = new Set();
  const deduped = [];

  for (const row of rows) {
    if (!row?.symbol || seen.has(row.symbol)) continue;
    seen.add(row.symbol);
    deduped.push(row);
  }

  return deduped;
}

async function fetchStableFallbackQuote() {
  if (!process.env.FMP_API_KEY) {
    return [];
  }

  const response = await axios.get('https://financialmodelingprep.com/stable/quote', {
    params: {
      symbol: 'AAPL',
      apikey: process.env.FMP_API_KEY,
    },
    timeout: 8000,
  });

  const rows = Array.isArray(response.data) ? response.data : [];
  if (rows.length === 0) {
    return [];
  }

  const quote = rows[0] || {};
  return [
    {
      symbol: quote.symbol || null,
      price: toNumber(quote.price),
      change_percent: toNumber(
        quote.changePercent ?? quote.change_percent ?? quote.changesPercentage ?? null
      ),
      volume: toNumber(quote.volume),
      rvol: null,
      gap_percent: null,
      latest_news_at: null,
      earnings_date: null,
      sector: quote.sector || null,
      updated_at: quote.updatedAt || quote.timestamp || null,
    },
  ].filter((row) => row.symbol && row.price !== null && row.volume !== null);
}

async function getScreenerRows() {
  if (!supabaseAdmin) {
    throw new Error('Supabase admin client unavailable');
  }

  const quotesResult = await supabaseAdmin
    .from('market_quotes')
    .select('symbol, price, change_percent, volume, relative_volume, sector, updated_at')
    .gt('price', 0)
    .gt('volume', 0)
    .order('volume', { ascending: false })
    .limit(300);

  if (quotesResult.error) {
    throw new Error(quotesResult.error.message || 'Failed to load market quotes');
  }

  const quoteRows = dedupeBySymbol((quotesResult.data || []).map((row) => ({
    symbol: row.symbol,
    price: row.price,
    change_percent: row.change_percent,
    volume: row.volume,
    relative_volume: row.relative_volume,
    sector: row.sector,
    updated_at: row.updated_at,
  })));

  if (quoteRows.length === 0) {
    const fallbackRows = await fetchStableFallbackQuote();
    return {
      rows: fallbackRows,
      fallbackUsed: fallbackRows.length > 0,
    };
  }

  const symbols = quoteRows.map((row) => row.symbol).filter(Boolean);

  const metricsResult = await supabaseAdmin
    .from('market_metrics')
    .select('symbol, price, change_percent, volume, gap_percent, relative_volume, updated_at, last_updated')
    .in('symbol', symbols);

  if (metricsResult.error) {
    throw new Error(metricsResult.error.message || 'Failed to load market metrics');
  }

  const sipResult = await supabaseAdmin
    .from('stocks_in_play')
    .select('symbol, gap_percent, rvol, detected_at')
    .in('symbol', symbols);

  if (sipResult.error) {
    throw new Error(sipResult.error.message || 'Failed to load stocks in play');
  }

  const universeResult = await supabaseAdmin
    .from('ticker_universe')
    .select('symbol, sector')
    .in('symbol', symbols);

  if (universeResult.error) {
    throw new Error(universeResult.error.message || 'Failed to load ticker universe');
  }

  const newsCutoff = new Date(Date.now() - (72 * 60 * 60 * 1000)).toISOString();

  const newsArticlesResult = await supabaseAdmin
    .from('news_articles')
    .select('symbol, headline, published_at')
    .in('symbol', symbols)
    .gte('published_at', newsCutoff)
    .not('headline', 'is', null)
    .order('published_at', { ascending: false })
    .limit(500);

  if (newsArticlesResult.error) {
    throw new Error(newsArticlesResult.error.message || 'Failed to load screener news_articles');
  }

  const intelNewsResult = await supabaseAdmin
    .from('intel_news')
    .select('symbol, headline, source, published_at')
    .in('symbol', symbols)
    .gte('published_at', newsCutoff)
    .not('headline', 'is', null)
    .neq('source', 'earnings_events')
    .order('published_at', { ascending: false })
    .limit(500);

  if (intelNewsResult.error) {
    throw new Error(intelNewsResult.error.message || 'Failed to load screener intel_news');
  }

  const todayDate = new Date().toISOString().slice(0, 10);

  const earningsResult = await supabaseAdmin
    .from('earnings_events')
    .select('symbol, earnings_date, report_date')
    .in('symbol', symbols)
    .gte('report_date', todayDate)
    .order('report_date', { ascending: true })
    .limit(300);

  if (earningsResult.error) {
    throw new Error(earningsResult.error.message || 'Failed to load screener earnings_events');
  }

  const metricsBySymbol = new Map((metricsResult.data || []).map((row) => [row.symbol, row]));
  const sipBySymbol = new Map((sipResult.data || []).map((row) => [row.symbol, row]));
  const sectorBySymbol = new Map((universeResult.data || []).map((row) => [row.symbol, row]));
  const latestNewsBySymbol = new Map();
  const earningsBySymbol = new Map();

  for (const row of newsArticlesResult.data || []) {
    const symbol = normalizeSymbol(row.symbol);
    const headline = typeof row.headline === 'string' ? row.headline.trim() : '';
    if (!symbol || !headline || !row.published_at) continue;
    latestNewsBySymbol.set(symbol, resolveLatestTimestamp(latestNewsBySymbol.get(symbol), row.published_at));
  }

  for (const row of intelNewsResult.data || []) {
    const symbol = normalizeSymbol(row.symbol);
    const headline = typeof row.headline === 'string' ? row.headline.trim() : '';
    if (!symbol || !headline || !row.published_at) continue;
    if (/\bearnings event\b/i.test(headline)) continue;
    latestNewsBySymbol.set(symbol, resolveLatestTimestamp(latestNewsBySymbol.get(symbol), row.published_at));
  }

  for (const row of earningsResult.data || []) {
    const symbol = normalizeSymbol(row.symbol);
    const earningsDate = row.earnings_date || row.report_date || null;
    if (!symbol || !earningsDate) continue;
    earningsBySymbol.set(symbol, resolveEarliestDate(earningsBySymbol.get(symbol), earningsDate));
  }

  const rows = quoteRows
    .map((quote) => {
      const metrics = metricsBySymbol.get(quote.symbol) || {};
      const stocksInPlay = sipBySymbol.get(quote.symbol) || {};
      const universe = sectorBySymbol.get(quote.symbol) || {};
      const symbol = normalizeSymbol(quote.symbol);

      return normalizeScreenerRow({
        symbol,
        price: quote.price ?? metrics.price ?? null,
        change_percent: quote.change_percent ?? metrics.change_percent ?? null,
        volume: quote.volume ?? metrics.volume ?? null,
        rvol: quote.relative_volume ?? stocksInPlay.rvol ?? metrics.relative_volume ?? null,
        gap_percent: stocksInPlay.gap_percent ?? metrics.gap_percent ?? null,
        latest_news_at: symbol ? latestNewsBySymbol.get(symbol) || null : null,
        earnings_date: symbol ? earningsBySymbol.get(symbol) || null : null,
        sector: quote.sector ?? universe.sector ?? null,
        updated_at: quote.updated_at ?? metrics.updated_at ?? metrics.last_updated ?? stocksInPlay.detected_at ?? null,
      });
    })
    .filter((row) => row.symbol && row.price !== null && row.price > 0 && row.volume !== null && row.volume > 0)
    .sort((left, right) => {
      const rightRvol = right.rvol ?? -1;
      const leftRvol = left.rvol ?? -1;
      if (rightRvol !== leftRvol) return rightRvol - leftRvol;
      if ((right.volume ?? 0) !== (left.volume ?? 0)) return (right.volume ?? 0) - (left.volume ?? 0);
      return String(left.symbol).localeCompare(String(right.symbol));
    })
    .slice(0, 100);

  if (rows.length > 0) {
    return {
      rows,
      fallbackUsed: false,
    };
  }

  const fallbackRows = await fetchStableFallbackQuote();
  return {
    rows: fallbackRows,
    fallbackUsed: fallbackRows.length > 0,
  };
}

module.exports = {
  getScreenerRows,
};