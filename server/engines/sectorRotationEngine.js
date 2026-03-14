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
    logger.warn('[SECTOR_ROTATION] query failed', { label, error: error.message });
    return { rows: [], rowCount: 0 };
  }
}

async function tableExists(tableName) {
  const { rows } = await safeQuery(
    `SELECT to_regclass($1) AS regclass`,
    [`public.${tableName}`],
    `sector_rotation.exists.${tableName}`
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
    `sector_rotation.columns.${tableName}`
  );
  return new Set((rows || []).map((row) => String(row.column_name || '')));
}

async function loadSectorStats() {
  const { rows } = await safeQuery(
    `SELECT
       sector,
       AVG(change_percent)::numeric AS avg_change_percent,
       AVG(relative_volume)::numeric AS avg_relative_volume
     FROM market_quotes
     WHERE sector IS NOT NULL
       AND BTRIM(sector) <> ''
       AND updated_at >= NOW() - INTERVAL '1 day'
     GROUP BY sector`,
    [],
    'sector_rotation.aggregate'
  );

  return rows || [];
}

function buildRankedRows(sectorRows) {
  const enriched = sectorRows
    .map((row) => {
      const avgChange = toNumber(row.avg_change_percent);
      const avgRvol = toNumber(row.avg_relative_volume);
      const momentum = (avgChange * 0.7) + (avgRvol * 0.3);

      return {
        sector: String(row.sector || '').trim(),
        avg_change_percent: Number(avgChange.toFixed(6)),
        avg_relative_volume: Number(avgRvol.toFixed(6)),
        momentum_score: Number(momentum.toFixed(6)),
      };
    })
    .filter((row) => row.sector);

  enriched.sort((a, b) => b.momentum_score - a.momentum_score);

  return enriched.map((row, idx) => ({
    ...row,
    rank: idx + 1,
  }));
}

async function insertSnapshots(rows, snapshotColumns) {
  if (!rows.length) return { inserted: 0 };

  const required = ['sector', 'avg_change_percent', 'avg_relative_volume', 'momentum_score', 'rank'];
  const missing = required.filter((column) => !snapshotColumns.has(column));
  if (missing.length > 0) {
    logger.warn('[SECTOR_ROTATION] required snapshot columns missing; insert skipped', { missing });
    return { inserted: 0 };
  }

  const insertColumns = [...required, 'created_at'].filter((col) => col === 'created_at' || snapshotColumns.has(col));

  const valuesByColumn = {
    sector: rows.map((row) => row.sector),
    avg_change_percent: rows.map((row) => row.avg_change_percent),
    avg_relative_volume: rows.map((row) => row.avg_relative_volume),
    momentum_score: rows.map((row) => row.momentum_score),
    rank: rows.map((row) => row.rank),
    created_at: rows.map(() => new Date().toISOString()),
  };

  const casts = {
    sector: 'text',
    avg_change_percent: 'numeric',
    avg_relative_volume: 'numeric',
    momentum_score: 'numeric',
    rank: 'int',
    created_at: 'timestamptz',
  };

  const selectParts = insertColumns.map((column, idx) => `unnest($${idx + 1}::${casts[column]}[]) AS ${column}`);
  const params = insertColumns.map((column) => valuesByColumn[column]);

  const { rowCount } = await safeQuery(
    `INSERT INTO sector_rotation_snapshot (${insertColumns.join(', ')})
     SELECT ${selectParts.join(', ')}`,
    params,
    'sector_rotation.insert'
  );

  return { inserted: Number(rowCount || 0) };
}

async function runSectorRotationEngine() {
  const startedAt = Date.now();

  try {
    const [quotesExists, snapshotExists] = await Promise.all([
      tableExists('market_quotes'),
      tableExists('sector_rotation_snapshot'),
    ]);

    if (!quotesExists || !snapshotExists) {
      logger.warn('[SECTOR_ROTATION] required tables missing; run skipped', {
        market_quotes: quotesExists,
        sector_rotation_snapshot: snapshotExists,
      });
      return { processed: 0, inserted: 0, skipped: true };
    }

    const [quoteColumns, snapshotColumns] = await Promise.all([
      getColumns('market_quotes'),
      getColumns('sector_rotation_snapshot'),
    ]);

    const requiredQuote = ['sector', 'change_percent', 'relative_volume', 'updated_at'];
    const missingQuote = requiredQuote.filter((column) => !quoteColumns.has(column));
    if (missingQuote.length > 0) {
      logger.warn('[SECTOR_ROTATION] market_quotes missing required columns; run skipped', { missing: missingQuote });
      return { processed: 0, inserted: 0, skipped: true };
    }

    const sectorRows = await loadSectorStats();
    const rankedRows = buildRankedRows(sectorRows);
    const { inserted } = await insertSnapshots(rankedRows, snapshotColumns);

    const runtimeMs = Date.now() - startedAt;
    logger.info('[SECTOR_ROTATION] complete', {
      sectors: rankedRows.length,
      inserted,
      runtimeMs,
    });

    return {
      processed: rankedRows.length,
      inserted,
      runtimeMs,
    };
  } catch (error) {
    const runtimeMs = Date.now() - startedAt;
    logger.warn('[SECTOR_ROTATION] run failed', { error: error.message, runtimeMs });
    return {
      processed: 0,
      inserted: 0,
      runtimeMs,
      error: error.message,
    };
  }
}

module.exports = {
  runSectorRotationEngine,
};
