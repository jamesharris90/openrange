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
    news_source: row.news_source || 'none',
    earnings_date: row.earnings_date || null,
    earnings_source: row.earnings_source || 'none',
    catalyst_type: row.catalyst_type || 'UNKNOWN',
    sector: row.sector || null,
    updated_at: row.updated_at || null,
  };
}

function resolveCatalystType(row) {
  const now = Date.now();
  const latestNewsTime = Date.parse(row.latest_news_at || '');
  if (!Number.isNaN(latestNewsTime) && now - latestNewsTime < 24 * 60 * 60 * 1000) {
    return 'NEWS';
  }

  if (row.earnings_date) {
    const earningsTime = Date.parse(`${row.earnings_date}T00:00:00Z`);
    if (!Number.isNaN(earningsTime)) {
      const daysDiff = Math.abs(Math.round((earningsTime - now) / 86400000));
      if (daysDiff <= 3) {
        return 'EARNINGS';
      }
    }
  }

  if ((row.rvol ?? 0) > 2 && Math.abs(row.change_percent ?? 0) > 5) {
    return 'TECHNICAL';
  }

  return 'UNKNOWN';
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

async function fetchLatestNewsBySymbol(symbols) {
  const latestNewsBySymbol = new Map();
  const pageSize = 1000;

  if (!symbols.length) {
    return latestNewsBySymbol;
  }

  const newsPasses = [
    {
      sourceLabel: 'fmp',
      applySourceType: true,
    },
    {
      sourceLabel: 'database',
      applySourceType: false,
    },
  ];

  for (const pass of newsPasses) {
    let offset = 0;

    while (latestNewsBySymbol.size < symbols.length) {
      let query = supabaseAdmin
        .from('news_articles')
        .select('symbol, headline, published_at, source_type')
        .in('symbol', symbols)
        .not('published_at', 'is', null)
        .not('headline', 'is', null)
        .order('published_at', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (pass.applySourceType) {
        query = query.eq('source_type', 'FMP');
      }

      const result = await query;
      if (result.error) {
        throw new Error(result.error.message || 'Failed to load screener news_articles');
      }

      const batch = Array.isArray(result.data) ? result.data : [];
      if (batch.length === 0) {
        break;
      }

      for (const row of batch) {
        const symbol = normalizeSymbol(row.symbol);
        const headline = typeof row.headline === 'string' ? row.headline.trim() : '';
        if (!symbol || latestNewsBySymbol.has(symbol) || !row.published_at || !headline) {
          continue;
        }

        latestNewsBySymbol.set(symbol, {
          latest_news_at: row.published_at,
          news_source: pass.sourceLabel,
        });
      }

      if (batch.length < pageSize) {
        break;
      }

      offset += pageSize;
    }
  }

  return latestNewsBySymbol;
}

async function fetchEarningsBySymbol(symbols) {
  const earningsBySymbol = new Map();
  const pageSize = 1000;

  if (!symbols.length) {
    return earningsBySymbol;
  }

  const earningsPasses = [
    {
      sourceLabel: 'fmp',
      ascending: true,
      filterFuture: true,
    },
    {
      sourceLabel: 'database',
      ascending: false,
      filterFuture: false,
    },
  ];

  for (const pass of earningsPasses) {
    let offset = 0;
    let queryDate = new Date().toISOString().slice(0, 10);

    while (earningsBySymbol.size < symbols.length) {
      let query = supabaseAdmin
        .from('earnings_events')
        .select('symbol, earnings_date')
        .in('symbol', symbols)
        .not('earnings_date', 'is', null)
        .order('earnings_date', { ascending: pass.ascending })
        .range(offset, offset + pageSize - 1);

      if (pass.filterFuture) {
        query = query.gte('earnings_date', queryDate);
      }

      const result = await query;
      if (result.error) {
        throw new Error(result.error.message || 'Failed to load screener earnings_events');
      }

      const batch = Array.isArray(result.data) ? result.data : [];
      if (batch.length === 0) {
        break;
      }

      for (const row of batch) {
        const symbol = normalizeSymbol(row.symbol);
        if (!symbol || earningsBySymbol.has(symbol) || !row.earnings_date) {
          continue;
        }

        earningsBySymbol.set(symbol, {
          earnings_date: row.earnings_date,
          earnings_source: pass.sourceLabel,
        });
      }

      if (batch.length < pageSize) {
        break;
      }

      offset += pageSize;
    }
  }

  return earningsBySymbol;
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
      news_source: 'none',
      earnings_date: null,
      earnings_source: 'none',
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

  const coreRows = quoteRows
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
        latest_news_at: null,
        news_source: 'none',
        earnings_date: null,
        earnings_source: 'none',
        sector: quote.sector ?? universe.sector ?? null,
        updated_at: quote.updated_at ?? metrics.updated_at ?? metrics.last_updated ?? stocksInPlay.detected_at ?? null,
      });
    })
    .filter((row) => row.symbol && row.price !== null && row.price > 0 && row.volume !== null && row.volume > 0)
    .sort((left, right) => {
      const rightRvol = right.rvol ?? -1;
      const leftRvol = left.rvol ?? -1;
      if (rightRvol !== leftRvol) return rightRvol - leftRvol;
      const rightAbsChange = Math.abs(right.change_percent ?? 0);
      const leftAbsChange = Math.abs(left.change_percent ?? 0);
      if (rightAbsChange !== leftAbsChange) return rightAbsChange - leftAbsChange;
      if ((right.volume ?? 0) !== (left.volume ?? 0)) return (right.volume ?? 0) - (left.volume ?? 0);
      return String(left.symbol).localeCompare(String(right.symbol));
    })
    .slice(0, 100);

  const latestNewsBySymbol = await fetchLatestNewsBySymbol(
    coreRows.map((row) => row.symbol).filter(Boolean)
  );
  const earningsBySymbol = await fetchEarningsBySymbol(
    coreRows.map((row) => row.symbol).filter(Boolean)
  );

  const rows = coreRows.map((row) => {
    if (!row.symbol) {
      return row;
    }

    return {
      ...row,
      latest_news_at: latestNewsBySymbol.get(row.symbol)?.latest_news_at || null,
      news_source: latestNewsBySymbol.get(row.symbol)?.news_source || 'none',
      earnings_date: earningsBySymbol.get(row.symbol)?.earnings_date || null,
      earnings_source: earningsBySymbol.get(row.symbol)?.earnings_source || 'none',
      catalyst_type: resolveCatalystType({
        ...row,
        latest_news_at: latestNewsBySymbol.get(row.symbol)?.latest_news_at || null,
        earnings_date: earningsBySymbol.get(row.symbol)?.earnings_date || null,
      }),
    };
  });

  const newsSourceCounts = rows.reduce((accumulator, row) => {
    accumulator[row.news_source] = (accumulator[row.news_source] || 0) + 1;
    return accumulator;
  }, {});
  const earningsSourceCounts = rows.reduce((accumulator, row) => {
    accumulator[row.earnings_source] = (accumulator[row.earnings_source] || 0) + 1;
    return accumulator;
  }, {});

  console.log('[SCREENER_V2] fallback sources', {
    news: newsSourceCounts,
    earnings: earningsSourceCounts,
  });

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