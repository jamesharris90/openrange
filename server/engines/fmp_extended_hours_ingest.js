const axios = require('axios');
const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

const FMP_AFTERMARKET_QUOTE_ENDPOINT = 'https://financialmodelingprep.com/stable/aftermarket-quote';
const MAX_EXTENDED_SYMBOLS = 150;
const WATCHLIST_SOURCE_LIMIT = 200;
const SYMBOL_THROTTLE_MS = 70;
const MAX_SYMBOLS_PER_BATCH = 10;
const BATCH_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 12000;
const DAILY_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

const bars = {};
const trackedSymbols = new Set();

let lastCleanupRunAt = 0;
let activeTrackedSession = null;
let extendedSchemaInitPromise = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

function resolveSessionFromEtDate() {
  const now = new Date();

  // Convert to US Eastern Time (same timezone as FMP data)
  const estTime = new Date(
    now.toLocaleString('en-US', { timeZone: 'America/New_York' })
  );

  const hours = estTime.getHours();
  const minutes = estTime.getMinutes();
  const totalMinutes = (hours * 60) + minutes;

  let session = 'closed';

  // Premarket: 04:00 -> 09:29 ET
  if (totalMinutes >= (4 * 60) && totalMinutes < ((9 * 60) + 30) ) {
    session = 'premarket';
  }

  // Regular: 09:30 -> 15:59 ET
  else if (totalMinutes >= ((9 * 60) + 30) && totalMinutes < (16 * 60)) {
    session = 'regular';
  }

  // Postmarket: 16:00 -> 20:00 ET
  else if (totalMinutes >= (16 * 60) && totalMinutes <= (20 * 60)) {
    session = 'postmarket';
  }

  return {
    session,
    estTime,
  };
}

async function ensureIntradaySessionSchema() {
  await queryWithTimeout(
    `ALTER TABLE intraday_1m
     ADD COLUMN IF NOT EXISTS session TEXT DEFAULT 'regular'`,
    [],
    { timeoutMs: 10000, maxRetries: 0, label: 'extended_hours.ensure_session_column' }
  );

  await queryWithTimeout(
    `CREATE INDEX IF NOT EXISTS idx_intraday_session_symbol_time
     ON intraday_1m(symbol, session, "timestamp")`,
    [],
    { timeoutMs: 10000, maxRetries: 0, label: 'extended_hours.ensure_session_index' }
  );
}

async function initExtendedHoursSchemaOnce() {
  if (!extendedSchemaInitPromise) {
    extendedSchemaInitPromise = ensureIntradaySessionSchema().catch((error) => {
      extendedSchemaInitPromise = null;
      throw error;
    });
  }

  return extendedSchemaInitPromise;
}

function buildGainersQuery(hasTickerUniverseChangePercent) {
  if (hasTickerUniverseChangePercent) {
    return `SELECT symbol
            FROM ticker_universe
            WHERE symbol IS NOT NULL
              AND symbol <> ''
            ORDER BY change_percent DESC NULLS LAST
            LIMIT $1`;
  }

  return `SELECT symbol
          FROM market_metrics
          WHERE symbol IS NOT NULL
            AND symbol <> ''
          ORDER BY change_percent DESC NULLS LAST
          LIMIT $1`;
}

async function tickerUniverseHasChangePercent() {
  const { rows } = await queryWithTimeout(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'ticker_universe'
       AND column_name = 'change_percent'
     LIMIT 1`,
    [],
    { timeoutMs: 5000, maxRetries: 0, label: 'extended_hours.schema_check_ticker_universe_change_percent', poolType: 'read' }
  );

  return rows.length > 0;
}

async function loadWatchlist() {
  const hasUniverseChangePercent = await tickerUniverseHasChangePercent();
  const gainersQuery = buildGainersQuery(hasUniverseChangePercent);

  const [activeCatalysts, topGainers] = await Promise.all([
    queryWithTimeout(
      `SELECT DISTINCT symbol
       FROM catalyst_signals
       WHERE created_at > NOW() - INTERVAL '4 hours'
       ORDER BY symbol
       LIMIT $1`,
      [WATCHLIST_SOURCE_LIMIT],
      { timeoutMs: 8000, maxRetries: 0, label: 'extended_hours.watchlist.catalyst_signals', poolType: 'read' }
    ),
    queryWithTimeout(
      gainersQuery,
      [WATCHLIST_SOURCE_LIMIT],
      { timeoutMs: 8000, maxRetries: 0, label: 'extended_hours.watchlist.top_gainers', poolType: 'read' }
    ),
  ]);

  const candidates = [
    ...activeCatalysts.rows.map((row) => normalizeSymbol(row.symbol)),
    ...topGainers.rows.map((row) => normalizeSymbol(row.symbol)),
    ...Array.from(trackedSymbols),
  ].filter(Boolean);

  const deduped = [];
  const seen = new Set();

  for (const symbol of candidates) {
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    deduped.push(symbol);
    if (deduped.length >= MAX_EXTENDED_SYMBOLS) break;
  }

  for (const symbol of deduped) {
    trackedSymbols.add(symbol);
  }

  return deduped;
}

async function fetchAftermarketQuote(symbol, fmpApiKey) {
  const url = `${FMP_AFTERMARKET_QUOTE_ENDPOINT}?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(fmpApiKey)}`;
  console.log('[EXTENDED] fetching:', symbol);
  const response = await axios.get(url, { timeout: REQUEST_TIMEOUT_MS });
  console.log('[EXTENDED] status:', response.status);
  const data = Array.isArray(response.data) ? response.data[0] : response.data;

  if (!data || !data.timestamp) {
    console.log('[EXTENDED] invalid data:', data);
    return null;
  }

  const bid = Number(data.bidPrice);
  const ask = Number(data.askPrice);

  if (!Number.isFinite(bid) || !Number.isFinite(ask)) {
    console.log('[EXTENDED] missing bid/ask:', data);
    return null;
  }

  const price = (bid + ask) / 2;

  // FMP aftermarket timestamp is unix milliseconds.
  const ts = new Date(Number(data.timestamp));
  if (Number.isNaN(ts.getTime())) {
    console.log('[EXTENDED] invalid data:', data);
    return null;
  }

  const minuteTs = new Date(
    ts.getFullYear(),
    ts.getMonth(),
    ts.getDate(),
    ts.getHours(),
    ts.getMinutes(),
    0
  );

  console.log('[EXTENDED] parsed:', {
    symbol,
    price,
    timestamp: ts.toISOString(),
    minute: minuteTs.toISOString(),
  });

  return {
    symbol,
    price,
    minute: minuteTs.toISOString(),
  };
}

async function insertCompletedBar(bar) {
  if (!bar || !bar.symbol || !bar.minute) {
    return;
  }

  await queryWithTimeout(
    `INSERT INTO intraday_1m
      (symbol, "timestamp", open, high, low, close, volume, session)
     VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (symbol, "timestamp", session)
     DO NOTHING`,
    [
      bar.symbol,
      bar.minute,
      bar.open,
      bar.high,
      bar.low,
      bar.close,
      Number.isFinite(bar.volume) ? Math.trunc(bar.volume) : 0,
      bar.session,
    ],
    { timeoutMs: 10000, maxRetries: 0, label: 'extended_hours.insert_bar' }
  );

  console.log('[EXTENDED] bar written:', bar.symbol, bar.minute);
  logger.info(`[EXTENDED] bar written ${bar.symbol} ${bar.minute}`);
}

async function flushAllOpenBars() {
  const symbols = Object.keys(bars);
  for (const symbol of symbols) {
    await insertCompletedBar(bars[symbol]);
    delete bars[symbol];
  }
}

async function applyDailyCleanupIfNeeded() {
  const now = Date.now();
  if ((now - lastCleanupRunAt) < DAILY_CLEANUP_INTERVAL_MS) {
    return;
  }

  const cleanupResult = await queryWithTimeout(
    `DELETE FROM intraday_1m
     WHERE session IN ('premarket', 'postmarket')
       AND "timestamp" < NOW() - INTERVAL '30 days'`,
    [],
    { timeoutMs: 60000, maxRetries: 0, label: 'extended_hours.cleanup_30d' }
  );

  lastCleanupRunAt = now;
  logger.info('[EXTENDED] cleanup complete', { rowsDeleted: Number(cleanupResult?.rowCount || 0) });
}

async function processSymbolPriceUpdate(symbol, price, minute, session) {
  const existing = bars[symbol];

  if (!existing || existing.minute !== minute || existing.session !== session) {
    if (existing) {
      console.log('[EXTENDED] inserting:', {
        symbol: existing.symbol,
        minute: existing.minute,
        session: existing.session,
      });
      await insertCompletedBar(existing);
    }

    bars[symbol] = {
      symbol,
      minute,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 0,
      session,
    };

    return;
  }

  console.log('[EXTENDED] updating bar:', symbol, price);
  existing.high = Math.max(existing.high, price);
  existing.low = Math.min(existing.low, price);
  existing.close = price;
}

async function runExtendedHoursIngest() {
  console.log('[EXTENDED] engine tick', new Date().toISOString());
  const fmpApiKey = process.env.FMP_API_KEY;
  if (!fmpApiKey || fmpApiKey === 'REQUIRED') {
    return {
      skipped: true,
      reason: 'missing_fmp_api_key',
      inserted: 0,
    };
  }

  await initExtendedHoursSchemaOnce();
  await applyDailyCleanupIfNeeded();

  const { session, estTime } = resolveSessionFromEtDate();
  console.log('[EXTENDED] ET time:', estTime.toISOString());
  console.log('[EXTENDED] session:', session);
  const extendedActive = session === 'premarket' || session === 'postmarket';

  logger.info('[EXTENDED] session active', {
    active: extendedActive,
    session,
  });

  if (!extendedActive) {
    if (activeTrackedSession) {
      await flushAllOpenBars();
      trackedSymbols.clear();
      activeTrackedSession = null;
    }

    return {
      skipped: true,
      reason: 'outside_extended_hours',
      session,
      inserted: 0,
    };
  }

  if (activeTrackedSession !== session) {
    await flushAllOpenBars();
    trackedSymbols.clear();
    activeTrackedSession = session;
  }

  let watchlist = await loadWatchlist();
  console.log('[EXTENDED] watchlist size:', watchlist.length);
  console.log('[EXTENDED] first symbols:', watchlist.slice(0, 5));

  if (watchlist.length === 0) {
    const fallback = await queryWithTimeout(
      `SELECT symbol
       FROM ticker_universe
       WHERE symbol IS NOT NULL
         AND symbol <> ''
       LIMIT 20`,
      [],
      { timeoutMs: 8000, maxRetries: 0, label: 'extended_hours.watchlist.fallback', poolType: 'read' }
    );

    watchlist = fallback.rows.map((row) => normalizeSymbol(row.symbol)).filter(Boolean);
    console.log('[EXTENDED] fallback watchlist used:', watchlist.length);
  }

  logger.info('[EXTENDED] watchlist size', { size: watchlist.length, session });

  let updates = 0;

  for (let i = 0; i < watchlist.length; i += MAX_SYMBOLS_PER_BATCH) {
    const batch = watchlist.slice(i, i + MAX_SYMBOLS_PER_BATCH);

    for (const symbol of batch) {
      try {
        const quote = await fetchAftermarketQuote(symbol, fmpApiKey);
        if (!quote) {
          await sleep(SYMBOL_THROTTLE_MS);
          continue;
        }

        logger.info(`[EXTENDED] price update ${symbol}`);
        await processSymbolPriceUpdate(symbol, quote.price, quote.minute, session);
        updates += 1;
      } catch (error) {
        logger.warn('[EXTENDED] quote fetch failed', {
          symbol,
          error: error.message,
        });
      }

      await sleep(SYMBOL_THROTTLE_MS);
    }

    if (i + MAX_SYMBOLS_PER_BATCH < watchlist.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  return {
    session,
    watchlistSize: watchlist.length,
    updates,
  };
}

module.exports = {
  runExtendedHoursIngest,
  resolveSessionFromEtDate,
};
