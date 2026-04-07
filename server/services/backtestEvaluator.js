const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { ensureBacktestSignalsTable } = require('./backtestLogger');

const DEFAULT_BATCH_SIZE = 100;

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round4(value) {
  return Number.isFinite(value) ? Number(value.toFixed(4)) : null;
}

function resolveResult(maxUpsidePct, maxDrawdownPct) {
  if (Number(maxUpsidePct) >= 5) return 'WIN';
  if (Number(maxDrawdownPct) <= -3) return 'LOSS';
  return 'NEUTRAL';
}

async function markBacktestSignal(id, result, updates = {}) {
  const fields = ['evaluated = true', 'result = $2'];
  const values = [id, result];
  let paramIndex = values.length;

  for (const [column, value] of Object.entries(updates)) {
    paramIndex += 1;
    fields.push(`${column} = $${paramIndex}`);
    values.push(value);
  }

  await queryWithTimeout(
    `UPDATE backtest_signals
     SET ${fields.join(', ')}
     WHERE id = $1`,
    values,
    {
      timeoutMs: 2500,
      maxRetries: 0,
      slowQueryMs: 500,
      label: 'services.backtest_evaluator.mark_result',
    }
  );
}

async function fetchPriceStats(symbol, signalTimestamp) {
  const intraday = await queryWithTimeout(
    `SELECT
       MAX(high)::numeric AS max_high,
       MIN(low)::numeric AS min_low,
       (
         SELECT close
         FROM intraday_1m i2
         WHERE i2.symbol = $1
           AND i2."timestamp" >= $2
         ORDER BY i2."timestamp" DESC
         LIMIT 1
       )::numeric AS latest_close
     FROM intraday_1m i
     WHERE i.symbol = $1
       AND i."timestamp" >= $2`,
    [symbol, signalTimestamp],
    {
      timeoutMs: 3000,
      maxRetries: 0,
      slowQueryMs: 600,
      label: 'services.backtest_evaluator.intraday_stats',
    }
  ).catch(() => ({ rows: [] }));

  const intradayRow = intraday.rows?.[0] || {};
  const intradayHigh = toFiniteNumber(intradayRow.max_high);
  const intradayLow = toFiniteNumber(intradayRow.min_low);
  const intradayClose = toFiniteNumber(intradayRow.latest_close);

  if (
    Number.isFinite(intradayHigh)
    && Number.isFinite(intradayLow)
    && Number.isFinite(intradayClose)
  ) {
    return {
      maxHigh: intradayHigh,
      minLow: intradayLow,
      latestClose: intradayClose,
      source: 'intraday_1m',
    };
  }

  const daily = await queryWithTimeout(
    `SELECT
       MAX(high)::numeric AS max_high,
       MIN(low)::numeric AS min_low,
       (
         SELECT close
         FROM daily_ohlc d2
         WHERE d2.symbol = $1
           AND d2.date >= $2::date
         ORDER BY d2.date DESC
         LIMIT 1
       )::numeric AS latest_close
     FROM daily_ohlc d
     WHERE d.symbol = $1
       AND d.date >= $2::date`,
    [symbol, signalTimestamp],
    {
      timeoutMs: 3000,
      maxRetries: 0,
      slowQueryMs: 600,
      label: 'services.backtest_evaluator.daily_stats',
    }
  ).catch(() => ({ rows: [] }));

  const dailyRow = daily.rows?.[0] || {};
  const dailyHigh = toFiniteNumber(dailyRow.max_high);
  const dailyLow = toFiniteNumber(dailyRow.min_low);
  const dailyClose = toFiniteNumber(dailyRow.latest_close);

  if (
    Number.isFinite(dailyHigh)
    && Number.isFinite(dailyLow)
    && Number.isFinite(dailyClose)
  ) {
    return {
      maxHigh: dailyHigh,
      minLow: dailyLow,
      latestClose: dailyClose,
      source: 'daily_ohlc',
    };
  }

  return null;
}

async function evaluateSignals(options = {}) {
  const startedAt = Date.now();
  const batchSize = Math.max(1, Math.min(Number(options.batchSize) || DEFAULT_BATCH_SIZE, 500));

  let processed = 0;
  let evaluated = 0;
  let skipped = 0;
  let errors = 0;

  try {
    await ensureBacktestSignalsTable();

    const pendingResult = await queryWithTimeout(
      `SELECT id, symbol, signal_timestamp, entry_price
       FROM backtest_signals
       WHERE evaluated = false
         AND signal_timestamp < NOW() - INTERVAL '1 day'
       ORDER BY signal_timestamp ASC
       LIMIT $1`,
      [batchSize],
      {
        timeoutMs: 4000,
        maxRetries: 0,
        slowQueryMs: 800,
        label: 'services.backtest_evaluator.select_pending',
      }
    );

    const pending = pendingResult.rows || [];

    for (const row of pending) {
      processed += 1;

      try {
        const id = Number(row.id);
        const symbol = String(row.symbol || '').trim().toUpperCase();
        const signalTimestamp = row.signal_timestamp;
        const entryPrice = toFiniteNumber(row.entry_price);

        if (!symbol || !signalTimestamp || !Number.isFinite(entryPrice) || entryPrice <= 0) {
          await markBacktestSignal(id, 'INVALID');
          skipped += 1;
          continue;
        }

        const stats = await fetchPriceStats(symbol, signalTimestamp);
        if (!stats) {
          await markBacktestSignal(id, 'NO_DATA');
          skipped += 1;
          continue;
        }

        const maxUpsidePct = round4(((stats.maxHigh - entryPrice) / entryPrice) * 100);
        const maxDrawdownPct = round4(((stats.minLow - entryPrice) / entryPrice) * 100);
        const closePrice = round4(stats.latestClose);
        const result = resolveResult(maxUpsidePct, maxDrawdownPct);

        await queryWithTimeout(
          `UPDATE backtest_signals
           SET max_upside_pct = $1,
               max_drawdown_pct = $2,
               close_price = $3,
               result = $4,
               evaluated = true
           WHERE id = $5`,
          [maxUpsidePct, maxDrawdownPct, closePrice, result, id],
          {
            timeoutMs: 2500,
            maxRetries: 0,
            slowQueryMs: 500,
            label: 'services.backtest_evaluator.update_result',
          }
        );

        evaluated += 1;
      } catch (error) {
        errors += 1;
        logger.warn('backtest signal evaluation failed', {
          scope: 'backtest_evaluator',
          signal_id: row?.id,
          symbol: row?.symbol,
          error: error.message,
        });
      }
    }

    const runtimeMs = Date.now() - startedAt;
    return {
      ok: true,
      processed,
      evaluated,
      skipped,
      errors,
      runtimeMs,
    };
  } catch (error) {
    logger.error('backtest evaluator run failed', {
      scope: 'backtest_evaluator',
      error: error.message,
    });

    return {
      ok: false,
      processed,
      evaluated,
      skipped,
      errors: errors + 1,
      runtimeMs: Date.now() - startedAt,
      error: error.message,
    };
  }
}

module.exports = {
  evaluateSignals,
};
