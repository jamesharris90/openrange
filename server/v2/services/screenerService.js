const axios = require('axios');
const { supabaseAdmin } = require('../../services/supabaseClient');
const { fmpFetch } = require('../../services/fmpClient');
const { buildWhy } = require('../engines/whyEngine');

const earningsLookupCache = new Map();
const EARNINGS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const EARNINGS_NONE_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_YAHOO_LOOKUPS_PER_REQUEST = 20;
const yahooClient = axios.create({
  timeout: 1000,
  validateStatus: () => true,
});

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
    catalyst_type: row.catalyst_type || 'NONE',
    sector: row.sector || null,
    updated_at: row.updated_at || null,
    why: row.why || 'Price moving without a clear external catalyst',
    driver_type: row.driver_type || 'TECHNICAL',
    confidence: toNumber(row.confidence) ?? 0.4,
    linked_symbols: Array.isArray(row.linked_symbols) ? row.linked_symbols.filter(Boolean) : [],
  };
}

function resolveCatalystType(row) {
  const now = Date.now();

  if (row.earnings_date) {
    const earningsTime = Date.parse(`${row.earnings_date}T00:00:00Z`);
    if (!Number.isNaN(earningsTime)) {
      const daysDiff = Math.abs(Math.round((earningsTime - now) / 86400000));
      if (daysDiff <= 5) {
        return 'EARNINGS';
      }
    }
  }

  const latestNewsTime = Date.parse(row.latest_news_at || '');
  if (!Number.isNaN(latestNewsTime)) {
    const ageMs = now - latestNewsTime;
    if (ageMs <= 72 * 60 * 60 * 1000) {
      return 'NEWS';
    }

    if (ageMs <= 7 * 24 * 60 * 60 * 1000) {
      return 'RECENT_NEWS';
    }
  }

  if ((row.rvol ?? 0) > 2 && Math.abs(row.change_percent ?? 0) > 5) {
    return 'TECHNICAL';
  }

  return 'NONE';
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

function resolveClosestDate(currentValue, nextValue) {
  if (!nextValue) return currentValue || null;
  if (!currentValue) return nextValue;

  const currentTime = Date.parse(`${currentValue}T00:00:00Z`);
  const nextTime = Date.parse(`${nextValue}T00:00:00Z`);
  if (Number.isNaN(currentTime)) return nextValue;
  if (Number.isNaN(nextTime)) return currentValue;

  const currentDiff = Math.abs(currentTime - Date.now());
  const nextDiff = Math.abs(nextTime - Date.now());
  return nextDiff < currentDiff ? nextValue : currentValue;
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

function getCachedEarningsLookup(symbol) {
  const cached = earningsLookupCache.get(symbol);
  if (!cached) {
    return null;
  }

  if (cached.expiry <= Date.now()) {
    earningsLookupCache.delete(symbol);
    return null;
  }

  return cached.value;
}

function setCachedEarningsLookup(symbol, value) {
  const ttlMs = value.earnings_source === 'none' ? EARNINGS_NONE_CACHE_TTL_MS : EARNINGS_CACHE_TTL_MS;
  earningsLookupCache.set(symbol, {
    value,
    expiry: Date.now() + ttlMs,
  });
}

async function fetchFmpEarnings(symbol) {
  try {
    const payload = await fmpFetch('/earnings', { symbol });
    const rows = Array.isArray(payload) ? payload : payload ? [payload] : [];
    const firstRow = rows.find((row) => row?.date || row?.earningsDate || row?.reportedDate);
    const earningsDate = firstRow?.date || firstRow?.earningsDate || firstRow?.reportedDate || null;

    if (earningsDate) {
      return {
        earnings_date: String(earningsDate).slice(0, 10),
        earnings_source: 'fmp',
      };
    }
  } catch (_error) {
  }

  return null;
}

async function fetchDatabaseEarnings(symbol) {
  const result = await supabaseAdmin
    .from('earnings_events')
    .select('earnings_date')
    .eq('symbol', symbol)
    .not('earnings_date', 'is', null)
    .order('earnings_date', { ascending: false })
    .limit(1);

  if (result.error) {
    throw new Error(result.error.message || 'Failed to load screener earnings_events');
  }

  const earningsDate = result.data?.[0]?.earnings_date || null;
  if (!earningsDate) {
    return null;
  }

  return {
    earnings_date: earningsDate,
    earnings_source: 'database',
  };
}

async function fetchYahooEarnings(symbol) {
  try {
    const response = await yahooClient.get(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`,
      {
        params: { modules: 'calendarEvents' },
      }
    );

    if (response.status < 200 || response.status >= 300) {
      return null;
    }

    const rawDate = response.data?.quoteSummary?.result?.[0]?.calendarEvents?.earnings?.earningsDate?.[0]?.raw;
    if (!rawDate) {
      return null;
    }

    const isoDate = new Date(Number(rawDate) * 1000).toISOString().slice(0, 10);
    return {
      earnings_date: isoDate,
      earnings_source: 'yahoo',
    };
  } catch (_error) {
    return null;
  }
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

async function fetchRecentNewsContext(symbols) {
  const recentNewsBySymbol = new Map();
  const pageSize = 1000;

  if (!symbols.length) {
    return recentNewsBySymbol;
  }

  const cutoffIso = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  let offset = 0;

  while (true) {
    const result = await supabaseAdmin
      .from('news_articles')
      .select('symbol, headline, published_at')
      .in('symbol', symbols)
      .gte('published_at', cutoffIso)
      .not('published_at', 'is', null)
      .not('headline', 'is', null)
      .order('published_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (result.error) {
      throw new Error(result.error.message || 'Failed to load recent screener news context');
    }

    const batch = Array.isArray(result.data) ? result.data : [];
    if (batch.length === 0) {
      break;
    }

    for (const item of batch) {
      const symbol = normalizeSymbol(item.symbol);
      const headline = typeof item.headline === 'string' ? item.headline.trim() : '';
      if (!symbol || !headline || !item.published_at) {
        continue;
      }

      const currentItems = recentNewsBySymbol.get(symbol) || [];
      if (currentItems.length >= 3) {
        continue;
      }

      currentItems.push({
        headline,
        published_at: item.published_at,
      });
      recentNewsBySymbol.set(symbol, currentItems);
    }

    if (batch.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return recentNewsBySymbol;
}

async function fetchDbEarningsContext(symbols) {
  const earningsBySymbol = new Map();

  if (!symbols.length) {
    return earningsBySymbol;
  }

  const result = await supabaseAdmin
    .from('earnings_events')
    .select('symbol, earnings_date')
    .in('symbol', symbols)
    .not('earnings_date', 'is', null)
    .order('earnings_date', { ascending: true });

  if (result.error) {
    throw new Error(result.error.message || 'Failed to load screener earnings context');
  }

  for (const item of result.data || []) {
    const symbol = normalizeSymbol(item.symbol);
    if (!symbol || !item.earnings_date) {
      continue;
    }

    earningsBySymbol.set(
      symbol,
      resolveClosestDate(earningsBySymbol.get(symbol) || null, item.earnings_date)
    );
  }

  return earningsBySymbol;
}

async function fetchEarningsBySymbol(symbols) {
  const earningsBySymbol = new Map();
  let yahooLookups = 0;

  if (!symbols.length) {
    return earningsBySymbol;
  }

  for (const rawSymbol of symbols) {
    const symbol = normalizeSymbol(rawSymbol);
    if (!symbol) {
      continue;
    }

    const cached = getCachedEarningsLookup(symbol);
    if (cached) {
      earningsBySymbol.set(symbol, cached);
      continue;
    }

    const fmpResult = await fetchFmpEarnings(symbol);
    if (fmpResult) {
      setCachedEarningsLookup(symbol, fmpResult);
      earningsBySymbol.set(symbol, fmpResult);
      continue;
    }

    const databaseResult = await fetchDatabaseEarnings(symbol);
    if (databaseResult) {
      setCachedEarningsLookup(symbol, databaseResult);
      earningsBySymbol.set(symbol, databaseResult);
      continue;
    }

    if (yahooLookups < MAX_YAHOO_LOOKUPS_PER_REQUEST) {
      yahooLookups += 1;
      const yahooResult = await fetchYahooEarnings(symbol);
      if (yahooResult) {
        setCachedEarningsLookup(symbol, yahooResult);
        earningsBySymbol.set(symbol, yahooResult);
        continue;
      }
    }

    const noneResult = {
      earnings_date: null,
      earnings_source: 'none',
    };
    setCachedEarningsLookup(symbol, noneResult);
    earningsBySymbol.set(symbol, noneResult);
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
      catalyst_type: 'TECHNICAL',
      sector: quote.sector || null,
      updated_at: quote.updatedAt || quote.timestamp || null,
      why: 'Price moving without a clear external catalyst',
      driver_type: 'TECHNICAL',
      confidence: 0.4,
      linked_symbols: [],
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
  const recentNewsBySymbol = await fetchRecentNewsContext(
    coreRows.map((row) => row.symbol).filter(Boolean)
  );
  const earningsBySymbol = await fetchEarningsBySymbol(
    coreRows.map((row) => row.symbol).filter(Boolean)
  );
  const dbEarningsBySymbol = await fetchDbEarningsContext(
    coreRows.map((row) => row.symbol).filter(Boolean)
  );

  const enrichedRows = coreRows.map((row) => {
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

  const rows = [];
  for (const row of enrichedRows) {
    if (!row.symbol) {
      rows.push(row);
      continue;
    }

    const why = await buildWhy(row.symbol, row, {
      recentNewsBySymbol,
      dbEarningsBySymbol,
      rows: enrichedRows,
    });

    rows.push({
      ...row,
      why: why.why,
      driver_type: why.driver_type,
      confidence: why.confidence,
      linked_symbols: why.linked_symbols || [],
    });
  }

  const newsSourceCounts = rows.reduce((accumulator, row) => {
    accumulator[row.news_source] = (accumulator[row.news_source] || 0) + 1;
    return accumulator;
  }, {});
  const earningsSourceCounts = rows.reduce((accumulator, row) => {
    accumulator[row.earnings_source] = (accumulator[row.earnings_source] || 0) + 1;
    return accumulator;
  }, {});
  const driverTypeCounts = rows.reduce((accumulator, row) => {
    accumulator[row.driver_type] = (accumulator[row.driver_type] || 0) + 1;
    return accumulator;
  }, {});

  console.log('[SCREENER_V2] fallback sources', {
    news: newsSourceCounts,
    earnings: earningsSourceCounts,
    earnings_sources_summary: earningsSourceCounts,
    driver_types: driverTypeCounts,
  });

  if ((newsSourceCounts.none || 0) > 20) {
    console.warn('[SCREENER_V2] news none rows exceed threshold', {
      none: newsSourceCounts.none,
      news_sources_summary: newsSourceCounts,
    });
  }

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