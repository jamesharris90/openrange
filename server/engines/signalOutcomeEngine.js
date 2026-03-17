const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

function toNumber(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function runSignalOutcomeEngine() {
  console.log('[SIGNAL_OUTCOME_ENGINE] evaluating pending catalyst signals');
  try {
    const { rows: pendingSignals } = await queryWithTimeout(
      `SELECT cs.id, cs.symbol, cs.created_at
       FROM catalyst_signals cs
       LEFT JOIN trade_outcomes t
       ON cs.id = t.signal_id
       WHERE t.signal_id IS NULL
         AND cs.created_at < NOW() - INTERVAL '2 hours'
       ORDER BY cs.created_at ASC
       LIMIT 200`,
      [],
      { timeoutMs: 12000, label: 'signal_outcome_engine.pending_signals', maxRetries: 0, poolType: 'read' }
    );

    const signalsScanned = pendingSignals?.length || 0;
    let evaluated = 0;
    let written = 0;

    for (const signal of pendingSignals || []) {
      const { rows: startRows } = await queryWithTimeout(
        `SELECT close
         FROM intraday_1m
         WHERE symbol = $1
           AND timestamp <= $2
         ORDER BY timestamp DESC
         LIMIT 1`,
        [signal.symbol, signal.created_at],
        { timeoutMs: 7000, label: 'signal_outcome_engine.start_price', maxRetries: 0, poolType: 'read' }
      );

      const startPrice = toNumber(startRows?.[0]?.close);
      if (!Number.isFinite(startPrice) || startPrice <= 0) continue;

      const { rows: bars } = await queryWithTimeout(
        `SELECT high, low
         FROM intraday_1m
         WHERE symbol = $1
           AND timestamp > $2
         ORDER BY timestamp ASC`,
        [signal.symbol, signal.created_at],
        { timeoutMs: 9000, label: 'signal_outcome_engine.intraday_bars', maxRetries: 0, poolType: 'read' }
      );

      let maxHigh = Number.NEGATIVE_INFINITY;
      let minLow = Number.POSITIVE_INFINITY;

      if ((bars?.length || 0) > 0) {
        for (const bar of bars) {
          const high = toNumber(bar.high);
          const low = toNumber(bar.low);
          if (Number.isFinite(high) && high > maxHigh) maxHigh = high;
          if (Number.isFinite(low) && low < minLow) minLow = low;
        }
      } else {
        const { rows: fallbackRows } = await queryWithTimeout(
          `SELECT close
           FROM intraday_1m
           WHERE symbol = $1
           ORDER BY timestamp DESC
           LIMIT 1`,
          [signal.symbol],
          { timeoutMs: 7000, label: 'signal_outcome_engine.post_signal_fallback', maxRetries: 0, poolType: 'read' }
        );

        const fallbackClose = toNumber(fallbackRows?.[0]?.close);
        if (!Number.isFinite(fallbackClose) || fallbackClose <= 0) continue;
        maxHigh = fallbackClose;
        minLow = fallbackClose;
      }

      if (!Number.isFinite(maxHigh) || !Number.isFinite(minLow)) {
        continue;
      }

      const maxMove = ((maxHigh - startPrice) / startPrice) * 100;
      const maxDrawdown = ((minLow - startPrice) / startPrice) * 100;
      const success = maxMove >= 2;

      const insertResult = await queryWithTimeout(
        `INSERT INTO trade_outcomes
           (signal_id, max_move, max_drawdown, success, evaluation_time)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (signal_id) DO NOTHING`,
        [signal.id, maxMove, maxDrawdown, success],
        { timeoutMs: 7000, label: 'signal_outcome_engine.insert_outcome', maxRetries: 0, poolType: 'write' }
      );

      evaluated += 1;
      written += Number(insertResult?.rowCount || 0);
    }

    const [trackedSize, accuracy] = await Promise.all([
      queryWithTimeout(
        `SELECT COUNT(*)::int AS tracked_universe_size
         FROM tracked_universe
         WHERE active = true`,
        [],
        { timeoutMs: 5000, label: 'signal_outcome_engine.tracked_size', maxRetries: 0, poolType: 'read' }
      ),
      queryWithTimeout(
        `SELECT
           ROUND(
             100.0 * COUNT(*) FILTER (WHERE success = true) /
             NULLIF(COUNT(*), 0),
             2
           ) AS accuracy_percent
         FROM trade_outcomes
         WHERE evaluation_time > NOW() - INTERVAL '7 days'`,
        [],
        { timeoutMs: 5000, label: 'signal_outcome_engine.accuracy', maxRetries: 0, poolType: 'read' }
      ),
    ]);

    const trackedUniverseSize = trackedSize?.rows?.[0]?.tracked_universe_size ?? 0;
    const accuracyPercent = accuracy?.rows?.[0]?.accuracy_percent;

    console.log('[SIGNAL_OUTCOME_ENGINE SUMMARY]', {
      signals_scanned: signalsScanned,
      signals_evaluated: evaluated,
      outcomes_written: written,
      current_accuracy: accuracyPercent,
      tracked_universe_size: trackedUniverseSize,
    });

    logger.info('[SIGNAL_OUTCOME_ENGINE] evaluation cycle complete', {
      signals_scanned: signalsScanned,
      evaluated,
      outcomes_written: written,
      current_accuracy: accuracyPercent,
      tracked_universe_size: trackedUniverseSize,
    });

    return {
      pending: pendingSignals?.length || 0,
      evaluated,
      written,
      trackedUniverseSize,
      accuracyPercent,
    };
  } catch (err) {
    console.error('[SIGNAL_OUTCOME_ENGINE ERROR]', err.message || err);
    throw err;
  }
}

module.exports = {
  runSignalOutcomeEngine,
};
