const axios = require('axios');
const logger = require('../logger');
const { pool } = require('../db/pg');
const { normalizeSymbol, mapToProviderSymbol, mapFromProviderSymbol } = require('../utils/symbolMap');

const FMP_PROFILE_ENDPOINT = 'https://financialmodelingprep.com/stable/profile';
const FMP_STOCK_LIST_ENDPOINT = 'https://financialmodelingprep.com/stable/stock-list';
const FMP_QUOTE_ENDPOINT = 'https://financialmodelingprep.com/stable/quote';

const ACTIVE_UNIVERSE_LIMIT = 3000;
const REFRESH_UNIVERSE_LIMIT = 2000;
const QUOTE_BATCH_SIZE = 100;
const REQUEST_DELAY_MS = 500;
const RATE_LIMIT_BASE_BACKOFF_MS = 2000;
const MAX_429_RETRIES = 3;
const PROFILE_SCAN_LIMIT = 5000;

const ingestionState = {
  lastConnectivityOk: null,
  lastUniverseSize: 0,
  lastActiveUniverseSize: 0,
  lastUniverseLatencyMs: 0,
  activeSymbols: [],
  sectorBySymbol: {},
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function asInteger(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.trunc(num);
}

function chunkArray(items, chunkSize) {
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

async function requestWithRateLimitBackoff(url, options = {}) {
  let attempt = 0;

  while (attempt <= MAX_429_RETRIES) {
    try {
      return await axios.get(url, options);
    } catch (error) {
      const status = Number(error?.response?.status) || null;
      if (status !== 429 || attempt === MAX_429_RETRIES) {
        throw error;
      }

      const waitMs = RATE_LIMIT_BASE_BACKOFF_MS * (2 ** attempt);
      logger.warn('FMP rate limited, backing off', {
        status,
        attempt: attempt + 1,
        waitMs,
      });
      await sleep(waitMs);
      attempt += 1;
    }
  }

  throw new Error('FMP request failed after rate-limit backoff retries');
}

async function validateFmpConnectivity(fmpApiKey) {
  const url = `${FMP_PROFILE_ENDPOINT}?symbol=AAPL&apikey=${encodeURIComponent(fmpApiKey)}`;
  try {
    const startedAt = Date.now();
    const response = await requestWithRateLimitBackoff(url, { timeout: 20000 });
    const latencyMs = Date.now() - startedAt;
    if (response.status !== 200) {
      logger.error('FMP API connectivity failure', { status: response.status, endpoint: 'stable/profile', latencyMs });
      ingestionState.lastConnectivityOk = false;
      return false;
    }

    ingestionState.lastConnectivityOk = true;
    return true;
  } catch (error) {
    logger.error('FMP API connectivity failure', {
      endpoint: 'stable/profile',
      status: Number(error?.response?.status) || null,
      error: error.message,
    });
    ingestionState.lastConnectivityOk = false;
    return false;
  }
}

async function fetchSymbolUniverse(fmpApiKey) {
  const url = `${FMP_STOCK_LIST_ENDPOINT}?apikey=${encodeURIComponent(fmpApiKey)}`;
  const startedAt = Date.now();
  const response = await requestWithRateLimitBackoff(url, { timeout: 60000 });
  const stockListLatencyMs = Date.now() - startedAt;
  const rows = Array.isArray(response.data) ? response.data : [];

  const candidateSymbols = [...new Set(
    rows
      .map((row) => String(row?.symbol || '').trim().toUpperCase())
      .filter((symbol) => /^[A-Z]{1,5}$/.test(symbol))
  )];

  const activeSymbols = [];
  const sectorBySymbol = {};
  let profileLatencyMs = 0;
  const profileCandidates = candidateSymbols.slice(0, PROFILE_SCAN_LIMIT);
  const profileChunks = chunkArray(profileCandidates, 10);

  for (let index = 0; index < profileChunks.length; index += 1) {
    const chunk = profileChunks[index];
    const results = await Promise.allSettled(
      chunk.map(async (symbol) => {
        const profileUrl = `${FMP_PROFILE_ENDPOINT}?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(fmpApiKey)}`;
        const profileStartedAt = Date.now();
        const profileResponse = await requestWithRateLimitBackoff(profileUrl, { timeout: 20000 });
        profileLatencyMs += Date.now() - profileStartedAt;
        const profile = Array.isArray(profileResponse.data) ? profileResponse.data[0] : null;
        if (!profile) return null;

        const exchange = String(profile.exchange || '').toUpperCase();
        const isEtf = Boolean(profile.isEtf);
        const isFund = Boolean(profile.isFund);
        const isActivelyTrading = profile.isActivelyTrading !== false;

        if ((exchange === 'NASDAQ' || exchange === 'NYSE') && !isEtf && !isFund && isActivelyTrading) {
          return {
            symbol,
            sector: typeof profile.sector === 'string' ? profile.sector : null,
          };
        }

        return null;
      })
    );

    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue;
      const { symbol, sector } = result.value;
      activeSymbols.push(symbol);
      if (sector) {
        sectorBySymbol[symbol] = sector;
      }
      if (activeSymbols.length >= ACTIVE_UNIVERSE_LIMIT) break;
    }

    if (activeSymbols.length >= ACTIVE_UNIVERSE_LIMIT) break;

    if (index < profileChunks.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  const latencyMs = stockListLatencyMs + profileLatencyMs;
  ingestionState.lastUniverseSize = candidateSymbols.length;
  ingestionState.lastUniverseLatencyMs = latencyMs;
  ingestionState.activeSymbols = activeSymbols;
  ingestionState.sectorBySymbol = sectorBySymbol;

  logger.info('FMP universe loaded and filtered', {
    endpoint: 'stable/stock-list',
    candidates: candidateSymbols.length,
    scanned: profileCandidates.length,
    symbols: activeSymbols.length,
    stockListLatencyMs,
    profileLatencyMs,
    latencyMs,
  });

  return {
    symbols: activeSymbols,
    sectorBySymbol,
  };
}

async function fetchQuotesBatch(fmpApiKey, symbols) {
  const canonicalSymbols = symbols.map((symbol) => mapFromProviderSymbol(normalizeSymbol(symbol))).filter(Boolean);
  const providerSymbols = canonicalSymbols.map((symbol) => mapToProviderSymbol(symbol));
  const symbolsParam = providerSymbols.join(',');
  const batchUrl = `${FMP_QUOTE_ENDPOINT}?symbol=${encodeURIComponent(symbolsParam)}&apikey=${encodeURIComponent(fmpApiKey)}`;

  const fetchSingleSymbolQuotes = async () => {
    const rows = [];
    let latencyMs = 0;
    const groups = chunkArray(providerSymbols, 10);

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex];
      const results = await Promise.allSettled(
        group.map(async (symbol) => {
          const url = `${FMP_QUOTE_ENDPOINT}?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(fmpApiKey)}`;
          const startedAt = Date.now();
          try {
            const response = await requestWithRateLimitBackoff(url, { timeout: 20000 });
            latencyMs += Date.now() - startedAt;
            return Array.isArray(response.data) ? response.data : [];
          } catch (error) {
            throw error;
          }
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          rows.push(...result.value);
        }
      }

      if (groupIndex < groups.length - 1) {
        await sleep(REQUEST_DELAY_MS);
      }
    }

    return { rows, latencyMs, fallbackUsed: true };
  };

  try {
    const startedAt = Date.now();
    const response = await requestWithRateLimitBackoff(batchUrl, { timeout: 30000 });
    const latencyMs = Date.now() - startedAt;
    const rows = Array.isArray(response.data) ? response.data : [];

    if (rows.length === 0 && symbols.length > 1) {
      return fetchSingleSymbolQuotes();
    }

    return { rows, latencyMs, fallbackUsed: false };
  } catch (error) {
    const status = Number(error?.response?.status) || null;
    if (symbols.length > 1 && (status === 400 || status === 429)) {
      return fetchSingleSymbolQuotes();
    }
    throw error;
  }
}

async function upsertQuoteRows(rows) {
  if (!rows.length) return 0;

  const symbols = rows.map((row) => row.symbol);
  const prices = rows.map((row) => row.price);
  const changes = rows.map((row) => row.changePercent);
  const volumes = rows.map((row) => row.volume);
  const marketCaps = rows.map((row) => row.marketCap);
  const sectors = rows.map((row) => row.sector);

  await pool.query(
    `INSERT INTO market_quotes (symbol, price, change_percent, volume, market_cap, sector, updated_at)
     SELECT *
     FROM (
       SELECT
         unnest($1::text[]) AS symbol,
         unnest($2::numeric[]) AS price,
         unnest($3::numeric[]) AS change_percent,
         unnest($4::bigint[]) AS volume,
         unnest($5::bigint[]) AS market_cap,
         unnest($6::text[]) AS sector,
         now() AS updated_at
     ) incoming
     ON CONFLICT(symbol)
     DO UPDATE SET
       price = EXCLUDED.price,
       change_percent = EXCLUDED.change_percent,
       volume = EXCLUDED.volume,
       market_cap = EXCLUDED.market_cap,
       sector = EXCLUDED.sector,
       updated_at = now()`,
    [symbols, prices, changes, volumes, marketCaps, sectors]
  );

  return rows.length;
}

function normalizeQuoteRows(rows, sectorBySymbol = {}) {
  return rows
    .map((row) => ({
      symbol: mapFromProviderSymbol(normalizeSymbol(row?.symbol)),
      price: asNumber(row?.price),
      changePercent: asNumber(row?.changesPercentage ?? row?.change),
      volume: asInteger(row?.volume),
      marketCap: asInteger(row?.marketCap),
      sector:
        (typeof row?.sector === 'string' && row.sector) ||
        (typeof sectorBySymbol[mapFromProviderSymbol(normalizeSymbol(row?.symbol))] === 'string'
          ? sectorBySymbol[mapFromProviderSymbol(normalizeSymbol(row?.symbol))]
          : null),
      timestamp: row?.timestamp || null,
    }))
    .filter((row) => row.symbol);
}

async function ingestSymbols(fmpApiKey, symbols, mode, sectorBySymbol = {}) {
  const batches = chunkArray(symbols, QUOTE_BATCH_SIZE);
  const startedAt = Date.now();

  let symbolsProcessed = 0;
  let rowsInserted = 0;
  let totalApiLatencyMs = 0;

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const { rows, latencyMs, fallbackUsed } = await fetchQuotesBatch(fmpApiKey, batch);
    totalApiLatencyMs += latencyMs;

    const normalized = normalizeQuoteRows(rows, sectorBySymbol);
    const inserted = await upsertQuoteRows(normalized);

    symbolsProcessed += batch.length;
    rowsInserted += inserted;

    if (fallbackUsed) {
      logger.info('Stable quote fallback used for batch', {
        mode,
        batchIndex: index,
        batchSize: batch.length,
        returnedRows: rows.length,
      });
    }

    if (index < batches.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  const runtimeMs = Date.now() - startedAt;
  logger.info('Ingestion complete', {
    mode,
    symbolsProcessed,
    rowsInserted,
    apiLatencyMs: totalApiLatencyMs,
    runtimeMs,
  });

  return {
    mode,
    symbolsProcessed,
    rowsInserted,
    apiLatencyMs: totalApiLatencyMs,
    runtimeMs,
  };
}

async function ingestMarketQuotesBootstrap() {
  const fmpApiKey = process.env.FMP_API_KEY;
  if (!fmpApiKey || fmpApiKey === 'REQUIRED') {
    logger.warn('FMP_API_KEY missing – ingestion disabled');
    return {
      mode: 'bootstrap',
      symbolsProcessed: 0,
      rowsInserted: 0,
      apiLatencyMs: 0,
      runtimeMs: 0,
      skipped: true,
      reason: 'missing_fmp_api_key',
    };
  }

  logger.info('Bootstrap started');
  const bootstrapStartedAt = Date.now();

  await validateFmpConnectivity(fmpApiKey);

  const universe = await fetchSymbolUniverse(fmpApiKey);
  const activeUniverse = universe.symbols.slice(0, ACTIVE_UNIVERSE_LIMIT);
  ingestionState.lastActiveUniverseSize = activeUniverse.length;

  const result = await ingestSymbols(fmpApiKey, activeUniverse, 'bootstrap', universe.sectorBySymbol);
  logger.info(`Symbols processed: ${result.symbolsProcessed}`);
  logger.info(`Rows inserted: ${result.rowsInserted}`);
  logger.info('Bootstrap complete', {
    durationMs: Date.now() - bootstrapStartedAt,
  });

  return result;
}

async function ingestMarketQuotesRefresh() {
  const fmpApiKey = process.env.FMP_API_KEY;
  if (!fmpApiKey || fmpApiKey === 'REQUIRED') {
    logger.warn('FMP_API_KEY missing – ingestion disabled');
    return {
      mode: 'refresh',
      symbolsProcessed: 0,
      rowsInserted: 0,
      apiLatencyMs: 0,
      runtimeMs: 0,
      skipped: true,
      reason: 'missing_fmp_api_key',
    };
  }

  const { rows } = await pool.query(
    `SELECT symbol
     FROM market_quotes
     WHERE symbol IS NOT NULL AND symbol <> ''
     ORDER BY volume DESC NULLS LAST, updated_at DESC NULLS LAST
     LIMIT $1`,
    [REFRESH_UNIVERSE_LIMIT]
  );

  const topByVolume = rows.map((row) => String(row.symbol || '').trim().toUpperCase()).filter(Boolean);
  let activeUniverse = ingestionState.activeSymbols;
  if (!Array.isArray(activeUniverse) || !activeUniverse.length) {
    const universe = await fetchSymbolUniverse(fmpApiKey);
    activeUniverse = universe.symbols;
  }

  const activeSet = new Set(activeUniverse);
  const filtered = topByVolume.filter((symbol) => activeSet.has(symbol));
  const refill = activeUniverse.filter((symbol) => !filtered.includes(symbol));
  const symbols = [...filtered, ...refill].slice(0, REFRESH_UNIVERSE_LIMIT);

  if (!symbols.length) {
    logger.warn('Refresh universe empty; running bootstrap ingestion fallback');
    return ingestMarketQuotesBootstrap();
  }

  return ingestSymbols(fmpApiKey, symbols, 'refresh', ingestionState.sectorBySymbol || {});
}

function getIngestionState() {
  return {
    ...ingestionState,
    activeUniverseLimit: ACTIVE_UNIVERSE_LIMIT,
    refreshUniverseLimit: REFRESH_UNIVERSE_LIMIT,
    batchSize: QUOTE_BATCH_SIZE,
    requestDelayMs: REQUEST_DELAY_MS,
  };
}

module.exports = {
  validateFmpConnectivity,
  fetchSymbolUniverse,
  ingestMarketQuotesBootstrap,
  ingestMarketQuotesRefresh,
  getIngestionState,
};
