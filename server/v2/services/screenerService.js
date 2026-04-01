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
    sector: row.sector || null,
    updated_at: row.updated_at || null,
  };
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

  const metricsBySymbol = new Map((metricsResult.data || []).map((row) => [row.symbol, row]));
  const sipBySymbol = new Map((sipResult.data || []).map((row) => [row.symbol, row]));
  const sectorBySymbol = new Map((universeResult.data || []).map((row) => [row.symbol, row]));

  const rows = quoteRows
    .map((quote) => {
      const metrics = metricsBySymbol.get(quote.symbol) || {};
      const stocksInPlay = sipBySymbol.get(quote.symbol) || {};
      const universe = sectorBySymbol.get(quote.symbol) || {};

      return normalizeScreenerRow({
        symbol: quote.symbol,
        price: quote.price ?? metrics.price ?? null,
        change_percent: quote.change_percent ?? metrics.change_percent ?? null,
        volume: quote.volume ?? metrics.volume ?? null,
        rvol: quote.relative_volume ?? stocksInPlay.rvol ?? metrics.relative_volume ?? null,
        gap_percent: stocksInPlay.gap_percent ?? metrics.gap_percent ?? null,
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