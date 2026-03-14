const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

const QUERY_TIMEOUT_MS = 500;

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function tableExists(tableName) {
  const { rows } = await queryWithTimeout(
    `SELECT to_regclass($1) AS regclass`,
    [`public.${tableName}`],
    { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: `beacon.learning.table_exists.${tableName}` }
  );
  return Boolean(rows?.[0]?.regclass);
}

async function getColumns(tableName) {
  const { rows } = await queryWithTimeout(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1`,
    [tableName],
    { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: `beacon.learning.columns.${tableName}` }
  );
  return new Set((rows || []).map((row) => String(row.column_name || '')));
}

async function loadRecentRankings() {
  const { rows } = await queryWithTimeout(
    `SELECT signal_id,
            symbol,
            strategy,
            beacon_probability,
            expected_move,
            created_at
     FROM beacon_rankings
     WHERE created_at >= NOW() - INTERVAL '14 days'
     ORDER BY created_at DESC
     LIMIT 2000`,
    [],
    { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: 'beacon.learning.rankings' }
  );

  return rows || [];
}

async function loadOutcomesBySymbol() {
  const { rows } = await queryWithTimeout(
    `SELECT DISTINCT ON (symbol)
            symbol,
            move_percent,
            success,
            snapshot_date,
            created_at
     FROM signal_component_outcomes
     ORDER BY symbol, snapshot_date DESC NULLS LAST, created_at DESC NULLS LAST, id DESC NULLS LAST`,
    [],
    { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: 'beacon.learning.outcomes' }
  );

  const map = new Map();
  for (const row of rows || []) {
    const symbol = String(row.symbol || '').toUpperCase().trim();
    if (!symbol) continue;
    map.set(symbol, {
      actual_move: toNumber(row.move_percent),
      success: row.success == null ? toNumber(row.move_percent) > 0 : Boolean(row.success),
    });
  }
  return map;
}

async function insertLearningRows(rows, learningColumns) {
  if (!rows.length) return { inserted: 0 };

  const desired = [
    'signal_id',
    'symbol',
    'strategy',
    'beacon_probability',
    'expected_move',
    'actual_move',
    'success',
    'created_at',
  ];

  const insertColumns = desired.filter((column) => column === 'created_at' || learningColumns.has(column));
  if (!insertColumns.includes('symbol') || !insertColumns.includes('actual_move')) {
    logger.warn('[BEACON_LEARNING] beacon_learning_metrics missing required columns; insert skipped', {
      insertColumns,
    });
    return { inserted: 0 };
  }

  const castMap = {
    signal_id: 'bigint',
    symbol: 'text',
    strategy: 'text',
    beacon_probability: 'numeric',
    expected_move: 'numeric',
    actual_move: 'numeric',
    success: 'boolean',
    created_at: 'timestamptz',
  };

  const valuesByColumn = {};
  for (const column of insertColumns) {
    if (column === 'created_at') {
      valuesByColumn[column] = rows.map(() => new Date().toISOString());
    } else {
      valuesByColumn[column] = rows.map((row) => row[column] ?? null);
    }
  }

  const selectParts = insertColumns.map((column, idx) => `unnest($${idx + 1}::${castMap[column]}[]) AS ${column}`);
  const params = insertColumns.map((column) => valuesByColumn[column]);

  const { rowCount } = await queryWithTimeout(
    `INSERT INTO beacon_learning_metrics (${insertColumns.join(', ')})
     SELECT ${selectParts.join(', ')}`,
    params,
    { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: 'beacon.learning.insert' }
  );

  return { inserted: Number(rowCount || 0) };
}

async function runBeaconLearningEngine() {
  const startedAt = Date.now();

  try {
    const [rankingsExists, outcomesExists, learningExists] = await Promise.all([
      tableExists('beacon_rankings'),
      tableExists('signal_component_outcomes'),
      tableExists('beacon_learning_metrics'),
    ]);

    if (!rankingsExists || !outcomesExists || !learningExists) {
      logger.warn('[BEACON_LEARNING] required tables missing; run skipped', {
        beacon_rankings: rankingsExists,
        signal_component_outcomes: outcomesExists,
        beacon_learning_metrics: learningExists,
      });
      return { processed: 0, inserted: 0, skipped: true };
    }

    const [rankings, outcomesBySymbol, learningColumns] = await Promise.all([
      loadRecentRankings(),
      loadOutcomesBySymbol(),
      getColumns('beacon_learning_metrics'),
    ]);

    const learningRows = [];
    for (const ranking of rankings) {
      const symbol = String(ranking.symbol || '').toUpperCase().trim();
      if (!symbol) continue;

      const outcome = outcomesBySymbol.get(symbol);
      if (!outcome) continue;

      learningRows.push({
        signal_id: ranking.signal_id == null ? null : Number(ranking.signal_id),
        symbol,
        strategy: ranking.strategy || null,
        beacon_probability: toNumber(ranking.beacon_probability),
        expected_move: toNumber(ranking.expected_move),
        actual_move: toNumber(outcome.actual_move),
        success: Boolean(outcome.success),
      });
    }

    const { inserted } = await insertLearningRows(learningRows, learningColumns);
    const runtimeMs = Date.now() - startedAt;

    logger.info('[BEACON_LEARNING] complete', {
      processed: rankings.length,
      inserted,
      runtimeMs,
    });

    return {
      processed: rankings.length,
      inserted,
      runtimeMs,
    };
  } catch (error) {
    const runtimeMs = Date.now() - startedAt;
    logger.error('[BEACON_LEARNING] run failed', { error: error.message, runtimeMs });
    return {
      processed: 0,
      inserted: 0,
      runtimeMs,
      error: error.message,
    };
  }
}

module.exports = {
  runBeaconLearningEngine,
};
