'use strict';

const { pool, queryWithTimeout } = require('../db/pg');

async function runMissedOpportunityReplay() {
  const startedAt = Date.now();
  console.log('[MISSED OPPORTUNITY ENGINE] replay start');

  let inserted = 0;
  let replayed = 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pending = await client.query(
      `SELECT
         id,
         symbol,
         date,
         close_price
       FROM missed_opportunities
       WHERE COALESCE(replayed, false) = false
       ORDER BY date ASC
       LIMIT 1000`
    );

    for (const row of pending.rows || []) {
      const exists = await client.query(
        `SELECT 1
         FROM signal_registry
         WHERE symbol = $1
           AND strategy = 'MISSED_REPLAY'
           AND DATE(COALESCE(entry_time, created_at)) = $2
         LIMIT 1`,
        [row.symbol, row.date]
      );

      if (exists.rowCount === 0) {
        await client.query(
          `INSERT INTO signal_registry (
             symbol,
             strategy,
             entry_price,
             source,
             entry_time,
             created_at
           ) VALUES (
             $1,
             'MISSED_REPLAY',
             $2,
             'missed_opportunity',
             ($3::date + time '15:55:00')::timestamptz,
             NOW()
           )`,
          [row.symbol, row.close_price, row.date]
        );
        inserted += 1;
      }

      await client.query(
        `UPDATE missed_opportunities
         SET replayed = true
         WHERE id = $1`,
        [row.id]
      );
      replayed += 1;
    }

    await client.query('COMMIT');

    const runtimeMs = Date.now() - startedAt;
    console.log(`[MISSED OPPORTUNITY ENGINE] replay complete inserted=${inserted} replayed=${replayed} runtime_ms=${runtimeMs}`);
    return { ok: true, inserted, replayed, runtimeMs };
  } catch (error) {
    await client.query('ROLLBACK');
    const runtimeMs = Date.now() - startedAt;
    console.error(`[MISSED OPPORTUNITY ENGINE] replay error=${error.message}`);
    return { ok: false, inserted, replayed, runtimeMs, error: error.message };
  } finally {
    client.release();
  }
}

async function getMissedReplayStatus() {
  try {
    const result = await queryWithTimeout(
      `SELECT
         COUNT(*) FILTER (WHERE COALESCE(replayed, false) = false)::int AS pending,
         COUNT(*)::int AS total,
         MAX(created_at) AS last_seen
       FROM missed_opportunities`,
      [],
      { timeoutMs: 5000, label: 'missed_replay.status', maxRetries: 0 }
    );

    const row = result?.rows?.[0] || {};
    const pending = Number(row.pending || 0);
    return {
      pending,
      total: Number(row.total || 0),
      lastSeen: row.last_seen || null,
      status: pending > 0 ? 'PENDING' : 'OK',
    };
  } catch (_error) {
    return { pending: 0, total: 0, lastSeen: null, status: 'UNKNOWN' };
  }
}

module.exports = {
  runMissedOpportunityReplay,
  getMissedReplayStatus,
};
