const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '../../logs/trade-outcomes.json');
let strategyPerformanceWritable = null;

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function minutesBetween(start, end) {
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 60000);
}

async function ensureTradeOutcomeTables() {
  const requiredTables = ['trade_signals', 'trade_outcomes', 'strategy_performance'];
  for (const table of requiredTables) {
    const { rows } = await queryWithTimeout(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = $1
       ) AS exists`,
      [table],
      { timeoutMs: 3000, label: `engines.trade_outcome.preflight.${table}`, maxRetries: 0 }
    );
    if (!rows?.[0]?.exists) {
      throw new Error(`Missing required table: ${table}`);
    }
  }
}

async function canWriteStrategyPerformance() {
  if (strategyPerformanceWritable !== null) {
    return strategyPerformanceWritable;
  }

  const { rows } = await queryWithTimeout(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.views
       WHERE table_schema = 'public'
         AND table_name = 'strategy_performance'
     ) AS is_view`,
    [],
    { timeoutMs: 3000, label: 'engines.trade_outcome.strategy_performance_relation', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  strategyPerformanceWritable = !Boolean(rows?.[0]?.is_view);
  return strategyPerformanceWritable;
}

async function recordSignal(signal = {}) {
  await ensureTradeOutcomeTables();

  const symbol = String(signal.symbol || '').toUpperCase().trim();
  const setupType = String(signal.setup_type || signal.setupType || signal.strategy || 'unknown').trim();
  const entryPrice = toNumber(signal.entry_price ?? signal.entryPrice ?? signal.price, 0);
  const rvol = toNumber(signal.rvol ?? signal.relative_volume ?? signal.relativeVolume, 0);
  const strategy = String(signal.strategy || setupType || 'unknown').trim();
  const sourceEngine = String(signal.source_engine || signal.sourceEngine || 'stocksInPlayEngine').trim();

  if (!symbol || entryPrice <= 0 || rvol <= 0) {
    return { success: false, skipped: true, reason: 'invalid_signal' };
  }

  const { rows } = await queryWithTimeout(
    `INSERT INTO trade_signals (
       symbol,
       setup_type,
       entry_price,
       rvol,
       "timestamp",
       strategy,
       source_engine,
       score,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, NOW(), NOW())
     ON CONFLICT (symbol)
     DO UPDATE SET
       setup_type = EXCLUDED.setup_type,
       entry_price = EXCLUDED.entry_price,
       rvol = EXCLUDED.rvol,
       "timestamp" = EXCLUDED."timestamp",
       strategy = EXCLUDED.strategy,
       source_engine = EXCLUDED.source_engine,
       score = EXCLUDED.score,
       updated_at = NOW()
     RETURNING id`,
    [
      symbol,
      setupType,
      entryPrice,
      rvol,
      strategy,
      sourceEngine,
      toNumber(signal.score ?? signal.tradeScore, 0),
    ],
    { timeoutMs: 7000, label: 'engines.trade_outcome.record_signal', maxRetries: 0 }
  );

  return { success: true, signalId: rows?.[0]?.id || null, symbol };
}

function classifyOutcome({ isLong, takeProfit, stopLoss, bars }) {
  let maxMovePrice = -Infinity;
  let minMovePrice = Infinity;
  let tpHitAt = null;
  let slHitAt = null;

  for (const bar of bars) {
    const high = toNumber(bar.high, toNumber(bar.close, 0));
    const low = toNumber(bar.low, toNumber(bar.close, 0));
    const ts = bar.ts;
    if (high <= 0 || low <= 0 || !ts) continue;

    if (high > maxMovePrice) maxMovePrice = high;
    if (low < minMovePrice) minMovePrice = low;

    if (isLong) {
      if (!tpHitAt && high >= takeProfit) tpHitAt = ts;
      if (!slHitAt && stopLoss > 0 && low <= stopLoss) slHitAt = ts;
    } else {
      if (!tpHitAt && low <= takeProfit) tpHitAt = ts;
      if (!slHitAt && stopLoss > 0 && high >= stopLoss) slHitAt = ts;
    }
  }

  if (!Number.isFinite(maxMovePrice)) maxMovePrice = 0;
  if (!Number.isFinite(minMovePrice)) minMovePrice = 0;

  let outcome = 'partial';
  if (tpHitAt && (!slHitAt || new Date(tpHitAt).getTime() <= new Date(slHitAt).getTime())) {
    outcome = 'win';
  } else if (slHitAt && (!tpHitAt || new Date(slHitAt).getTime() < new Date(tpHitAt).getTime())) {
    outcome = 'loss';
  }

  return {
    outcome,
    maxMovePrice,
    minMovePrice,
    tpHitAt,
    slHitAt,
  };
}

async function evaluateSignals() {
  await ensureTradeOutcomeTables();

  const validateOutcomeWrite = ({ symbol, pnlPct }) => {
    if (!symbol || String(symbol).trim() === '' || pnlPct === undefined) {
      console.error('INVALID OUTCOME WRITE BLOCKED', {
        writer: 'tradeOutcomeEngine.evaluateSignals',
        symbol,
        pnl_pct: pnlPct,
      });
      throw new Error('INVALID OUTCOME WRITE BLOCKED');
    }
  };

  const { rows: opportunities } = await queryWithTimeout(
    `SELECT
       o.id AS opportunity_id,
       o.symbol,
       o.entry,
       o.stop_loss,
       o.take_profit,
       o.expected_move_percent,
       o.created_at,
       s.id AS signal_id,
       s.signal_type,
       COALESCE(ct.catalyst_type, 'unknown') AS catalyst_type,
       COALESCE(mq.sector, 'Unknown') AS sector
     FROM opportunities o
     LEFT JOIN LATERAL (
       SELECT id, signal_type, catalyst_ids
       FROM signals
       WHERE id = o.signal_ids[1]
       LIMIT 1
     ) s ON TRUE
     LEFT JOIN LATERAL (
       SELECT ce.catalyst_type
       FROM catalyst_events ce
       WHERE s.catalyst_ids IS NOT NULL
         AND ce.event_uuid = ANY(s.catalyst_ids)
       GROUP BY ce.catalyst_type
       ORDER BY COUNT(*) DESC, ce.catalyst_type ASC
       LIMIT 1
     ) ct ON TRUE
     LEFT JOIN market_quotes mq ON mq.symbol = o.symbol
     WHERE o.signal_ids IS NOT NULL
       AND array_length(o.signal_ids, 1) > 0
       AND o.created_at <= NOW() - INTERVAL '15 minutes'
       AND COALESCE(o.entry, 0) > 0
     ORDER BY o.created_at ASC
     LIMIT 300`,
    [],
    { timeoutMs: 10000, label: 'engines.trade_outcome.pending_opportunities', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  let evaluated = 0;
  let missingPriceData = 0;

  for (const opp of opportunities || []) {
    const symbol = String(opp.symbol || '').toUpperCase().trim();
    const entry = toNumber(opp.entry, 0);
    const stopLoss = toNumber(opp.stop_loss, 0);
    const takeProfit = toNumber(opp.take_profit, 0);
    const createdAt = opp.created_at || null;

    if (!symbol || entry <= 0 || !createdAt) {
      continue;
    }

    const { rows: bars } = await queryWithTimeout(
      `SELECT
         timestamp AS ts,
         COALESCE(high, close) AS high,
         COALESCE(low, close) AS low,
         close AS close
       FROM intraday_1m
       WHERE symbol = $1
         AND timestamp >= $2
       ORDER BY timestamp ASC
       LIMIT 5000`,
      [symbol, createdAt],
      { timeoutMs: 8000, label: 'engines.trade_outcome.load_price_series', maxRetries: 0 }
    ).catch(() => ({ rows: [] }));

    if (!bars?.length) {
      missingPriceData += 1;
      continue;
    }

    const isLong = takeProfit >= entry;
    const result = classifyOutcome({
      isLong,
      takeProfit,
      stopLoss,
      bars,
    });

    const actualMaxMovePercent = ((toNumber(result.maxMovePrice, entry) - entry) / entry) * 100;
    const finalClose = toNumber(bars[bars.length - 1]?.close, entry);
    const pnlPct = ((finalClose - entry) / entry) * 100;
    const maxDrawdownPct = ((toNumber(result.minMovePrice, entry) - entry) / entry) * 100;
    const timeToTargetMinutes = result.tpHitAt ? minutesBetween(createdAt, result.tpHitAt) : null;

    validateOutcomeWrite({ symbol, pnlPct });

    // Append-only snapshots; no upserts to preserve historical truth.
    await queryWithTimeout(
      `INSERT INTO trade_outcomes (
        signal_id,
         symbol,
         opportunity_id,
         entry_price,
         stop_loss,
         take_profit,
         expected_move_percent,
        max_move,
        max_drawdown_pct,
        pnl_pct,
         actual_max_move_percent,
         outcome,
         time_to_target_minutes,
         data_quality,
         calibration_eligible,
         created_at,
         evaluated_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())`,
      [
        opp.signal_id,
        symbol,
        opp.opportunity_id,
        entry,
        stopLoss,
        takeProfit,
        toNumber(opp.expected_move_percent, 0),
        actualMaxMovePercent,
        maxDrawdownPct,
        pnlPct,
        actualMaxMovePercent,
        result.outcome,
        timeToTargetMinutes,
        'trusted_live',
        true,
        createdAt,
      ],
      { timeoutMs: 7000, label: 'engines.trade_outcome.insert_outcome_snapshot', maxRetries: 0 }
    );

    evaluated += 1;
  }

  await updateStrategyStats();

  if ((opportunities?.length || 0) > 0 && evaluated === 0) {
    throw new Error('No outcomes recorded after opportunities generated');
  }

  if (missingPriceData > 0) {
    logger.warn('[TRADE_OUTCOME] missing price data for opportunities', {
      missingPriceData,
      pending: opportunities?.length || 0,
      evaluated,
    });
  }

  logger.info('[TRADE_OUTCOME] evaluation cycle complete', {
    evaluated,
    pending: opportunities?.length || 0,
    missingPriceData,
  });

  return {
    evaluated,
    pending: opportunities?.length || 0,
    missingPriceData,
  };
}

async function updateStrategyStats() {
  await ensureTradeOutcomeTables();

  if (!(await canWriteStrategyPerformance())) {
    logger.warn('[TRADE_OUTCOME] strategy_performance is read-only; skipping writeback');
    return {
      skipped: true,
      reason: 'read_only_view',
    };
  }

  const { rows } = await queryWithTimeout(
    `WITH latest_per_opportunity AS (
       SELECT DISTINCT ON (o.opportunity_id)
         o.id,
         o.opportunity_id,
         o.symbol,
         o.entry_price,
         o.stop_loss,
         o.take_profit,
         o.actual_max_move_percent,
         o.outcome,
         o.time_to_target_minutes,
         o.evaluated_at
       FROM trade_outcomes o
       WHERE o.opportunity_id IS NOT NULL
         AND COALESCE(o.calibration_eligible, FALSE) = TRUE
         AND COALESCE(o.data_quality, 'legacy') = 'trusted_live'
       ORDER BY o.opportunity_id, o.evaluated_at DESC
     ), enriched AS (
       SELECT
         lop.*,
         COALESCE(s.signal_type, 'unknown') AS signal_type,
         COALESCE(ct.catalyst_type, 'unknown') AS catalyst_type,
         COALESCE(mq.sector, 'Unknown') AS sector,
         CASE
           WHEN lop.outcome = 'win' THEN ABS(((lop.take_profit - lop.entry_price) / NULLIF(lop.entry_price, 0)) * 100)
           WHEN lop.outcome = 'loss' THEN -ABS(((lop.stop_loss - lop.entry_price) / NULLIF(lop.entry_price, 0)) * 100)
           ELSE COALESCE(lop.actual_max_move_percent, 0)
         END AS return_percent,
         CASE
           WHEN lop.take_profit >= lop.entry_price
             THEN GREATEST(((lop.entry_price - lop.stop_loss) / NULLIF(lop.entry_price, 0)) * 100, 0)
           ELSE GREATEST(((lop.stop_loss - lop.entry_price) / NULLIF(lop.entry_price, 0)) * 100, 0)
         END AS drawdown_percent
       FROM latest_per_opportunity lop
       LEFT JOIN opportunities op ON op.id = lop.opportunity_id
       LEFT JOIN LATERAL (
         SELECT id, signal_type, catalyst_ids
         FROM signals
         WHERE id = op.signal_ids[1]
         LIMIT 1
       ) s ON TRUE
       LEFT JOIN LATERAL (
         SELECT ce.catalyst_type
         FROM catalyst_events ce
         WHERE s.catalyst_ids IS NOT NULL
           AND ce.event_uuid = ANY(s.catalyst_ids)
         GROUP BY ce.catalyst_type
         ORDER BY COUNT(*) DESC, ce.catalyst_type ASC
         LIMIT 1
       ) ct ON TRUE
       LEFT JOIN market_quotes mq ON mq.symbol = lop.symbol
     )
     SELECT
       signal_type,
       catalyst_type,
       sector,
       COUNT(*)::int AS sample_size,
       AVG(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END)::numeric AS win_rate,
       AVG(return_percent)::numeric AS avg_return,
       AVG(drawdown_percent)::numeric AS avg_drawdown,
       AVG(time_to_target_minutes)::numeric AS avg_time_to_target_minutes
     FROM enriched
     GROUP BY signal_type, catalyst_type, sector`,
    [],
    { timeoutMs: 12000, label: 'engines.trade_outcome.aggregate_performance', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  const bySignalType = new Map();
  for (const row of rows || []) {
    const key = String(row.signal_type || 'unknown');
    const existing = bySignalType.get(key) || {
      sample_size: 0,
      weighted_win: 0,
      weighted_return: 0,
      weighted_drawdown: 0,
    };
    const sampleSize = Number(row.sample_size || 0);
    existing.sample_size += sampleSize;
    existing.weighted_win += Number(row.win_rate || 0) * sampleSize;
    existing.weighted_return += Number(row.avg_return || 0) * sampleSize;
    existing.weighted_drawdown += Number(row.avg_drawdown || 0) * sampleSize;
    bySignalType.set(key, existing);
  }

  for (const [signalType, agg] of bySignalType.entries()) {
    const sampleSize = Number(agg.sample_size || 0);
    const winRate = sampleSize > 0 ? Number(agg.weighted_win / sampleSize) : 0.5;
    const avgReturn = sampleSize > 0 ? Number(agg.weighted_return / sampleSize) : 0;
    const avgDrawdown = sampleSize > 0 ? Number(agg.weighted_drawdown / sampleSize) : 0;

    await queryWithTimeout(
      `INSERT INTO strategy_performance (strategy, trades, win_rate, avg_return, volatility)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (strategy)
       DO UPDATE SET
         trades = EXCLUDED.trades,
         win_rate = EXCLUDED.win_rate,
         avg_return = EXCLUDED.avg_return,
         volatility = EXCLUDED.volatility`,
      [signalType, sampleSize, winRate, avgReturn, avgDrawdown],
      { timeoutMs: 7000, label: 'engines.trade_outcome.upsert_strategy_performance', maxRetries: 0 }
    );
  }

  return {
    grouped_rows: rows?.length || 0,
    updated_signal_types: bySignalType.size,
  };
}

async function getStrategyStats(setupType) {
  await ensureTradeOutcomeTables();

  const input = String(setupType || '').trim();
  if (!input) return null;

  const { rows } = await queryWithTimeout(
    `SELECT
       strategy AS signal_type,
       trades AS sample_size,
       win_rate,
       avg_return AS avg_move,
       volatility AS avg_drawdown,
       NULL::timestamptz AS last_updated
     FROM strategy_performance
     WHERE strategy = $1
     LIMIT 1`,
    [input],
    { timeoutMs: 4000, label: 'engines.trade_outcome.get_strategy_stats', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  return rows?.[0] || null;
}

async function getPerformanceMetrics(limit = 200) {
  await ensureTradeOutcomeTables();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));

  const { rows } = await queryWithTimeout(
    `WITH latest_per_opportunity AS (
       SELECT DISTINCT ON (o.opportunity_id)
         o.opportunity_id,
         o.symbol,
         o.entry_price,
         o.stop_loss,
         o.take_profit,
         o.actual_max_move_percent,
         o.outcome,
         o.time_to_target_minutes,
         o.evaluated_at
       FROM trade_outcomes o
       WHERE o.opportunity_id IS NOT NULL
       ORDER BY o.opportunity_id, o.evaluated_at DESC
     ), enriched AS (
       SELECT
         lop.*,
         COALESCE(s.signal_type, 'unknown') AS signal_type,
         COALESCE(ct.catalyst_type, 'unknown') AS catalyst_type,
         COALESCE(mq.sector, 'Unknown') AS sector,
         CASE
           WHEN lop.outcome = 'win' THEN ABS(((lop.take_profit - lop.entry_price) / NULLIF(lop.entry_price, 0)) * 100)
           WHEN lop.outcome = 'loss' THEN -ABS(((lop.stop_loss - lop.entry_price) / NULLIF(lop.entry_price, 0)) * 100)
           ELSE COALESCE(lop.actual_max_move_percent, 0)
         END AS return_percent,
         CASE
           WHEN lop.take_profit >= lop.entry_price
             THEN GREATEST(((lop.entry_price - lop.stop_loss) / NULLIF(lop.entry_price, 0)) * 100, 0)
           ELSE GREATEST(((lop.stop_loss - lop.entry_price) / NULLIF(lop.entry_price, 0)) * 100, 0)
         END AS drawdown_percent
       FROM latest_per_opportunity lop
       LEFT JOIN opportunities op ON op.id = lop.opportunity_id
       LEFT JOIN LATERAL (
         SELECT id, signal_type, catalyst_ids
         FROM signals
         WHERE id = op.signal_ids[1]
         LIMIT 1
       ) s ON TRUE
       LEFT JOIN LATERAL (
         SELECT ce.catalyst_type
         FROM catalyst_events ce
         WHERE s.catalyst_ids IS NOT NULL
           AND ce.event_uuid = ANY(s.catalyst_ids)
         GROUP BY ce.catalyst_type
         ORDER BY COUNT(*) DESC, ce.catalyst_type ASC
         LIMIT 1
       ) ct ON TRUE
       LEFT JOIN market_quotes mq ON mq.symbol = lop.symbol
     )
     SELECT
       signal_type,
       catalyst_type,
       sector,
       COUNT(*)::int AS sample_size,
       ROUND(AVG(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END)::numeric, 4) AS win_rate,
       ROUND(AVG(return_percent)::numeric, 4) AS avg_return,
       ROUND(AVG(drawdown_percent)::numeric, 4) AS avg_drawdown,
       ROUND(AVG(time_to_target_minutes)::numeric, 2) AS avg_time_to_target_minutes
     FROM enriched
     GROUP BY signal_type, catalyst_type, sector
     ORDER BY sample_size DESC, win_rate DESC
     LIMIT $1`,
    [safeLimit],
    { timeoutMs: 12000, label: 'engines.trade_outcome.performance_metrics', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  return rows || [];
}

async function getTradeHistory(limit = 200) {
  await ensureTradeOutcomeTables();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));

  const { rows } = await queryWithTimeout(
    `SELECT
       id,
       symbol,
       opportunity_id,
       entry_price,
       stop_loss,
       take_profit,
       expected_move_percent,
       actual_max_move_percent,
       outcome,
       time_to_target_minutes,
       created_at,
       evaluated_at
     FROM trade_outcomes
     ORDER BY evaluated_at DESC
     LIMIT $1`,
    [safeLimit],
    { timeoutMs: 8000, label: 'engines.trade_outcome.trade_history', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  return rows || [];
}

async function getStrategyPerformance(limit = 100) {
  await ensureTradeOutcomeTables();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 1000));

  const { rows } = await queryWithTimeout(
    `SELECT signal_type, win_rate, avg_return, sample_size, updated_at
     FROM strategy_performance
     ORDER BY sample_size DESC, win_rate DESC
     LIMIT $1`,
    [safeLimit],
    { timeoutMs: 6000, label: 'engines.trade_outcome.strategy_performance', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  return rows || [];
}

function updateOutcomes() {
  if (!fs.existsSync(FILE)) return;

  const data = JSON.parse(fs.readFileSync(FILE));

  const updated = data.map((trade) => {
    if (trade.outcome !== 'pending') return trade;

    // SIMULATION LOGIC (replace later with real price data)
    const rand = Math.random();

    if (rand > 0.6) trade.outcome = 'win';
    else if (rand < 0.3) trade.outcome = 'loss';
    else trade.outcome = 'breakeven';

    return trade;
  });

  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(updated, null, 2));
}

module.exports = {
  ensureTradeOutcomeTables,
  recordSignal,
  evaluateSignals,
  updateOutcomes,
  updateStrategyStats,
  getStrategyStats,
  getPerformanceMetrics,
  getTradeHistory,
  getStrategyPerformance,
};
