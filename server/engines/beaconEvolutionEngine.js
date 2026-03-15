const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

const QUERY_TIMEOUT_MS = 1200;
const LOOKBACK_DAYS = 30;
const MAX_SOURCE_ROWS = 5000;
const MAX_RANKING_ROWS = 1000;
const ENGINE_SOURCE = 'beaconEvolutionEngine';

const state = {
  lastRunAt: null,
  lastError: null,
  lastRuntimeMs: null,
  summary: {
    sourceRows: 0,
    cohortRows: 0,
    strategies: 0,
    adjustedRows: 0,
  },
  edge: [],
  learning: [],
  adjustedProbability: [],
};

let systemEventsAvailableCache = null;

async function systemEventsAvailable() {
  if (systemEventsAvailableCache != null) return systemEventsAvailableCache;

  try {
    const { rows } = await queryWithTimeout(
      'SELECT to_regclass($1) AS regclass',
      ['public.system_events'],
      { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: 'beacon.evolution.system_events.exists' }
    );
    systemEventsAvailableCache = Boolean(rows?.[0]?.regclass);
  } catch (_error) {
    systemEventsAvailableCache = false;
  }

  return systemEventsAvailableCache;
}

async function emitEngineEvent(eventType, metrics = {}, error = null) {
  const payload = {
    timestamp: new Date().toISOString(),
    strategies_processed: Number(metrics.strategies_processed || 0),
    signals_processed: Number(metrics.signals_processed || 0),
    adjustments_applied: Number(metrics.adjustments_applied || 0),
    run_duration_ms: Number(metrics.run_duration_ms || 0),
  };

  if (error) {
    payload.error = String(error);
  }

  if (await systemEventsAvailable()) {
    try {
      await queryWithTimeout(
        `INSERT INTO system_events (event_type, source, symbol, payload, created_at)
         VALUES ($1, $2, NULL, $3::jsonb, NOW())`,
        [String(eventType), ENGINE_SOURCE, JSON.stringify(payload)],
        { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: `beacon.evolution.event.${eventType}` }
      );
      return;
    } catch (_error) {
      systemEventsAvailableCache = false;
    }
  }

  const line = JSON.stringify({ event_type: eventType, source: ENGINE_SOURCE, ...payload });
  if (eventType === 'ENGINE_ERROR') {
    console.error(line);
    return;
  }
  console.log(line);
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round6(value) {
  return Number(toNumber(value).toFixed(6));
}

function normalizeText(value, fallback = 'unknown') {
  const normalized = String(value == null ? '' : value).trim().toLowerCase();
  return normalized || fallback;
}

async function tableExists(tableName) {
  const { rows } = await queryWithTimeout(
    'SELECT to_regclass($1) AS regclass',
    [`public.${tableName}`],
    { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: `beacon.evolution.table_exists.${tableName}` }
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
    { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: `beacon.evolution.columns.${tableName}` }
  );
  return new Set((rows || []).map((row) => String(row.column_name || '')));
}

function pickFirst(columns, candidates) {
  for (const candidate of candidates) {
    if (columns.has(candidate)) return candidate;
  }
  return null;
}

function buildSuccessExpression(columns, alias) {
  const boolColumn = pickFirst(columns, ['success', 'is_win', 'win', 'outcome_win', 'profitable']);
  if (boolColumn) {
    return `CASE WHEN ${alias}.${boolColumn} IS NULL THEN NULL WHEN ${alias}.${boolColumn} THEN 1 ELSE 0 END`;
  }

  const numericColumn = pickFirst(columns, [
    'return_percent',
    'pnl_percent',
    'profit_percent',
    'move_percent',
    'actual_move_percent',
    'return_pct',
  ]);

  if (numericColumn) {
    return `CASE WHEN ${alias}.${numericColumn} IS NULL THEN NULL WHEN ${alias}.${numericColumn} > 0 THEN 1 ELSE 0 END`;
  }

  return 'NULL::int';
}

function buildSourceQuery(tableName, alias, columns) {
  const strategyCol = pickFirst(columns, ['strategy', 'trade_strategy', 'setup_strategy']);
  const signalTypeCol = pickFirst(columns, ['signal_type', 'setup_type', 'trigger_type', 'signal_name', 'strategy']);
  const sectorCol = pickFirst(columns, ['sector', 'gics_sector', 'sector_name']);
  const regimeCol = pickFirst(columns, ['market_regime', 'regime', 'market_state']);
  const timeCol = pickFirst(columns, ['evaluated_at', 'closed_at', 'exit_time', 'created_at', 'updated_at']);
  const successExpr = buildSuccessExpression(columns, alias);

  const strategyExpr = strategyCol ? `${alias}.${strategyCol}` : 'NULL::text';
  const signalTypeExpr = signalTypeCol ? `${alias}.${signalTypeCol}` : 'NULL::text';
  const sectorExpr = sectorCol ? `${alias}.${sectorCol}` : 'NULL::text';
  const regimeExpr = regimeCol ? `${alias}.${regimeCol}` : 'NULL::text';
  const timeExpr = timeCol ? `${alias}.${timeCol}` : 'NULL::timestamptz';

  const whereClause = timeCol
    ? `WHERE ${alias}.${timeCol} >= NOW() - INTERVAL '${LOOKBACK_DAYS} days'`
    : '';

  const orderClause = timeCol ? `ORDER BY ${alias}.${timeCol} DESC NULLS LAST` : '';

  return `SELECT
            ${strategyExpr}::text AS strategy,
            ${signalTypeExpr}::text AS signal_type,
            ${sectorExpr}::text AS sector,
            ${regimeExpr}::text AS market_regime,
            ${successExpr} AS success,
            ${timeExpr} AS observed_at
          FROM ${tableName} ${alias}
          ${whereClause}
          ${orderClause}
          LIMIT ${MAX_SOURCE_ROWS}`;
}

async function loadSignalRows() {
  const [outcomesExists, tradesExists] = await Promise.all([
    tableExists('signal_outcomes'),
    tableExists('strategy_trades'),
  ]);

  const rows = [];

  if (outcomesExists) {
    const columns = await getColumns('signal_outcomes');
    const { rows: sourceRows } = await queryWithTimeout(
      buildSourceQuery('signal_outcomes', 'so', columns),
      [],
      { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: 'beacon.evolution.load.signal_outcomes' }
    );
    rows.push(...(sourceRows || []));
  }

  if (tradesExists) {
    const columns = await getColumns('strategy_trades');
    const { rows: sourceRows } = await queryWithTimeout(
      buildSourceQuery('strategy_trades', 'st', columns),
      [],
      { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: 'beacon.evolution.load.strategy_trades' }
    );
    rows.push(...(sourceRows || []));
  }

  return rows;
}

async function loadValidationBaseline() {
  const exists = await tableExists('signal_validation_daily');
  if (!exists) {
    return {
      learningScore: 0.5,
      rankingAccuracy: 1,
    };
  }

  const { rows } = await queryWithTimeout(
    `SELECT
       AVG(learning_score)::numeric AS learning_score,
       AVG(ranking_accuracy)::numeric AS ranking_accuracy
     FROM signal_validation_daily
     WHERE date >= CURRENT_DATE - INTERVAL '${LOOKBACK_DAYS} days'`,
    [],
    { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: 'beacon.evolution.validation_baseline' }
  );

  return {
    learningScore: toNumber(rows?.[0]?.learning_score, 0.5),
    rankingAccuracy: toNumber(rows?.[0]?.ranking_accuracy, 1),
  };
}

async function loadStrategyLearningPriors() {
  const exists = await tableExists('strategy_learning_metrics');
  if (!exists) {
    return {
      columns: new Set(),
      priors: new Map(),
    };
  }

  const columns = await getColumns('strategy_learning_metrics');
  const selectColumns = [
    'strategy',
    columns.has('edge_score') ? 'edge_score' : 'NULL::numeric AS edge_score',
    columns.has('learning_score') ? 'learning_score' : 'NULL::numeric AS learning_score',
    columns.has('win_rate') ? 'win_rate' : 'NULL::numeric AS win_rate',
  ];

  const { rows } = await queryWithTimeout(
    `SELECT ${selectColumns.join(', ')}
     FROM strategy_learning_metrics`,
    [],
    { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: 'beacon.evolution.strategy_priors' }
  );

  const priors = new Map();
  for (const row of rows || []) {
    const strategy = normalizeText(row.strategy);
    if (!strategy || strategy === 'unknown') continue;

    priors.set(strategy, {
      edgeScore: toNumber(row.edge_score, 0.5),
      learningScore: toNumber(row.learning_score, 0.5),
      winRate: toNumber(row.win_rate, 0.5),
    });
  }

  return { columns, priors };
}

function aggregateCohorts(rows) {
  const cohorts = new Map();
  const strategyStats = new Map();

  for (const row of rows) {
    if (row.success == null) continue;

    const strategy = normalizeText(row.strategy);
    const signalType = normalizeText(row.signal_type);
    const sector = normalizeText(row.sector);
    const marketRegime = normalizeText(row.market_regime, 'neutral');
    const success = toNumber(row.success, 0) > 0 ? 1 : 0;

    const key = [strategy, signalType, sector, marketRegime].join('|');
    const cohort = cohorts.get(key) || {
      strategy,
      signal_type: signalType,
      sector,
      market_regime: marketRegime,
      trades: 0,
      wins: 0,
      rolling_win_rate: 0,
    };

    cohort.trades += 1;
    cohort.wins += success;
    cohort.rolling_win_rate = cohort.trades > 0 ? cohort.wins / cohort.trades : 0;
    cohorts.set(key, cohort);

    const strategyRow = strategyStats.get(strategy) || {
      strategy,
      trades: 0,
      wins: 0,
      rolling_win_rate: 0,
    };

    strategyRow.trades += 1;
    strategyRow.wins += success;
    strategyRow.rolling_win_rate = strategyRow.trades > 0 ? strategyRow.wins / strategyRow.trades : 0;
    strategyStats.set(strategy, strategyRow);
  }

  return {
    cohorts: Array.from(cohorts.values()),
    strategyStats,
  };
}

function buildStrategyAdjustments(strategyStats, priors, validationBaseline, globalWinRate) {
  const rows = [];

  for (const [strategy, stat] of strategyStats.entries()) {
    const prior = priors.get(strategy) || {
      edgeScore: 0.5,
      learningScore: 0.5,
      winRate: globalWinRate,
    };

    const sampleConfidence = clamp(stat.trades / 30, 0.2, 1);
    const blendedWinRate = clamp(
      (stat.rolling_win_rate * sampleConfidence) + (prior.winRate * (1 - sampleConfidence)),
      0,
      1
    );

    const edgeScore = clamp(
      blendedWinRate * 0.7 + sampleConfidence * 0.2 + prior.edgeScore * 0.1,
      0,
      1
    );

    const learningScore = clamp(
      edgeScore * 0.7 + validationBaseline.learningScore * 0.3,
      0,
      1
    );

    const strategyWeightScore = clamp(
      1 + ((blendedWinRate - globalWinRate) * 1.25) + ((prior.edgeScore - 0.5) * 0.3),
      0.65,
      1.6
    );

    const probabilityAdjustmentFactor = clamp(
      1 + ((blendedWinRate - globalWinRate) * 0.9) + ((validationBaseline.rankingAccuracy - 1) * 0.15),
      0.75,
      1.3
    );

    rows.push({
      strategy,
      signals_count: stat.trades,
      win_rate: round6(blendedWinRate),
      edge_score: round6(edgeScore),
      learning_score: round6(learningScore),
      strategy_weight_score: round6(strategyWeightScore),
      probability_adjustment_factor: round6(probabilityAdjustmentFactor),
    });
  }

  rows.sort((a, b) => b.edge_score - a.edge_score);
  return rows;
}

async function persistStrategyLearningMetrics(rows, columns) {
  if (!rows.length || !columns.has('strategy')) return { updated: 0, inserted: 0 };

  let updated = 0;
  let inserted = 0;

  for (const row of rows) {
    const updateParts = [];
    const updateParams = [];

    if (columns.has('signals_count')) {
      updateParams.push(row.signals_count);
      updateParts.push(`signals_count = $${updateParams.length}`);
    }

    if (columns.has('win_rate')) {
      updateParams.push(row.win_rate);
      updateParts.push(`win_rate = $${updateParams.length}`);
    }

    if (columns.has('edge_score')) {
      updateParams.push(row.edge_score);
      updateParts.push(`edge_score = $${updateParams.length}`);
    }

    if (columns.has('learning_score')) {
      updateParams.push(row.learning_score);
      updateParts.push(`learning_score = $${updateParams.length}`);
    }

    if (columns.has('strategy_weight_score')) {
      updateParams.push(row.strategy_weight_score);
      updateParts.push(`strategy_weight_score = $${updateParams.length}`);
    }

    if (columns.has('probability_adjustment_factor')) {
      updateParams.push(row.probability_adjustment_factor);
      updateParts.push(`probability_adjustment_factor = $${updateParams.length}`);
    }

    if (columns.has('updated_at')) {
      updateParts.push('updated_at = NOW()');
    }

    if (!updateParts.length) continue;

    updateParams.push(row.strategy);

    const updateResult = await queryWithTimeout(
      `UPDATE strategy_learning_metrics
       SET ${updateParts.join(', ')}
       WHERE strategy = $${updateParams.length}`,
      updateParams,
      { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: 'beacon.evolution.strategy_metrics.update' }
    );

    if (Number(updateResult?.rowCount || 0) > 0) {
      updated += Number(updateResult.rowCount || 0);
      continue;
    }

    const insertColumns = ['strategy'];
    const insertValues = [row.strategy];

    if (columns.has('signals_count')) {
      insertColumns.push('signals_count');
      insertValues.push(row.signals_count);
    }

    if (columns.has('win_rate')) {
      insertColumns.push('win_rate');
      insertValues.push(row.win_rate);
    }

    if (columns.has('edge_score')) {
      insertColumns.push('edge_score');
      insertValues.push(row.edge_score);
    }

    if (columns.has('learning_score')) {
      insertColumns.push('learning_score');
      insertValues.push(row.learning_score);
    }

    if (columns.has('strategy_weight_score')) {
      insertColumns.push('strategy_weight_score');
      insertValues.push(row.strategy_weight_score);
    }

    if (columns.has('probability_adjustment_factor')) {
      insertColumns.push('probability_adjustment_factor');
      insertValues.push(row.probability_adjustment_factor);
    }

    if (columns.has('updated_at')) {
      insertColumns.push('updated_at');
      insertValues.push(new Date().toISOString());
    }

    const placeholders = insertValues.map((_, idx) => `$${idx + 1}`);

    const insertResult = await queryWithTimeout(
      `INSERT INTO strategy_learning_metrics (${insertColumns.join(', ')})
       VALUES (${placeholders.join(', ')})`,
      insertValues,
      { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: 'beacon.evolution.strategy_metrics.insert' }
    );

    inserted += Number(insertResult?.rowCount || 0);
  }

  return { updated, inserted };
}

async function adjustBeaconRankings(adjustmentsByStrategy) {
  const exists = await tableExists('beacon_rankings');
  if (!exists || !adjustmentsByStrategy.size) {
    return { updated: 0, rows: [] };
  }

  const columns = await getColumns('beacon_rankings');
  const hasCtid = true;
  const createdAtCol = pickFirst(columns, ['created_at', 'updated_at']);

  const timeFilter = createdAtCol
    ? `WHERE ${createdAtCol} >= NOW() - INTERVAL '${LOOKBACK_DAYS} days'`
    : '';

  const { rows } = await queryWithTimeout(
    `SELECT ctid::text AS row_pointer,
            strategy,
            beacon_probability
     FROM beacon_rankings
     ${timeFilter}
     ORDER BY ${createdAtCol ? `${createdAtCol} DESC NULLS LAST` : 'beacon_probability DESC NULLS LAST'}
     LIMIT ${MAX_RANKING_ROWS}`,
    [],
    { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: 'beacon.evolution.load.beacon_rankings' }
  );

  if (!hasCtid || !rows?.length) {
    return { updated: 0, rows: [] };
  }

  const adjustedRows = [];
  let updated = 0;

  for (const row of rows) {
    const strategy = normalizeText(row.strategy);
    const adjustment = adjustmentsByStrategy.get(strategy);
    if (!adjustment) continue;

    const baseProbability = toNumber(row.beacon_probability);
    const factor = toNumber(adjustment.probability_adjustment_factor, 1);
    const adjustedProbability = clamp(baseProbability * factor, 0, 1);

    const setParts = [];
    const params = [];

    if (columns.has('adjusted_probability')) {
      params.push(round6(adjustedProbability));
      setParts.push(`adjusted_probability = $${params.length}`);
    }

    if (columns.has('probability_adjustment_factor')) {
      params.push(round6(factor));
      setParts.push(`probability_adjustment_factor = $${params.length}`);
    }

    if (columns.has('strategy_weight_score')) {
      params.push(round6(adjustment.strategy_weight_score));
      setParts.push(`strategy_weight_score = $${params.length}`);
    }

    if (!columns.has('adjusted_probability') && columns.has('beacon_probability')) {
      params.push(round6(adjustedProbability));
      setParts.push(`beacon_probability = $${params.length}`);
    }

    if (columns.has('updated_at')) {
      setParts.push('updated_at = NOW()');
    }

    if (!setParts.length) continue;

    params.push(row.row_pointer);

    const result = await queryWithTimeout(
      `UPDATE beacon_rankings
       SET ${setParts.join(', ')}
       WHERE ctid::text = $${params.length}`,
      params,
      { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: 'beacon.evolution.beacon_rankings.adjust' }
    );

    updated += Number(result?.rowCount || 0);

    adjustedRows.push({
      strategy,
      base_probability: round6(baseProbability),
      adjustment_factor: round6(factor),
      adjusted_probability: round6(adjustedProbability),
    });
  }

  adjustedRows.sort((a, b) => b.adjusted_probability - a.adjusted_probability);
  return { updated, rows: adjustedRows.slice(0, 100) };
}

async function runBeaconEvolutionEngine() {
  const startedAt = Date.now();
  await emitEngineEvent('ENGINE_START', {
    strategies_processed: 0,
    signals_processed: 0,
    adjustments_applied: 0,
    run_duration_ms: 0,
  });

  try {
    const [sourceRows, validationBaseline, learningData] = await Promise.all([
      loadSignalRows(),
      loadValidationBaseline(),
      loadStrategyLearningPriors(),
    ]);

    const { cohorts, strategyStats } = aggregateCohorts(sourceRows);

    let globalWins = 0;
    let globalTrades = 0;
    for (const strategyRow of strategyStats.values()) {
      globalWins += strategyRow.wins;
      globalTrades += strategyRow.trades;
    }

    const globalWinRate = globalTrades > 0 ? globalWins / globalTrades : 0.5;

    const strategyAdjustments = buildStrategyAdjustments(
      strategyStats,
      learningData.priors,
      validationBaseline,
      globalWinRate
    );

    const adjustmentsByStrategy = new Map(
      strategyAdjustments.map((row) => [row.strategy, row])
    );

    const [learningPersist, adjustedResult] = await Promise.all([
      persistStrategyLearningMetrics(strategyAdjustments, learningData.columns),
      adjustBeaconRankings(adjustmentsByStrategy),
    ]);

    const runtimeMs = Date.now() - startedAt;

    state.lastRunAt = new Date().toISOString();
    state.lastError = null;
    state.lastRuntimeMs = runtimeMs;
    state.summary = {
      sourceRows: sourceRows.length,
      cohortRows: cohorts.length,
      strategies: strategyAdjustments.length,
      adjustedRows: adjustedResult.updated,
      learningUpdates: learningPersist.updated,
      learningInserts: learningPersist.inserted,
    };
    state.edge = strategyAdjustments.slice(0, 50);
    state.learning = cohorts
      .sort((a, b) => b.rolling_win_rate - a.rolling_win_rate)
      .slice(0, 200)
      .map((row) => ({
        strategy: row.strategy,
        signal_type: row.signal_type,
        sector: row.sector,
        market_regime: row.market_regime,
        trades: row.trades,
        wins: row.wins,
        rolling_win_rate: round6(row.rolling_win_rate),
      }));
    state.adjustedProbability = adjustedResult.rows;

    logger.info('[BEACON_EVOLUTION] complete', {
      sourceRows: sourceRows.length,
      cohorts: cohorts.length,
      strategies: strategyAdjustments.length,
      learningUpdated: learningPersist.updated,
      learningInserted: learningPersist.inserted,
      rankingsAdjusted: adjustedResult.updated,
      runtimeMs,
    });

    await emitEngineEvent('ENGINE_COMPLETE', {
      strategies_processed: strategyAdjustments.length,
      signals_processed: sourceRows.length,
      adjustments_applied: adjustedResult.updated,
      run_duration_ms: runtimeMs,
    });

    return {
      ok: true,
      runtimeMs,
      ...state.summary,
    };
  } catch (error) {
    const runtimeMs = Date.now() - startedAt;
    state.lastRunAt = new Date().toISOString();
    state.lastError = error.message;
    state.lastRuntimeMs = runtimeMs;

    logger.error('[BEACON_EVOLUTION] run failed', {
      error: error.message,
      runtimeMs,
    });

    await emitEngineEvent(
      'ENGINE_ERROR',
      {
        strategies_processed: Number(state.summary?.strategies || 0),
        signals_processed: Number(state.summary?.sourceRows || 0),
        adjustments_applied: Number(state.summary?.adjustedRows || 0),
        run_duration_ms: runtimeMs,
      },
      error.message
    );

    return {
      ok: false,
      runtimeMs,
      error: error.message,
    };
  }
}

function getBeaconEvolutionState() {
  return {
    ...state,
    edge: [...state.edge],
    learning: [...state.learning],
    adjustedProbability: [...state.adjustedProbability],
  };
}

module.exports = {
  runBeaconEvolutionEngine,
  getBeaconEvolutionState,
};
