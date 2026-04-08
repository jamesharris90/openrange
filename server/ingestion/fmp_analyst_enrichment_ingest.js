const { fmpFetch } = require('../services/fmpClient');
const { queryWithTimeout } = require('../db/pg');
const logger = require('../utils/logger');

const BATCH_SIZE = 25;
const BATCH_DELAY_MS = 400;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeInteger(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function normalizeString(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

async function ensureAnalystTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS analyst_enrichment (
       symbol TEXT PRIMARY KEY,
       target_price NUMERIC,
       consensus_rating TEXT,
       buy_count INTEGER,
       hold_count INTEGER,
       sell_count INTEGER,
       last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    [],
    {
      timeoutMs: 7000,
      label: 'ingest.analyst.ensure_table',
      maxRetries: 0,
      poolType: 'write',
    }
  );
}

async function loadSymbols() {
  const result = await queryWithTimeout(
    `SELECT DISTINCT symbol
     FROM earnings_events
     WHERE symbol IS NOT NULL
       AND NULLIF(BTRIM(symbol), '') IS NOT NULL
     ORDER BY symbol ASC`,
    [],
    {
      timeoutMs: 10000,
      label: 'ingest.analyst.load_symbols',
      maxRetries: 0,
      poolType: 'read',
    }
  );

  return result.rows.map((row) => String(row.symbol || '').trim().toUpperCase()).filter(Boolean);
}

function pickTargetPrice(row) {
  if (!row || typeof row !== 'object') return null;
  return normalizeNumber(
    row.targetPrice
    ?? row.target_price
    ?? row.priceTarget
    ?? row.price_target
    ?? row.targetConsensus
    ?? row.target_consensus
    ?? row.consensusTarget
  );
}

function pickConsensusRating(row) {
  if (!row || typeof row !== 'object') return null;
  return normalizeString(
    row.consensusRating
    ?? row.consensus_rating
    ?? row.rating
    ?? row.recommendation
    ?? row.gradesConsensus
    ?? row.grade
  );
}

function pickCount(row, ...keys) {
  for (const key of keys) {
    const value = normalizeInteger(row?.[key]);
    if (value != null) return value;
  }
  return null;
}

function normalizeAnalystRow(symbol, priceConsensusPayload, gradesConsensusPayload) {
  const priceRow = Array.isArray(priceConsensusPayload) ? priceConsensusPayload[0] : priceConsensusPayload;
  const gradesRow = Array.isArray(gradesConsensusPayload) ? gradesConsensusPayload[0] : gradesConsensusPayload;

  const targetPrice = pickTargetPrice(priceRow) ?? pickTargetPrice(gradesRow);
  const consensusRating = pickConsensusRating(gradesRow) ?? pickConsensusRating(priceRow);

  const buyCount = pickCount(
    gradesRow,
    'buy',
    'buyCount',
    'buy_count',
    'strongBuy',
    'strong_buy',
    'strongBuyCount',
    'strong_buy_count'
  );

  const holdCount = pickCount(
    gradesRow,
    'hold',
    'holdCount',
    'hold_count'
  );

  const sellCount = pickCount(
    gradesRow,
    'sell',
    'sellCount',
    'sell_count',
    'strongSell',
    'strong_sell',
    'strongSellCount',
    'strong_sell_count'
  );

  return {
    symbol,
    target_price: targetPrice,
    consensus_rating: consensusRating,
    buy_count: buyCount,
    hold_count: holdCount,
    sell_count: sellCount,
    last_updated: new Date().toISOString(),
  };
}

async function fetchSymbolAnalyst(symbol) {
  const [priceConsensus, gradesConsensus] = await Promise.all([
    fmpFetch('/price-target-consensus', { symbol }).catch(() => null),
    fmpFetch('/grades-consensus', { symbol }).catch(() => null),
  ]);

  return normalizeAnalystRow(symbol, priceConsensus, gradesConsensus);
}

async function upsertRows(rows) {
  if (!rows.length) return 0;

  const result = await queryWithTimeout(
    `WITH payload AS (
       SELECT *
       FROM json_to_recordset($1::json) AS x(
         symbol text,
         target_price numeric,
         consensus_rating text,
         buy_count integer,
         hold_count integer,
         sell_count integer,
         last_updated timestamptz
       )
     ), upserted AS (
       INSERT INTO analyst_enrichment (
         symbol,
         target_price,
         consensus_rating,
         buy_count,
         hold_count,
         sell_count,
         last_updated
       )
       SELECT
         symbol,
         target_price,
         consensus_rating,
         buy_count,
         hold_count,
         sell_count,
         last_updated
       FROM payload
       WHERE symbol IS NOT NULL
         AND NULLIF(BTRIM(symbol), '') IS NOT NULL
       ON CONFLICT (symbol)
       DO UPDATE SET
         target_price = EXCLUDED.target_price,
         consensus_rating = EXCLUDED.consensus_rating,
         buy_count = EXCLUDED.buy_count,
         hold_count = EXCLUDED.hold_count,
         sell_count = EXCLUDED.sell_count,
         last_updated = EXCLUDED.last_updated
       RETURNING 1
     )
     SELECT COUNT(*)::int AS upserted FROM upserted`,
    [JSON.stringify(rows)],
    {
      timeoutMs: 25000,
      label: 'ingest.analyst.upsert',
      maxRetries: 0,
      poolType: 'write',
    }
  );

  return Number(result.rows?.[0]?.upserted || 0);
}

async function runAnalystEnrichmentIngestion() {
  const startedAt = Date.now();
  await ensureAnalystTable();

  const symbols = await loadSymbols();
  if (!symbols.length) {
    return {
      jobName: 'fmp_analyst_enrichment_ingest',
      symbols: 0,
      fetched: 0,
      upserted: 0,
      failures: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  const rows = [];
  let failures = 0;

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map((symbol) => fetchSymbolAnalyst(symbol)));

    settled.forEach((result) => {
      if (result.status === 'fulfilled') {
        rows.push(result.value);
      } else {
        failures += 1;
      }
    });

    if (i + BATCH_SIZE < symbols.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  const upserted = await upsertRows(rows);

  logger.info('analyst enrichment ingestion complete', {
    jobName: 'fmp_analyst_enrichment_ingest',
    symbols: symbols.length,
    fetched: rows.length,
    upserted,
    failures,
    durationMs: Date.now() - startedAt,
  });

  return {
    jobName: 'fmp_analyst_enrichment_ingest',
    symbols: symbols.length,
    fetched: rows.length,
    upserted,
    failures,
    durationMs: Date.now() - startedAt,
  };
}

module.exports = {
  runAnalystEnrichmentIngestion,
};
