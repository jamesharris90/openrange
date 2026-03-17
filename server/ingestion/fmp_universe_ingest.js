require('dotenv').config();

const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { fmpFetch } = require('../services/fmpClient');
const { fetchStockList } = require('../services/fmpService');
const { supabaseAdmin } = require('../services/supabaseClient');
const { batchInsert } = require('../utils/batchInsert');
const { queueSymbol } = require('../metrics/queue_symbol');
const logger = require('../utils/logger');
const { pool } = require('../db/pg');

const ALLOWED_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX']);
const EXCLUDED_TYPE_TERMS = ['ETF', 'ETN', 'MUTUAL', 'FUND', 'TRUST', 'CRYPTO', 'INDEX', 'ADR'];
const EXCLUDED_EXCHANGE_TERMS = ['OTC', 'PINK', 'GREY'];

function normalizeExchange(row) {
  return String(
    row.exchangeShortName || row.exchange || row.exchangeName || ''
  ).trim().toUpperCase();
}

function normalizeUniverseRow(row) {
  const symbol = String(row.symbol || '').trim().toUpperCase();
  if (!symbol) return null;

  const exchange = normalizeExchange(row);
  if (!ALLOWED_EXCHANGES.has(exchange)) return null;

  const rowType = String(row.type || row.securityType || row.assetType || '').trim().toUpperCase();
  const isEtf = row.isEtf === true || String(row.isEtf || '').trim().toLowerCase() === 'true';
  const name = String(row.name || row.companyName || '').trim().toUpperCase();

  if (isEtf) return null;
  if (rowType && rowType !== 'STOCK') return null;
  if (EXCLUDED_TYPE_TERMS.some((term) => rowType.includes(term) || name.includes(term))) return null;
  if (EXCLUDED_EXCHANGE_TERMS.some((term) => exchange.includes(term))) return null;

  const marketCapRaw = Number(row.marketCap ?? row.mktCap ?? 0);

  return {
    symbol,
    company_name: row.name || row.companyName || null,
    exchange,
    sector: row.sector || null,
    industry: row.industry || null,
    market_cap: Number.isFinite(marketCapRaw) ? Math.trunc(marketCapRaw) : null,
    is_active: true,
    last_updated: new Date().toISOString(),
  };
}

async function ensureUniverseTable() {
  const sqlPath = path.join(__dirname, '..', 'migrations', 'create_ticker_universe.sql');
  const sql = await fs.readFile(sqlPath, 'utf8');
  await pool.query(sql);
}

async function fetchUniversePayload() {
  try {
    return await fmpFetch('/stock/list');
  } catch (err) {
    if (err?.status !== 403) throw err;

    logger.warn('universe ingestion legacy endpoint blocked, trying FMP stock screener fallback', {
      endpoint: '/stock/list',
      fallback: 'services/fmpService.fetchStockList()',
    });

    try {
      return await fetchStockList();
    } catch (fallbackErr) {
      logger.warn('universe ingestion screener fallback failed, trying stable stock-list', {
        error: fallbackErr.message,
      });
    }

    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) throw err;

    const response = await axios.get('https://financialmodelingprep.com/stable/stock-list', {
      params: { apikey: apiKey },
      timeout: 20000,
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) {
      const stableErr = new Error(`FMP stable stock-list failed with status ${response.status}`);
      stableErr.status = response.status;
      stableErr.payload = response.data;
      throw stableErr;
    }

    return response.data;
  }
}

async function runUniverseIngestion() {
  const startedAt = Date.now();
  await ensureUniverseTable();

  logger.info('universe ingestion start', { jobName: 'fmp_universe_ingest' });

  const payload = await fetchUniversePayload();
  const rawRows = Array.isArray(payload) ? payload : [];

  let filteredOut = 0;
  const dedupMap = new Map();
  for (const row of rawRows) {
    const normalized = normalizeUniverseRow(row);
    if (!normalized) {
      filteredOut += 1;
      continue;
    }

    if (!dedupMap.has(normalized.symbol)) {
      dedupMap.set(normalized.symbol, normalized);
    }
  }

  const dedupedRows = Array.from(dedupMap.values());
  const duplicatesIgnored = rawRows.length - filteredOut - dedupedRows.length;
  const incomingSymbols = dedupedRows.map((row) => row.symbol);

  const existing = new Set();
  for (let index = 0; index < incomingSymbols.length; index += 1000) {
    const chunk = incomingSymbols.slice(index, index + 1000);
    if (!chunk.length) continue;
    const { rows } = await pool.query(
      `SELECT symbol
       FROM ticker_universe
       WHERE symbol = ANY($1::text[])`,
      [chunk]
    );
    for (const row of rows) {
      existing.add(String(row.symbol || '').toUpperCase());
    }
  }

  const newSymbols = incomingSymbols.filter((symbol) => !existing.has(String(symbol || '').toUpperCase()));

  let inserted = 0;
  if (dedupedRows.length > 0) {
    if (supabaseAdmin) {
      const result = await batchInsert({
        supabase: supabaseAdmin,
        table: 'ticker_universe',
        rows: dedupedRows,
        conflictTarget: 'symbol',
        batchSize: 500,
      });
      inserted = result.inserted;
    } else {
      for (let index = 0; index < dedupedRows.length; index += 500) {
        const chunk = dedupedRows.slice(index, index + 500);
        const payload = JSON.stringify(chunk);
        await pool.query(
          `INSERT INTO ticker_universe (
             symbol,
             company_name,
             exchange,
             sector,
             industry,
             market_cap,
             is_active,
             last_updated
           )
           SELECT symbol,
                  company_name,
                  exchange,
                  sector,
                  industry,
                  market_cap,
                  is_active,
                  NOW()
           FROM jsonb_to_recordset($1::jsonb) AS x(
             symbol text,
             company_name text,
             exchange text,
             sector text,
             industry text,
             market_cap bigint,
             is_active boolean,
             last_updated timestamptz
           )
           ON CONFLICT (symbol) DO UPDATE
           SET company_name = EXCLUDED.company_name,
               exchange = EXCLUDED.exchange,
               sector = EXCLUDED.sector,
               industry = EXCLUDED.industry,
               market_cap = EXCLUDED.market_cap,
               is_active = EXCLUDED.is_active,
               last_updated = NOW()`,
          [payload]
        );
        inserted += chunk.length;
      }
    }
  }

  for (const symbol of newSymbols) {
    try {
      await queueSymbol(symbol, 'new_symbol', { silent: true });
    } catch (err) {
      logger.warn('failed to queue new universe symbol', { symbol, error: err.message });
    }
  }

  const durationMs = Date.now() - startedAt;
  const summary = {
    jobName: 'fmp_universe_ingest',
    symbols_processed: rawRows.length,
    symbols_inserted: inserted,
    new_symbols: newSymbols.length,
    duplicates_ignored: Math.max(0, duplicatesIgnored),
    filtered_out: filteredOut,
    durationMs,
  };

  logger.info('universe ingestion done', summary);
  return summary;
}

module.exports = {
  runUniverseIngestion,
};
