const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

async function computePrecedentRows() {
  const { rows } = await queryWithTimeout(
    `WITH event_prices AS (
       SELECT
         ce.symbol,
         ce.catalyst_type,
         DATE(COALESCE(ce.published_at, ce.created_at)) AS event_date,
         d0.close AS event_close,
        d1.close AS next_close,
        dprev.close AS prev_close
       FROM catalyst_events ce
       JOIN LATERAL (
         SELECT dstart.date, dstart.close
         FROM daily_ohlc dstart
         WHERE dstart.symbol = ce.symbol
           AND dstart.date <= DATE(COALESCE(ce.published_at, ce.created_at))
         ORDER BY dstart.date DESC
         LIMIT 1
       ) d0 ON TRUE
       LEFT JOIN LATERAL (
         SELECT dnext.close
         FROM daily_ohlc dnext
         WHERE dnext.symbol = ce.symbol
           AND dnext.date > d0.date
         ORDER BY dnext.date ASC
         LIMIT 1
       ) d1 ON TRUE
       LEFT JOIN LATERAL (
         SELECT dprev.close
         FROM daily_ohlc dprev
         WHERE dprev.symbol = ce.symbol
           AND dprev.date < d0.date
         ORDER BY dprev.date DESC
         LIMIT 1
       ) dprev ON TRUE
       WHERE COALESCE(ce.published_at, ce.created_at) >= NOW() - INTERVAL '365 days'
     ),
     move_calc AS (
       SELECT
         symbol,
         catalyst_type,
         CASE
           WHEN event_close IS NULL OR event_close = 0 THEN NULL
           WHEN next_close IS NOT NULL THEN ((next_close - event_close) / event_close)
           WHEN prev_close IS NOT NULL AND prev_close <> 0 THEN ((event_close - prev_close) / prev_close)
           ELSE NULL
         END AS move_pct
       FROM event_prices
     )
     SELECT
       symbol,
       catalyst_type,
       AVG(move_pct)::numeric AS historical_move_avg,
       COUNT(*)::int AS sample_size,
       AVG(CASE WHEN move_pct > 0 THEN 1 ELSE 0 END)::numeric AS success_rate
     FROM move_calc
     WHERE move_pct IS NOT NULL
     GROUP BY symbol, catalyst_type`,
    [],
    { timeoutMs: 15000, label: 'catalyst_precedent.compute_rows', maxRetries: 1 }
  );

  return rows;
}

async function upsertPrecedentRow(row) {
  const updateResult = await queryWithTimeout(
    `UPDATE catalyst_precedent
     SET historical_move_avg = $3,
         sample_size = $4,
         success_rate = $5,
         last_updated = NOW()
     WHERE symbol = $1
       AND catalyst_type = $2`,
    [
      row.symbol,
      row.catalyst_type,
      row.historical_move_avg,
      row.sample_size,
      row.success_rate,
    ],
    { timeoutMs: 8000, label: 'catalyst_precedent.update', maxRetries: 0 }
  );

  if ((updateResult.rowCount || 0) > 0) {
    return 'updated';
  }

  await queryWithTimeout(
    `INSERT INTO catalyst_precedent (
       symbol,
       catalyst_type,
       historical_move_avg,
       sample_size,
       success_rate,
       last_updated
     ) VALUES ($1, $2, $3, $4, $5, NOW())`,
    [
      row.symbol,
      row.catalyst_type,
      row.historical_move_avg,
      row.sample_size,
      row.success_rate,
    ],
    { timeoutMs: 8000, label: 'catalyst_precedent.insert', maxRetries: 0 }
  );

  return 'inserted';
}

async function runCatalystPrecedentEngine() {
  try {
    const rows = await computePrecedentRows();
    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      const mode = await upsertPrecedentRow(row);
      if (mode === 'inserted') inserted += 1;
      if (mode === 'updated') updated += 1;
    }

    const result = {
      computed: rows.length,
      inserted,
      updated,
    };
    logger.info('[CATALYST_PRECEDENT] completed', result);
    return result;
  } catch (error) {
    logger.error('[CATALYST_PRECEDENT] failed', { error: error.message });
    throw error;
  }
}

module.exports = {
  runCatalystPrecedentEngine,
};
