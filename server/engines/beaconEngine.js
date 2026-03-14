const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

const QUERY_TIMEOUT_MS = 500;
const MAX_SIGNAL_ROWS = 500;

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function getColumns(tableName) {
  const { rows } = await queryWithTimeout(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1`,
    [tableName],
    { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: `beacon.columns.${tableName}` }
  );
  return new Set((rows || []).map((row) => String(row.column_name || '')));
}

async function tableExists(tableName) {
  const { rows } = await queryWithTimeout(
    `SELECT to_regclass($1) AS regclass`,
    [`public.${tableName}`],
    { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: `beacon.table_exists.${tableName}` }
  );
  return Boolean(rows?.[0]?.regclass);
}

function chooseSignalTimeColumn(columns) {
  if (columns.has('timestamp')) return 'timestamp';
  if (columns.has('created_at')) return 'created_at';
  if (columns.has('updated_at')) return 'updated_at';
  return null;
}

function defaultWeights() {
  return {
    signal_weight: 1,
    winrate_weight: 1,
    probability_weight: 1,
    catalyst_weight: 1,
    sector_weight: 1,
    confirmation_weight: 1,
  };
}

async function loadLatestWeights() {
  const exists = await tableExists('beacon_weights');
  if (!exists) {
    logger.warn('[BEACON] beacon_weights table missing; using defaults');
    return defaultWeights();
  }

  try {
    const { rows } = await queryWithTimeout(
      `SELECT signal_weight,
              winrate_weight,
              probability_weight,
              catalyst_weight,
              sector_weight,
              confirmation_weight
       FROM beacon_weights
       ORDER BY created_at DESC
       LIMIT 1`,
      [],
      { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: 'beacon.weights.latest' }
    );

    const row = rows?.[0];
    if (!row) return defaultWeights();

    return {
      signal_weight: toNumber(row.signal_weight, 1),
      winrate_weight: toNumber(row.winrate_weight, 1),
      probability_weight: toNumber(row.probability_weight, 1),
      catalyst_weight: toNumber(row.catalyst_weight, 1),
      sector_weight: toNumber(row.sector_weight, 1),
      confirmation_weight: toNumber(row.confirmation_weight, 1),
    };
  } catch (error) {
    logger.warn('[BEACON] failed to load beacon weights; using defaults', { error: error.message });
    return defaultWeights();
  }
}

async function loadSignals(signalColumns) {
  const timeColumn = chooseSignalTimeColumn(signalColumns);
  const hasId = signalColumns.has('id');

  if (!timeColumn) {
    logger.warn('[BEACON] strategy_signals has no timestamp/created_at/updated_at column; using latest rows only');
  }

  const timeFilter = timeColumn ? `WHERE ss.${timeColumn} > NOW() - INTERVAL '24 hours'` : '';

  const { rows } = await queryWithTimeout(
    `SELECT ${hasId ? 'ss.id' : 'NULL::bigint'} AS signal_id,
            ss.symbol,
            ss.strategy,
            ss.score,
            ss.probability,
            ${timeColumn ? `ss.${timeColumn}` : 'NULL::timestamptz'} AS signal_time
     FROM strategy_signals ss
     ${timeFilter}
     ORDER BY ${timeColumn ? `ss.${timeColumn} DESC NULLS LAST` : 'ss.symbol ASC'}
     LIMIT ${MAX_SIGNAL_ROWS}`,
    [],
    { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: 'beacon.signals.recent' }
  );

  const bySymbol = new Map();
  for (const row of rows || []) {
    const symbol = String(row.symbol || '').toUpperCase().trim();
    if (!symbol || bySymbol.has(symbol)) continue;
    bySymbol.set(symbol, row);
  }

  return Array.from(bySymbol.values());
}

async function loadStrategyStats() {
  const exists = await tableExists('strategy_performance_dashboard');
  if (!exists) {
    logger.warn('[BEACON] strategy_performance_dashboard missing; strategy stats disabled');
    return new Map();
  }

  const { rows } = await queryWithTimeout(
    `SELECT strategy, win_rate, avg_move
     FROM strategy_performance_dashboard`,
    [],
    { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: 'beacon.strategy_stats' }
  );

  const map = new Map();
  for (const row of rows || []) {
    const strategy = String(row.strategy || '').trim();
    if (!strategy) continue;
    map.set(strategy, {
      win_rate: toNumber(row.win_rate),
      avg_move: toNumber(row.avg_move),
    });
  }
  return map;
}

async function loadOutcomeStats(outcomeColumns) {
  const hasSnapshotDate = outcomeColumns.has('snapshot_date');
  const hasCreatedAt = outcomeColumns.has('created_at');
  const orderCol = hasSnapshotDate ? 'snapshot_date' : hasCreatedAt ? 'created_at' : null;

  const { rows } = await queryWithTimeout(
    `SELECT DISTINCT ON (symbol)
            symbol,
            catalyst_score,
            sector_score,
            confirmation_score
     FROM signal_component_outcomes
    ORDER BY symbol,
          ${orderCol ? `${orderCol} DESC NULLS LAST` : 'symbol ASC'},
          id DESC NULLS LAST`,
    [],
    { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: 'beacon.outcome_stats' }
  );

  const map = new Map();
  for (const row of rows || []) {
    const symbol = String(row.symbol || '').toUpperCase().trim();
    if (!symbol) continue;
    map.set(symbol, {
      catalyst_score: toNumber(row.catalyst_score),
      sector_score: toNumber(row.sector_score),
      confirmation_score: toNumber(row.confirmation_score),
    });
  }
  return map;
}

function buildBeaconRows(signals, strategyMap, outcomeMap, weights) {
  const rows = [];

  for (const signal of signals) {
    const symbol = String(signal.symbol || '').toUpperCase().trim();
    if (!symbol) continue;

    const strategy = String(signal.strategy || '').trim();
    const signalScore = toNumber(signal.score);
    const probability = toNumber(signal.probability);

    const stats = strategyMap.get(strategy) || { win_rate: 0, avg_move: 0 };
    const outcomes = outcomeMap.get(symbol) || {
      catalyst_score: 0,
      sector_score: 0,
      confirmation_score: 0,
    };

    const beaconProbability =
      (weights.signal_weight * signalScore) +
      (weights.winrate_weight * stats.win_rate) +
      (weights.probability_weight * probability) +
      (weights.catalyst_weight * outcomes.catalyst_score) +
      (weights.sector_weight * outcomes.sector_score) +
      (weights.confirmation_weight * outcomes.confirmation_score);

    const expectedMove = stats.avg_move * signalScore;

    rows.push({
      signal_id: signal.signal_id == null ? null : Number(signal.signal_id),
      symbol,
      strategy,
      signal_score: signalScore,
      strategy_win_rate: stats.win_rate,
      avg_return: stats.avg_move,
      catalyst_score: outcomes.catalyst_score,
      sector_score: outcomes.sector_score,
      confirmation_score: outcomes.confirmation_score,
      beacon_probability: Number(beaconProbability.toFixed(6)),
      expected_move: Number(expectedMove.toFixed(6)),
    });
  }

  return rows;
}

async function writeBeaconRankings(beaconRows, rankingColumns) {
  if (!beaconRows.length) return { inserted: 0 };

  const symbols = beaconRows.map((row) => row.symbol);

  if (rankingColumns.has('symbol')) {
    await queryWithTimeout(
      `DELETE FROM beacon_rankings
       WHERE symbol = ANY($1::text[])`,
      [symbols],
      { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: 'beacon.rankings.delete_existing' }
    );
  }

  const desired = [
    'signal_id',
    'symbol',
    'strategy',
    'signal_score',
    'strategy_win_rate',
    'avg_return',
    'catalyst_score',
    'sector_score',
    'confirmation_score',
    'beacon_probability',
    'expected_move',
    'created_at',
  ];

  const insertColumns = desired.filter((column) => column === 'created_at' || rankingColumns.has(column));
  if (!insertColumns.includes('symbol') || !insertColumns.includes('strategy') || !insertColumns.includes('beacon_probability')) {
    logger.warn('[BEACON] beacon_rankings is missing required columns; insert skipped', {
      insertColumns,
    });
    return { inserted: 0 };
  }

  const valuesByColumn = {};
  for (const column of insertColumns) {
    if (column === 'created_at') {
      valuesByColumn[column] = beaconRows.map(() => new Date().toISOString());
    } else {
      valuesByColumn[column] = beaconRows.map((row) => row[column] ?? null);
    }
  }

  const castMap = {
    signal_id: 'bigint',
    symbol: 'text',
    strategy: 'text',
    signal_score: 'numeric',
    strategy_win_rate: 'numeric',
    avg_return: 'numeric',
    catalyst_score: 'numeric',
    sector_score: 'numeric',
    confirmation_score: 'numeric',
    beacon_probability: 'numeric',
    expected_move: 'numeric',
    created_at: 'timestamptz',
  };

  const selectParts = insertColumns.map((column, idx) => `unnest($${idx + 1}::${castMap[column]}[]) AS ${column}`);
  const params = insertColumns.map((column) => valuesByColumn[column]);

  const { rowCount } = await queryWithTimeout(
    `INSERT INTO beacon_rankings (${insertColumns.join(', ')})
     SELECT ${selectParts.join(', ')}`,
    params,
    { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: 'beacon.rankings.insert' }
  );

  return { inserted: Number(rowCount || 0) };
}

async function runBeaconEngine() {
  const startedAt = Date.now();

  try {
    const [rankingsExists, signalsExists, outcomesExists] = await Promise.all([
      tableExists('beacon_rankings'),
      tableExists('strategy_signals'),
      tableExists('signal_component_outcomes'),
    ]);

    if (!rankingsExists || !signalsExists) {
      logger.warn('[BEACON] required tables missing; run skipped', {
        beacon_rankings: rankingsExists,
        strategy_signals: signalsExists,
      });
      return { processed: 0, inserted: 0, skipped: true };
    }

    if (!outcomesExists) {
      logger.warn('[BEACON] signal_component_outcomes missing; component scores default to zero');
    }

    const [signalColumns, rankingColumns, outcomeColumns, weights] = await Promise.all([
      getColumns('strategy_signals'),
      getColumns('beacon_rankings'),
      outcomesExists ? getColumns('signal_component_outcomes') : Promise.resolve(new Set()),
      loadLatestWeights(),
    ]);

    const [signals, strategyMap, outcomeMap] = await Promise.all([
      loadSignals(signalColumns),
      loadStrategyStats(),
      outcomesExists ? loadOutcomeStats(outcomeColumns) : Promise.resolve(new Map()),
    ]);

    const beaconRows = buildBeaconRows(signals, strategyMap, outcomeMap, weights);
    const { inserted } = await writeBeaconRankings(beaconRows, rankingColumns);

    const runtimeMs = Date.now() - startedAt;
    logger.info('[BEACON] rankings complete', {
      processed: signals.length,
      inserted,
      runtimeMs,
    });

    return {
      processed: signals.length,
      inserted,
      runtimeMs,
    };
  } catch (error) {
    const runtimeMs = Date.now() - startedAt;
    logger.error('[BEACON] run failed', { error: error.message, runtimeMs });
    return {
      processed: 0,
      inserted: 0,
      runtimeMs,
      error: error.message,
    };
  }
}

module.exports = {
  runBeaconEngine,
};
