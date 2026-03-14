const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

const QUERY_TIMEOUT_MS = 500;
const MAX_CONCURRENT = 5;

function createLimiter(limit) {
  let active = 0;
  const queue = [];

  const runNext = () => {
    if (active >= limit || queue.length === 0) return;
    const task = queue.shift();
    active += 1;
    task()
      .catch(() => null)
      .finally(() => {
        active = Math.max(0, active - 1);
        runNext();
      });
  };

  return (fn) => new Promise((resolve, reject) => {
    queue.push(async () => {
      try {
        resolve(await fn());
      } catch (error) {
        reject(error);
      }
    });
    runNext();
  });
}

const limitQuery = createLimiter(MAX_CONCURRENT);

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function safeQuery(sql, params, label) {
  try {
    return await limitQuery(() => queryWithTimeout(sql, params, {
      timeoutMs: QUERY_TIMEOUT_MS,
      maxRetries: 0,
      label,
    }));
  } catch (error) {
    logger.warn('[TRADE_NARRATIVE] query failed', { label, error: error.message });
    return { rows: [], rowCount: 0 };
  }
}

async function tableExists(tableName) {
  const { rows } = await safeQuery(
    `SELECT to_regclass($1) AS regclass`,
    [`public.${tableName}`],
    `trade_narrative.exists.${tableName}`
  );
  return Boolean(rows?.[0]?.regclass);
}

async function getColumns(tableName) {
  const { rows } = await safeQuery(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1`,
    [tableName],
    `trade_narrative.columns.${tableName}`
  );
  return new Set((rows || []).map((row) => String(row.column_name || '')));
}

async function loadBeaconSignals() {
  const { rows } = await safeQuery(
    `SELECT
       symbol,
       strategy,
       beacon_probability,
       expected_move
     FROM beacon_rankings
     ORDER BY beacon_probability DESC
     LIMIT 20`,
    [],
    'trade_narrative.beacon_signals'
  );

  return rows || [];
}

async function loadMarketContext() {
  const { rows } = await safeQuery(
    `SELECT *
     FROM market_context_snapshot
     ORDER BY created_at DESC
     LIMIT 1`,
    [],
    'trade_narrative.market_context'
  );

  return rows?.[0] || null;
}

async function loadSectorRotationTop() {
  const { rows } = await safeQuery(
    `SELECT *
     FROM sector_rotation_snapshot
     ORDER BY rank ASC
     LIMIT 10`,
    [],
    'trade_narrative.sector_rotation'
  );

  return rows || [];
}

async function loadSymbolSectors(symbols) {
  if (!symbols.length) return new Map();

  const { rows } = await safeQuery(
    `SELECT symbol, sector
     FROM market_quotes
     WHERE symbol = ANY($1::text[])`,
    [symbols],
    'trade_narrative.market_quote_sectors'
  );

  const map = new Map();
  for (const row of rows || []) {
    const symbol = String(row.symbol || '').toUpperCase().trim();
    if (!symbol) continue;
    map.set(symbol, String(row.sector || '').trim() || null);
  }

  return map;
}

function narrativeText({ symbol, strategy, marketRegime, sectorContext, beaconProbability, expectedMove }) {
  return `${symbol} triggered a ${strategy} setup.\n\nMarket context: ${marketRegime}\n\nSector context: ${sectorContext}\n\nSignal strength: ${beaconProbability.toFixed(2)}\n\nExpected move: ${expectedMove.toFixed(2)}%`;
}

async function insertNarratives(rows, columns) {
  if (!rows.length) return { inserted: 0 };

  const required = [
    'symbol',
    'strategy',
    'beacon_probability',
    'market_context',
    'sector_context',
    'catalyst_context',
    'narrative',
  ];

  const missing = required.filter((column) => !columns.has(column));
  if (missing.length > 0) {
    logger.warn('[TRADE_NARRATIVE] trade_narratives missing required columns; insert skipped', { missing });
    return { inserted: 0 };
  }

  const insertColumns = [...required, 'created_at'].filter((col) => col === 'created_at' || columns.has(col));

  const valuesByColumn = {
    symbol: rows.map((row) => row.symbol),
    strategy: rows.map((row) => row.strategy),
    beacon_probability: rows.map((row) => row.beacon_probability),
    market_context: rows.map((row) => row.market_context),
    sector_context: rows.map((row) => row.sector_context),
    catalyst_context: rows.map((row) => row.catalyst_context),
    narrative: rows.map((row) => row.narrative),
    created_at: rows.map(() => new Date().toISOString()),
  };

  const casts = {
    symbol: 'text',
    strategy: 'text',
    beacon_probability: 'numeric',
    market_context: 'text',
    sector_context: 'text',
    catalyst_context: 'text',
    narrative: 'text',
    created_at: 'timestamptz',
  };

  const selectParts = insertColumns.map((column, idx) => `unnest($${idx + 1}::${casts[column]}[]) AS ${column}`);
  const params = insertColumns.map((column) => valuesByColumn[column]);

  const { rowCount } = await safeQuery(
    `INSERT INTO trade_narratives (${insertColumns.join(', ')})
     SELECT ${selectParts.join(', ')}`,
    params,
    'trade_narrative.insert'
  );

  return { inserted: Number(rowCount || 0) };
}

async function loadRecentNarrativeSymbols() {
  const { rows } = await safeQuery(
    `SELECT DISTINCT symbol
     FROM trade_narratives
     WHERE created_at >= NOW() - INTERVAL '5 minutes'`,
    [],
    'trade_narrative.recent_symbols'
  );

  return new Set((rows || []).map((row) => String(row.symbol || '').toUpperCase().trim()).filter(Boolean));
}

function sectorContextText(sector, topSectors) {
  if (!sector) return 'Sector unavailable';

  const normalized = String(sector).toLowerCase();
  const found = topSectors.find((row) => String(row.sector || '').toLowerCase() === normalized);

  if (!found) return `${sector} not in top rotation list`;

  return `${found.sector} rank ${toNumber(found.rank, 0)} (momentum ${toNumber(found.momentum_score, 0).toFixed(2)})`;
}

async function runTradeNarrativeEngine() {
  const startedAt = Date.now();

  try {
    const [beaconExists, marketContextExists, sectorRotationExists, marketQuotesExists, narrativesExists] = await Promise.all([
      tableExists('beacon_rankings'),
      tableExists('market_context_snapshot'),
      tableExists('sector_rotation_snapshot'),
      tableExists('market_quotes'),
      tableExists('trade_narratives'),
    ]);

    if (!beaconExists || !marketContextExists || !sectorRotationExists || !marketQuotesExists || !narrativesExists) {
      logger.warn('[TRADE_NARRATIVE] required tables missing; run skipped', {
        beacon_rankings: beaconExists,
        market_context_snapshot: marketContextExists,
        sector_rotation_snapshot: sectorRotationExists,
        market_quotes: marketQuotesExists,
        trade_narratives: narrativesExists,
      });
      return { processed: 0, inserted: 0, skipped: true };
    }

    const [signals, marketContext, topSectors, existingSymbols, narrativeColumns] = await Promise.all([
      loadBeaconSignals(),
      loadMarketContext(),
      loadSectorRotationTop(),
      loadRecentNarrativeSymbols(),
      getColumns('trade_narratives'),
    ]);

    if (!marketContext) {
      logger.warn('[TRADE_NARRATIVE] market context unavailable; run skipped');
      return { processed: signals.length, inserted: 0, skipped: true };
    }

    const uniqueSignals = [];
    const seen = new Set();
    for (const signal of signals) {
      const symbol = String(signal.symbol || '').toUpperCase().trim();
      if (!symbol || seen.has(symbol)) continue;
      seen.add(symbol);
      uniqueSignals.push({ ...signal, symbol });
    }

    const sectorBySymbol = await loadSymbolSectors(uniqueSignals.map((row) => row.symbol));

    const rowsToInsert = [];
    for (const signal of uniqueSignals) {
      const symbol = signal.symbol;
      if (existingSymbols.has(symbol)) continue;

      const strategy = String(signal.strategy || '').trim();
      if (!strategy) continue;

      const beaconProbability = toNumber(signal.beacon_probability);
      const expectedMove = toNumber(signal.expected_move);
      const sector = sectorBySymbol.get(symbol);

      const marketRegime = String(marketContext.market_regime || 'neutral');
      const sectorContext = sectorContextText(sector, topSectors);
      const catalystContext = `Expected move ${expectedMove.toFixed(2)}%`;
      const narrative = narrativeText({
        symbol,
        strategy,
        marketRegime,
        sectorContext,
        beaconProbability,
        expectedMove,
      });

      rowsToInsert.push({
        symbol,
        strategy,
        beacon_probability: Number(beaconProbability.toFixed(6)),
        market_context: marketRegime,
        sector_context: sectorContext,
        catalyst_context: catalystContext,
        narrative,
      });
    }

    const { inserted } = await insertNarratives(rowsToInsert, narrativeColumns);

    const runtimeMs = Date.now() - startedAt;
    logger.info('[TRADE_NARRATIVE] complete', {
      processed: uniqueSignals.length,
      inserted,
      runtimeMs,
    });

    return {
      processed: uniqueSignals.length,
      inserted,
      runtimeMs,
    };
  } catch (error) {
    const runtimeMs = Date.now() - startedAt;
    logger.warn('[TRADE_NARRATIVE] run failed', { error: error.message, runtimeMs });
    return {
      processed: 0,
      inserted: 0,
      runtimeMs,
      error: error.message,
    };
  }
}

module.exports = {
  runTradeNarrativeEngine,
};
