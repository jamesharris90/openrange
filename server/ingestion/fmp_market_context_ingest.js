const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { fmpFetch } = require('../services/fmpClient');
const { queryWithTimeout } = require('../db/pg');
const logger = require('../utils/logger');

const CONTEXT_SYMBOLS = [
  { requestSymbol: 'SPY', symbol: 'SPY', bucket: 'broad' },
  { requestSymbol: 'QQQ', symbol: 'QQQ', bucket: 'broad' },
  { requestSymbol: 'IWM', symbol: 'IWM', bucket: 'broad' },
  { requestSymbol: 'XLF', symbol: 'XLF', bucket: 'sector', sectorName: 'Financials' },
  { requestSymbol: 'XLE', symbol: 'XLE', bucket: 'sector', sectorName: 'Energy' },
  { requestSymbol: 'XLK', symbol: 'XLK', bucket: 'sector', sectorName: 'Technology' },
  { requestSymbol: 'XLI', symbol: 'XLI', bucket: 'sector', sectorName: 'Industrials' },
  { requestSymbol: 'XLV', symbol: 'XLV', bucket: 'sector', sectorName: 'Health Care' },
  { requestSymbol: 'XLP', symbol: 'XLP', bucket: 'sector', sectorName: 'Consumer Staples' },
  { requestSymbol: 'XLY', symbol: 'XLY', bucket: 'sector', sectorName: 'Consumer Discretionary' },
  { requestSymbol: 'XLB', symbol: 'XLB', bucket: 'sector', sectorName: 'Materials' },
  { requestSymbol: 'XLU', symbol: 'XLU', bucket: 'sector', sectorName: 'Utilities' },
  { requestSymbol: 'XLRE', symbol: 'XLRE', bucket: 'sector', sectorName: 'Real Estate' },
  { requestSymbol: 'XLC', symbol: 'XLC', bucket: 'sector', sectorName: 'Communication Services' },
  { requestSymbol: '^VIX', symbol: 'VIX', bucket: 'volatility' },
];

const REQUEST_SYMBOLS = CONTEXT_SYMBOLS.map((entry) => entry.requestSymbol).join(',');
const DB_SYMBOLS = CONTEXT_SYMBOLS.map((entry) => entry.symbol);
const SYMBOL_CONFIG = new Map(CONTEXT_SYMBOLS.map((entry) => [entry.symbol, entry]));
const DEFAULT_BATCH_SIZE = 25;

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

function normalizeSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase();
  if (symbol === '^VIX') return 'VIX';
  return symbol;
}

function classifyVixLevel(price) {
  const numericPrice = toNumber(price);
  if (numericPrice === null) return 'normal';
  if (numericPrice < 15) return 'low';
  if (numericPrice <= 20) return 'normal';
  if (numericPrice <= 30) return 'elevated';
  return 'high';
}

function classifyMarketRegime(spyChangePercent, vixPrice, vixChangePercent) {
  const spyChange = toNumber(spyChangePercent) || 0;
  const vixLevel = toNumber(vixPrice);
  const vixChange = toNumber(vixChangePercent) || 0;

  if (spyChange > 0.5 && ((vixLevel !== null && vixLevel < 18) || vixChange <= 0)) {
    return 'risk_on';
  }

  if (spyChange < -0.5 && ((vixLevel !== null && vixLevel >= 25) || vixChange > 0)) {
    return 'risk_off';
  }

  return 'neutral';
}

function buildSmaMap(rows) {
  const grouped = new Map();

  for (const row of rows || []) {
    const symbol = normalizeSymbol(row?.symbol);
    const close = toNumber(row?.close);
    if (!symbol || close === null) continue;
    if (!grouped.has(symbol)) grouped.set(symbol, []);
    grouped.get(symbol).push(close);
  }

  const averages = new Map();
  for (const [symbol, closes] of grouped.entries()) {
    if (!closes.length) continue;
    const sum = closes.reduce((total, close) => total + close, 0);
    averages.set(symbol, sum / closes.length);
  }

  return averages;
}

function computePremarketChangePercent(price, previousClose, changePercent) {
  const numericPrice = toNumber(price);
  const numericPreviousClose = toNumber(previousClose);
  if (numericPrice !== null && numericPreviousClose !== null && numericPreviousClose !== 0) {
    return ((numericPrice - numericPreviousClose) / numericPreviousClose) * 100;
  }
  return toNumber(changePercent);
}

function toContextEntry(row, smaMap) {
  if (!row) return null;

  const symbol = normalizeSymbol(row.symbol);
  const price = toNumber(row.price);
  const changePercent = toNumber(row.change_percent);
  const previousClose = toNumber(row.previous_close);
  const average200 = smaMap.get(symbol) ?? null;
  const premarketChangePercent = computePremarketChangePercent(price, previousClose, changePercent);

  return {
    symbol,
    price,
    changePercent,
    previousClose,
    isAbove200d: average200 !== null && price !== null ? price > average200 : null,
    premarketChangePercent,
    updatedAt: row.updated_at || row.last_updated || null,
  };
}

function buildMarketContext(quoteRows, smaRows = []) {
  const smaMap = buildSmaMap(smaRows);
  const entries = new Map((quoteRows || []).map((row) => [normalizeSymbol(row.symbol), toContextEntry(row, smaMap)]));

  const spy = entries.get('SPY') || null;
  const qqq = entries.get('QQQ') || null;
  const iwm = entries.get('IWM') || null;
  const vixEntry = entries.get('VIX') || null;

  const sectorRows = CONTEXT_SYMBOLS
    .filter((entry) => entry.bucket === 'sector')
    .map((entry) => {
      const quote = entries.get(entry.symbol);
      return {
        symbol: entry.symbol,
        sectorName: entry.sectorName,
        entry: quote
          ? {
              price: quote.price,
              changePercent: quote.changePercent,
              isAbove200d: quote.isAbove200d,
              premarketChangePercent: quote.premarketChangePercent,
            }
          : null,
      };
    })
    .sort((left, right) => (right.entry?.changePercent ?? Number.NEGATIVE_INFINITY) - (left.entry?.changePercent ?? Number.NEGATIVE_INFINITY));

  const sectors = {};
  sectorRows.forEach((row, index) => {
    sectors[row.symbol] = row.entry
      ? {
          ...row.entry,
          rank: index + 1,
          sectorName: row.sectorName,
        }
      : {
          price: null,
          changePercent: null,
          isAbove200d: null,
          premarketChangePercent: null,
          rank: index + 1,
          sectorName: row.sectorName,
        };
  });

  const vix = vixEntry
    ? {
        price: vixEntry.price,
        changePercent: vixEntry.changePercent,
        premarketChangePercent: vixEntry.premarketChangePercent,
        level: classifyVixLevel(vixEntry.price),
      }
    : {
        price: null,
        changePercent: null,
        premarketChangePercent: null,
        level: classifyVixLevel(null),
      };

  const timestamp = (quoteRows || [])
    .map((row) => row.updated_at || row.last_updated)
    .filter(Boolean)
    .sort()
    .slice(-1)[0] || null;

  return {
    spy: spy
      ? {
          price: spy.price,
          changePercent: spy.changePercent,
          isAbove200d: spy.isAbove200d,
          premarketChangePercent: spy.premarketChangePercent,
        }
      : null,
    qqq: qqq
      ? {
          price: qqq.price,
          changePercent: qqq.changePercent,
          isAbove200d: qqq.isAbove200d,
          premarketChangePercent: qqq.premarketChangePercent,
        }
      : null,
    iwm: iwm
      ? {
          price: iwm.price,
          changePercent: iwm.changePercent,
          isAbove200d: iwm.isAbove200d,
          premarketChangePercent: iwm.premarketChangePercent,
        }
      : null,
    vix,
    sectors,
    marketRegime: classifyMarketRegime(spy?.changePercent, vix.price, vix.changePercent),
    timestamp,
  };
}

function normalizeBatchQuote(record) {
  const symbol = normalizeSymbol(record?.symbol);
  const config = SYMBOL_CONFIG.get(symbol);
  if (!config || !symbol) {
    return null;
  }

  return {
    symbol,
    price: toNumber(record?.price),
    change_percent: toNumber(record?.changePercentage),
    volume: toInteger(record?.volume),
    market_cap: toInteger(record?.marketCap),
    sector: config.bucket === 'sector' ? config.sectorName : null,
    previous_close: toNumber(record?.previousClose),
    updated_at: record?.timestamp ? new Date(Number(record.timestamp) * 1000).toISOString() : new Date().toISOString(),
    last_updated: new Date().toISOString(),
  };
}

async function upsertMarketContextBatch(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }

  await queryWithTimeout(
    `INSERT INTO market_quotes (
       symbol,
       price,
       change_percent,
       volume,
       market_cap,
       sector,
       updated_at,
       previous_close,
       last_updated
     )
     SELECT
       payload.symbol,
       payload.price::numeric,
       payload.change_percent::numeric,
       payload.volume::bigint,
       payload.market_cap::bigint,
       payload.sector,
       payload.updated_at::timestamptz,
       payload.previous_close::numeric,
       payload.last_updated::timestamptz
     FROM json_to_recordset($1::json) AS payload(
       symbol text,
       price text,
       change_percent text,
       volume text,
       market_cap text,
       sector text,
       updated_at text,
       previous_close text,
       last_updated text
     )
     ON CONFLICT (symbol) DO UPDATE SET
       price = EXCLUDED.price,
       change_percent = EXCLUDED.change_percent,
       volume = EXCLUDED.volume,
       market_cap = EXCLUDED.market_cap,
       sector = COALESCE(EXCLUDED.sector, market_quotes.sector),
       updated_at = EXCLUDED.updated_at,
       previous_close = EXCLUDED.previous_close,
       last_updated = EXCLUDED.last_updated`,
    [JSON.stringify(rows)],
    { timeoutMs: 30000, label: 'fmp_market_context_ingest.upsert_market_quotes', maxRetries: 0 }
  );

  return rows.length;
}

async function persistRows(rows, batchSize = DEFAULT_BATCH_SIZE) {
  let upserted = 0;
  let errored = 0;

  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    try {
      upserted += await upsertMarketContextBatch(batch);
    } catch (error) {
      logger.warn('market context batch upsert failed, retrying row-by-row', {
        jobName: 'fmp_market_context_ingest',
        batchSize: batch.length,
        error: error.message,
      });

      for (const row of batch) {
        try {
          upserted += await upsertMarketContextBatch([row]);
        } catch (rowError) {
          errored += 1;
          logger.error('market context upsert failed', {
            jobName: 'fmp_market_context_ingest',
            symbol: row?.symbol || null,
            error: rowError.message,
          });
        }
      }
    }
  }

  return { upserted, errored };
}

async function ingestMarketContext(options = {}) {
  const batchSize = Math.max(1, Number(options.batchSize) || DEFAULT_BATCH_SIZE);
  const payload = await fmpFetch('/batch-quote', { symbols: REQUEST_SYMBOLS });
  const records = Array.isArray(payload) ? payload : [];

  logger.info('ingestion start', {
    jobName: 'fmp_market_context_ingest',
    requestedSymbols: REQUEST_SYMBOLS,
    recordsReceived: records.length,
  });

  const normalizedRows = records
    .map((record) => normalizeBatchQuote(record))
    .filter(Boolean)
    .reduce((deduped, row) => deduped.set(row.symbol, row), new Map());

  const persisted = await persistRows(Array.from(normalizedRows.values()), batchSize);

  const summary = {
    jobName: 'fmp_market_context_ingest',
    requestedSymbols: CONTEXT_SYMBOLS.length,
    receivedRecords: records.length,
    totalUpserted: persisted.upserted,
    totalErrored: persisted.errored,
    missingSymbols: DB_SYMBOLS.filter((symbol) => !normalizedRows.has(symbol)),
  };

  logger.info('ingestion done', summary);
  return summary;
}

async function getMarketContext() {
  const quoteResult = await queryWithTimeout(
    `SELECT symbol, price, change_percent, previous_close, updated_at, last_updated
     FROM market_quotes
     WHERE symbol = ANY($1::text[])
     ORDER BY symbol`,
    [DB_SYMBOLS],
    { timeoutMs: 15000, label: 'fmp_market_context_ingest.select_market_quotes', maxRetries: 0 }
  );

  const smaResult = await queryWithTimeout(
    `WITH ranked AS (
       SELECT
         symbol,
         close,
         ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS row_num
       FROM daily_ohlc
       WHERE symbol = ANY($1::text[])
     )
     SELECT symbol, close
     FROM ranked
     WHERE row_num <= 200`,
    [DB_SYMBOLS],
    { timeoutMs: 20000, label: 'fmp_market_context_ingest.select_daily_ohlc', maxRetries: 0 }
  );

  return buildMarketContext(quoteResult.rows || [], smaResult.rows || []);
}

module.exports = {
  CONTEXT_SYMBOLS,
  REQUEST_SYMBOLS,
  ingestMarketContext,
  getMarketContext,
  classifyVixLevel,
  classifyMarketRegime,
  buildMarketContext,
  normalizeBatchQuote,
};
