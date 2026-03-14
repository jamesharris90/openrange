const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

const QUERY_TIMEOUT_MS = 500;

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function correlation(xs, ys) {
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length || xs.length < 3) return 0;

  const n = xs.length;
  const meanX = xs.reduce((sum, val) => sum + val, 0) / n;
  const meanY = ys.reduce((sum, val) => sum + val, 0) / n;

  let num = 0;
  let denX = 0;
  let denY = 0;

  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const den = Math.sqrt(denX * denY);
  if (!Number.isFinite(den) || den === 0) return 0;
  return num / den;
}

async function tableExists(tableName) {
  const { rows } = await queryWithTimeout(
    `SELECT to_regclass($1) AS regclass`,
    [`public.${tableName}`],
    { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: `beacon.optimizer.table_exists.${tableName}` }
  );
  return Boolean(rows?.[0]?.regclass);
}

async function loadLearningRows() {
  const { rows } = await queryWithTimeout(
    `SELECT symbol,
            signal_id,
            actual_move,
            created_at
     FROM beacon_learning_metrics
     WHERE actual_move IS NOT NULL
       AND created_at >= NOW() - INTERVAL '90 days'
     ORDER BY created_at DESC
     LIMIT 3000`,
    [],
    { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: 'beacon.optimizer.learning_rows' }
  );

  return rows || [];
}

async function loadRankingsBySymbol(symbols) {
  if (!symbols.length) return new Map();

  const { rows } = await queryWithTimeout(
    `SELECT DISTINCT ON (symbol)
            symbol,
            signal_score,
            strategy_win_rate,
            catalyst_score,
            sector_score,
            confirmation_score,
            created_at
     FROM beacon_rankings
     WHERE symbol = ANY($1::text[])
     ORDER BY symbol, created_at DESC NULLS LAST, id DESC NULLS LAST`,
    [symbols],
    { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: 'beacon.optimizer.rankings_by_symbol' }
  );

  const map = new Map();
  for (const row of rows || []) {
    const symbol = String(row.symbol || '').toUpperCase().trim();
    if (!symbol) continue;
    map.set(symbol, row);
  }
  return map;
}

async function loadSignalsBySymbol(symbols) {
  if (!symbols.length) return new Map();

  const { rows } = await queryWithTimeout(
    `SELECT DISTINCT ON (symbol)
            symbol,
            probability,
            created_at,
            updated_at,
            timestamp
     FROM strategy_signals
     WHERE symbol = ANY($1::text[])
     ORDER BY symbol,
              COALESCE(timestamp, created_at, updated_at) DESC NULLS LAST,
              id DESC NULLS LAST`,
    [symbols],
    { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: 'beacon.optimizer.signals_by_symbol' }
  );

  const map = new Map();
  for (const row of rows || []) {
    const symbol = String(row.symbol || '').toUpperCase().trim();
    if (!symbol) continue;
    map.set(symbol, row);
  }
  return map;
}

function calculateWeights(dataset) {
  const targets = dataset.map((row) => row.actual_move);

  const fields = {
    signal_weight: dataset.map((row) => row.signal_score),
    winrate_weight: dataset.map((row) => row.strategy_win_rate),
    probability_weight: dataset.map((row) => row.probability),
    catalyst_weight: dataset.map((row) => row.catalyst_score),
    sector_weight: dataset.map((row) => row.sector_score),
    confirmation_weight: dataset.map((row) => row.confirmation_score),
  };

  const raw = {};
  for (const [weightKey, values] of Object.entries(fields)) {
    const corr = correlation(values, targets);
    raw[weightKey] = Math.max(0.05, Math.abs(corr));
  }

  const total = Object.values(raw).reduce((sum, val) => sum + val, 0) || 1;
  const normalized = {};
  for (const [key, value] of Object.entries(raw)) {
    normalized[key] = Number((value / total).toFixed(6));
  }

  return normalized;
}

async function insertWeights(weights) {
  await queryWithTimeout(
    `INSERT INTO beacon_weights (
      signal_weight,
      winrate_weight,
      probability_weight,
      catalyst_weight,
      sector_weight,
      confirmation_weight,
      created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      toNumber(weights.signal_weight, 1),
      toNumber(weights.winrate_weight, 1),
      toNumber(weights.probability_weight, 1),
      toNumber(weights.catalyst_weight, 1),
      toNumber(weights.sector_weight, 1),
      toNumber(weights.confirmation_weight, 1),
    ],
    { timeoutMs: QUERY_TIMEOUT_MS, maxRetries: 0, label: 'beacon.optimizer.insert_weights' }
  );
}

async function runBeaconOptimizer() {
  const startedAt = Date.now();

  try {
    const [learningExists, rankingsExists, weightsExists, signalsExists] = await Promise.all([
      tableExists('beacon_learning_metrics'),
      tableExists('beacon_rankings'),
      tableExists('beacon_weights'),
      tableExists('strategy_signals'),
    ]);

    if (!learningExists || !rankingsExists || !weightsExists || !signalsExists) {
      logger.warn('[BEACON_OPTIMIZER] required tables missing; run skipped', {
        beacon_learning_metrics: learningExists,
        beacon_rankings: rankingsExists,
        beacon_weights: weightsExists,
        strategy_signals: signalsExists,
      });
      return { analysed: 0, inserted: false, skipped: true };
    }

    const learningRows = await loadLearningRows();
    const symbols = [...new Set(learningRows.map((row) => String(row.symbol || '').toUpperCase().trim()).filter(Boolean))];

    const [rankingsBySymbol, signalsBySymbol] = await Promise.all([
      loadRankingsBySymbol(symbols),
      loadSignalsBySymbol(symbols),
    ]);

    const dataset = [];
    for (const row of learningRows) {
      const symbol = String(row.symbol || '').toUpperCase().trim();
      if (!symbol) continue;

      const ranking = rankingsBySymbol.get(symbol);
      if (!ranking) continue;

      const signal = signalsBySymbol.get(symbol) || {};

      dataset.push({
        signal_score: toNumber(ranking.signal_score),
        strategy_win_rate: toNumber(ranking.strategy_win_rate),
        probability: toNumber(signal.probability),
        catalyst_score: toNumber(ranking.catalyst_score),
        sector_score: toNumber(ranking.sector_score),
        confirmation_score: toNumber(ranking.confirmation_score),
        actual_move: toNumber(row.actual_move),
      });
    }

    if (dataset.length < 10) {
      logger.warn('[BEACON_OPTIMIZER] insufficient data; run skipped', { rows: dataset.length });
      return { analysed: dataset.length, inserted: false, skipped: true };
    }

    const weights = calculateWeights(dataset);
    await insertWeights(weights);

    const runtimeMs = Date.now() - startedAt;
    logger.info('[BEACON_OPTIMIZER] complete', {
      analysed: dataset.length,
      weights,
      runtimeMs,
    });

    return {
      analysed: dataset.length,
      weights,
      inserted: true,
      runtimeMs,
    };
  } catch (error) {
    const runtimeMs = Date.now() - startedAt;
    logger.error('[BEACON_OPTIMIZER] run failed', { error: error.message, runtimeMs });
    return {
      analysed: 0,
      inserted: false,
      runtimeMs,
      error: error.message,
    };
  }
}

module.exports = {
  runBeaconOptimizer,
};
