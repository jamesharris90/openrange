const { queryWithTimeout, runWithDbPool } = require('../db/pg');
const { loadStrategyModules } = require('../backtester/strategyLoader');
const { OUTCOMES_TABLE, ensureBeaconNightlyTables, getStrategyParamsMap } = require('./paramsCache');

function toNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toDateKey(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function addCalendarDays(dateValue, days) {
  const date = new Date(`${toDateKey(dateValue)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function normalizeDirection(direction) {
  const value = String(direction || '').trim().toUpperCase();
  return value === 'SHORT' ? 'SHORT' : 'LONG';
}

function didEntryTrigger(bar, direction, entryPrice) {
  if (direction === 'SHORT') {
    return toNumber(bar.low) != null && toNumber(bar.high) != null && toNumber(bar.low) <= entryPrice && toNumber(bar.high) >= entryPrice;
  }
  return toNumber(bar.low) != null && toNumber(bar.high) != null && toNumber(bar.low) <= entryPrice && toNumber(bar.high) >= entryPrice;
}

function evaluateExitForBar(bar, direction, stopPrice, targetPrice) {
  const high = toNumber(bar.high);
  const low = toNumber(bar.low);
  if (high == null || low == null) {
    return null;
  }

  if (direction === 'SHORT') {
    const hitStop = high >= stopPrice;
    const hitTarget = low <= targetPrice;
    if (hitStop && hitTarget) {
      return { exit_price: stopPrice, exit_reason: 'stop_hit' };
    }
    if (hitStop) {
      return { exit_price: stopPrice, exit_reason: 'stop_hit' };
    }
    if (hitTarget) {
      return { exit_price: targetPrice, exit_reason: 'target_hit' };
    }
    return null;
  }

  const hitStop = low <= stopPrice;
  const hitTarget = high >= targetPrice;
  if (hitStop && hitTarget) {
    return { exit_price: stopPrice, exit_reason: 'stop_hit' };
  }
  if (hitStop) {
    return { exit_price: stopPrice, exit_reason: 'stop_hit' };
  }
  if (hitTarget) {
    return { exit_price: targetPrice, exit_reason: 'target_hit' };
  }
  return null;
}

function computeRMultiple(direction, entryPrice, exitPrice, stopPrice) {
  const risk = Math.abs(entryPrice - stopPrice);
  if (!Number.isFinite(risk) || risk <= 0) {
    return null;
  }

  const signedMove = direction === 'SHORT'
    ? (entryPrice - exitPrice)
    : (exitPrice - entryPrice);

  return signedMove / risk;
}

async function loadPendingPicks(cutoffDate) {
  const result = await queryWithTimeout(
    `SELECT
       id,
       pick_date,
       strategy_id,
       symbol,
       direction,
       entry_price,
       stop_price,
       target_price,
       outcome,
       actual_pnl_r,
       metadata
     FROM morning_picks
     WHERE pick_date < $1::date
       AND (outcome IS NULL OR outcome IN ('pending', 'open') OR actual_pnl_r IS NULL)
     ORDER BY pick_date ASC, rank ASC NULLS LAST, symbol ASC`,
    [cutoffDate],
    {
      timeoutMs: 20000,
      label: 'beacon_nightly.pending_picks',
      maxRetries: 0,
    }
  );

  return result.rows || [];
}

async function loadIntradayBars(symbol, pickDate, endDate) {
  const result = await queryWithTimeout(
    `SELECT timestamp, open, high, low, close, volume, session
     FROM intraday_1m
     WHERE symbol = $1
       AND timestamp::date >= $2::date
       AND timestamp::date <= $3::date
     ORDER BY timestamp ASC`,
    [symbol, pickDate, endDate],
    {
      timeoutMs: 30000,
      label: `beacon_nightly.outcome.intraday.${symbol}`,
      maxRetries: 0,
      slowQueryMs: 1500,
    }
  );

  return result.rows || [];
}

async function evaluateSinglePick(row, strategyParamsMap, strategyMap) {
  const strategyId = String(row.strategy_id || '').trim();
  const params = strategyParamsMap.get(strategyId);
  const strategy = strategyMap.get(strategyId);
  const holdDays = Math.max(1, Number(params?.hold_days || strategy?.holdPeriod || 1));
  const pickDate = toDateKey(row.pick_date);
  const endDate = addCalendarDays(pickDate, holdDays + 7);
  const direction = normalizeDirection(row.direction);
  const entryPrice = toNumber(row.entry_price);
  const stopPrice = toNumber(row.stop_price);
  const targetPrice = toNumber(row.target_price);

  if (!pickDate || entryPrice == null || stopPrice == null || targetPrice == null) {
    return {
      pick_id: row.id,
      pick_date: pickDate,
      strategy_id: strategyId,
      symbol: row.symbol,
      evaluation_status: 'invalid',
      entry_triggered: false,
      actual_entry_price: null,
      exit_price: null,
      actual_pnl_r: null,
      bars_held: 0,
      exit_reason: 'invalid_pick',
      metadata: {
        hold_days: holdDays,
      },
    };
  }

  const intradayBars = await loadIntradayBars(row.symbol, pickDate, endDate);
  if (!intradayBars.length) {
    return {
      pick_id: row.id,
      pick_date: pickDate,
      strategy_id: strategyId,
      symbol: row.symbol,
      evaluation_status: 'no_data',
      entry_triggered: false,
      actual_entry_price: null,
      exit_price: null,
      actual_pnl_r: null,
      bars_held: 0,
      exit_reason: 'no_intraday_data',
      metadata: {
        hold_days: holdDays,
      },
    };
  }

  let entryTriggered = false;
  let barsHeld = 0;
  let exitPrice = null;
  let exitReason = null;

  for (const bar of intradayBars) {
    if (!entryTriggered) {
      entryTriggered = didEntryTrigger(bar, direction, entryPrice);
      if (!entryTriggered) {
        continue;
      }
    }

    barsHeld += 1;
    const exit = evaluateExitForBar(bar, direction, stopPrice, targetPrice);
    if (exit) {
      exitPrice = exit.exit_price;
      exitReason = exit.exit_reason;
      break;
    }
  }

  if (!entryTriggered) {
    return {
      pick_id: row.id,
      pick_date: pickDate,
      strategy_id: strategyId,
      symbol: row.symbol,
      evaluation_status: 'missed',
      entry_triggered: false,
      actual_entry_price: null,
      exit_price: null,
      actual_pnl_r: 0,
      bars_held: 0,
      exit_reason: 'entry_not_triggered',
      metadata: {
        hold_days: holdDays,
        intraday_bar_count: intradayBars.length,
      },
    };
  }

  if (exitPrice == null) {
    const finalBar = intradayBars[intradayBars.length - 1];
    exitPrice = toNumber(finalBar?.close);
    exitReason = 'time_exit';
  }

  const actualPnlR = computeRMultiple(direction, entryPrice, exitPrice, stopPrice);
  const evaluationStatus = actualPnlR == null
    ? 'invalid'
    : actualPnlR > 0
      ? 'win'
      : actualPnlR < 0
        ? 'loss'
        : 'flat';

  return {
    pick_id: row.id,
    pick_date: pickDate,
    strategy_id: strategyId,
    symbol: row.symbol,
    evaluation_status: evaluationStatus,
    entry_triggered: true,
    actual_entry_price: entryPrice,
    exit_price: exitPrice,
    actual_pnl_r: actualPnlR == null ? null : Number(actualPnlR.toFixed(4)),
    bars_held: barsHeld,
    exit_reason: exitReason,
    metadata: {
      hold_days: holdDays,
      intraday_bar_count: intradayBars.length,
      timeframe: strategy?.timeframe || null,
    },
  };
}

async function persistOutcome(result) {
  await runWithDbPool('write', () => queryWithTimeout(
    `INSERT INTO ${OUTCOMES_TABLE} (
       pick_id,
       pick_date,
       strategy_id,
       symbol,
       evaluation_status,
       entry_triggered,
       actual_entry_price,
       exit_price,
       actual_pnl_r,
       bars_held,
       exit_reason,
       evaluated_at,
       updated_at,
       metadata
     )
     VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW(), $12::jsonb)
     ON CONFLICT (pick_id)
     DO UPDATE SET
       evaluation_status = EXCLUDED.evaluation_status,
       entry_triggered = EXCLUDED.entry_triggered,
       actual_entry_price = EXCLUDED.actual_entry_price,
       exit_price = EXCLUDED.exit_price,
       actual_pnl_r = EXCLUDED.actual_pnl_r,
       bars_held = EXCLUDED.bars_held,
       exit_reason = EXCLUDED.exit_reason,
       evaluated_at = NOW(),
       updated_at = NOW(),
       metadata = EXCLUDED.metadata`,
    [
      result.pick_id,
      result.pick_date,
      result.strategy_id,
      result.symbol,
      result.evaluation_status,
      result.entry_triggered,
      result.actual_entry_price,
      result.exit_price,
      result.actual_pnl_r,
      result.bars_held,
      result.exit_reason,
      JSON.stringify(result.metadata || {}),
    ],
    {
      timeoutMs: 10000,
      label: `beacon_nightly.persist_outcome.${result.pick_id}`,
      maxRetries: 1,
      poolType: 'write',
    }
  ));

  await runWithDbPool('write', () => queryWithTimeout(
    `UPDATE morning_picks
     SET outcome = $2,
         actual_pnl_r = $3,
         metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb
     WHERE id = $1`,
    [
      result.pick_id,
      result.evaluation_status,
      result.actual_pnl_r,
      JSON.stringify({
        nightly_outcome: {
          evaluated_at: new Date().toISOString(),
          entry_triggered: result.entry_triggered,
          exit_price: result.exit_price,
          exit_reason: result.exit_reason,
          bars_held: result.bars_held,
        },
      }),
    ],
    {
      timeoutMs: 10000,
      label: `beacon_nightly.update_morning_pick.${result.pick_id}`,
      maxRetries: 1,
      poolType: 'write',
    }
  ));
}

async function evaluatePendingPickOutcomes(options = {}) {
  await ensureBeaconNightlyTables();
  const cutoffDate = toDateKey(options.asOfDate || new Date());
  const pending = await loadPendingPicks(cutoffDate);
  const strategyParamsMap = await getStrategyParamsMap();
  const strategyMap = new Map(loadStrategyModules().map((strategy) => [strategy.id, strategy]));

  const results = [];
  for (const row of pending) {
    const outcome = await evaluateSinglePick(row, strategyParamsMap, strategyMap);
    await persistOutcome(outcome);
    results.push(outcome);
  }

  return {
    evaluated_pick_count: results.length,
    wins: results.filter((row) => row.evaluation_status === 'win').length,
    losses: results.filter((row) => row.evaluation_status === 'loss').length,
    flats: results.filter((row) => row.evaluation_status === 'flat').length,
    missed: results.filter((row) => row.evaluation_status === 'missed').length,
    no_data: results.filter((row) => row.evaluation_status === 'no_data').length,
    invalid: results.filter((row) => row.evaluation_status === 'invalid').length,
    results,
  };
}

module.exports = {
  evaluatePendingPickOutcomes,
};