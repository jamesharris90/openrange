const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { queryWithTimeout } = require('../db/pg');
const { fetchBatchQuotes } = require('../services/quotesBatchService');
const { symbolsFromEnv } = require('./_helpers');
const logger = require('../utils/logger');

const BATCH_SIZE = Math.max(1, Number(process.env.LIVE_QUOTES_BATCH_SIZE) || 200);

function getEasternTimeParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );

  return {
    weekday: parts.weekday || 'Mon',
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
  };
}

function isPremarketSession(referenceTime = new Date()) {
  const { weekday, hour, minute } = getEasternTimeParts(referenceTime);
  if (weekday === 'Sat' || weekday === 'Sun') {
    return false;
  }

  const minutes = (hour * 60) + minute;
  return minutes >= 240 && minutes < 570;
}

async function loadUniverseSymbols() {
  const result = await queryWithTimeout(
    `SELECT symbol
     FROM ticker_universe
     WHERE COALESCE(is_active, true) = true
       AND symbol IS NOT NULL
       AND symbol <> ''
     ORDER BY market_cap DESC NULLS LAST, symbol ASC`,
    [],
    { timeoutMs: 10000, label: 'fmp_live_quotes_ingest.load_universe_symbols', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  const symbols = (result.rows || [])
    .map((row) => String(row.symbol || '').trim().toUpperCase())
    .filter(Boolean);

  return symbols.length > 0 ? symbols : symbolsFromEnv();
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function toNumericString(value, precision = 6) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric.toFixed(precision);
}

function toIntegerString(value) {
  const numeric = Math.trunc(Number(value) || 0);
  return String(Math.max(0, numeric));
}

function toTimestampIso(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return new Date().toISOString();
  }

  const timestampMs = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(timestampMs);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function normalizeQuoteRow(row) {
  const symbol = String(row?.symbol || '').trim().toUpperCase();
  const price = Number(row?.price);
  const changePercent = Number(row?.percent);
  const volume = Math.trunc(Number(row?.volume) || 0);
  const avgVolume30d = Number(row?.avgVolume30d);
  const marketCap = Number(row?.marketCap);
  const previousClose = Number(row?.close);

  if (!symbol || !Number.isFinite(price) || price <= 0) {
    return null;
  }

  return {
    symbol,
    price: toNumericString(price, 6),
    change_percent: toNumericString(changePercent, 6),
    volume: toIntegerString(volume),
    premarket_volume: isPremarketSession(new Date(toTimestampIso(row?.timestamp)))
      ? toIntegerString(volume)
      : null,
    relative_volume: Number.isFinite(avgVolume30d) && avgVolume30d > 0
      ? toNumericString(volume / avgVolume30d, 12)
      : null,
    avg_volume_30d: Number.isFinite(avgVolume30d) && avgVolume30d > 0
      ? toNumericString(avgVolume30d, 6)
      : null,
    market_cap: Number.isFinite(marketCap) && marketCap > 0
      ? toIntegerString(marketCap)
      : null,
    previous_close: Number.isFinite(previousClose) && previousClose > 0
      ? toNumericString(previousClose, 6)
      : null,
    updated_at: toTimestampIso(row?.timestamp),
    source: 'fmp_live_quote',
  };
}

async function persistQuotes(rows) {
  if (!rows.length) {
    return;
  }

  const payload = JSON.stringify(rows);

  await queryWithTimeout(
    `INSERT INTO market_quotes (
       symbol,
       price,
       change_percent,
       volume,
       premarket_volume,
       relative_volume,
       market_cap,
       previous_close,
       updated_at,
       last_updated
     )
     SELECT
       r.symbol,
       r.price::numeric,
       r.change_percent::numeric,
       r.volume::bigint,
      r.premarket_volume::bigint,
       r.relative_volume::numeric,
       r.market_cap::bigint,
       r.previous_close::numeric,
       r.updated_at::timestamptz,
       NOW()
     FROM json_to_recordset($1::json) AS r(
       symbol text,
       price text,
       change_percent text,
       volume text,
      premarket_volume text,
       relative_volume text,
       avg_volume_30d text,
       market_cap text,
       previous_close text,
       updated_at text,
       source text
     )
     ON CONFLICT (symbol) DO UPDATE SET
       price = EXCLUDED.price,
       change_percent = EXCLUDED.change_percent,
       volume = EXCLUDED.volume,
      premarket_volume = COALESCE(EXCLUDED.premarket_volume, market_quotes.premarket_volume),
       relative_volume = COALESCE(EXCLUDED.relative_volume, market_quotes.relative_volume),
       market_cap = COALESCE(EXCLUDED.market_cap, market_quotes.market_cap),
       previous_close = COALESCE(EXCLUDED.previous_close, market_quotes.previous_close),
       updated_at = EXCLUDED.updated_at,
       last_updated = NOW()`,
    [payload],
    { timeoutMs: 20000, label: 'fmp_live_quotes_ingest.persist_market_quotes', maxRetries: 0 }
  );

  await queryWithTimeout(
    `INSERT INTO market_metrics (
       symbol,
       price,
       change_percent,
       volume,
       relative_volume,
       avg_volume_30d,
       previous_close,
       source,
       updated_at,
       last_updated
     )
     SELECT
       r.symbol,
       r.price::numeric,
       r.change_percent::numeric,
       r.volume::bigint,
       r.relative_volume::numeric,
       r.avg_volume_30d::numeric,
       r.previous_close::numeric,
       r.source,
       r.updated_at::timestamptz,
       NOW()
     FROM json_to_recordset($1::json) AS r(
       symbol text,
       price text,
       change_percent text,
       volume text,
       relative_volume text,
       avg_volume_30d text,
       market_cap text,
       previous_close text,
       updated_at text,
       source text
     )
     ON CONFLICT (symbol) DO UPDATE SET
       price = EXCLUDED.price,
       change_percent = EXCLUDED.change_percent,
       volume = EXCLUDED.volume,
       relative_volume = COALESCE(EXCLUDED.relative_volume, market_metrics.relative_volume),
       avg_volume_30d = COALESCE(EXCLUDED.avg_volume_30d, market_metrics.avg_volume_30d),
       previous_close = COALESCE(EXCLUDED.previous_close, market_metrics.previous_close),
       source = EXCLUDED.source,
       updated_at = EXCLUDED.updated_at,
       last_updated = NOW()`,
    [payload],
    { timeoutMs: 20000, label: 'fmp_live_quotes_ingest.persist_market_metrics', maxRetries: 0 }
  );
}

async function runLiveQuotesIngestion(symbols) {
  const targetSymbols = Array.isArray(symbols) && symbols.length > 0
    ? symbols
    : await loadUniverseSymbols();
  const startedAt = Date.now();
  const normalizedRows = [];

  logger.info('ingestion start', {
    jobName: 'fmp_live_quotes_ingest',
    symbols: targetSymbols.length,
    batchSize: BATCH_SIZE,
  });

  for (const batch of chunk(targetSymbols, BATCH_SIZE)) {
    const quotes = await fetchBatchQuotes(batch.join(','));
    for (const quote of quotes) {
      const normalized = normalizeQuoteRow(quote);
      if (normalized) {
        normalizedRows.push(normalized);
      }
    }
  }

  await persistQuotes(normalizedRows);

  logger.info('ingestion done', {
    jobName: 'fmp_live_quotes_ingest',
    fetched: normalizedRows.length,
    inserted: normalizedRows.length,
    durationMs: Date.now() - startedAt,
  });

  return {
    jobName: 'fmp_live_quotes_ingest',
    inserted: normalizedRows.length,
    fetched: normalizedRows.length,
    durationMs: Date.now() - startedAt,
  };
}

module.exports = {
  runLiveQuotesIngestion,
};