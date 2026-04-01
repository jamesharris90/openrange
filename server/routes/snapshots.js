'use strict';

/**
 * Snapshot Routes
 *
 * GET /api/snapshots/latest
 *   Returns the most recent complete snapshot batch.
 *   Includes market state so the UI knows whether to show "market closed".
 *
 * GET /api/snapshots/health
 *   Returns batch age, count, and data quality summary.
 */

const express  = require('express');
const router   = express.Router();
const { queryWithTimeout } = require('../db/pg');
const { isMarketOpen, getSessionLabel } = require('../utils/marketHours');

// ── GET /api/snapshots/latest ─────────────────────────────────────────────────

router.get('/api/snapshots/latest', async (req, res) => {
  const session     = getSessionLabel();
  const marketOpen  = isMarketOpen();

  try {
    // Find the most recent batch_id
    const batchRes = await queryWithTimeout(
      `SELECT batch_id, created_at
       FROM signal_snapshots
       ORDER BY created_at DESC
       LIMIT 1`,
      [],
      { timeoutMs: 5000, label: 'snapshots.latest_batch' }
    );

    if (!batchRes.rows.length) {
      return res.json({
        market_open:   marketOpen,
        session,
        market_message: marketOpen
          ? 'No snapshots yet — first cycle pending.'
          : 'Market closed — no snapshots available.',
        batch_id:    null,
        snapshot_at: null,
        results:     [],
      });
    }

    const { batch_id, created_at } = batchRes.rows[0];

    const snapshotAgeMin = Math.round(
      (Date.now() - new Date(created_at).getTime()) / 60000
    );

    // Fetch full snapshot for this batch
    const dataRes = await queryWithTimeout(
      `SELECT
         symbol, score, confidence, confidence_breakdown,
         data_completeness, lifecycle_stage, entry_type, exit_type,
         strategy, entry_price, stop_loss, target_price,
         risk_reward, position_size, trade_quality_score,
         execution_ready, rejection_reason,
         why_moving, why_tradeable, how_to_trade,
         catalyst_type, expected_move,
         vwap_relation, volume_trend, market_structure, time_context,
         source_table, created_at
       FROM signal_snapshots
       WHERE batch_id = $1
       ORDER BY score DESC NULLS LAST`,
      [batch_id],
      { timeoutMs: 8000, label: 'snapshots.latest_data' }
    );

    const market_message = marketOpen
      ? null
      : `Market closed — showing last evaluated opportunities (${snapshotAgeMin} min ago).`;

    return res.json({
      market_open:      marketOpen,
      session,
      market_message,
      batch_id,
      snapshot_at:      created_at,
      snapshot_age_min: snapshotAgeMin,
      count:            dataRes.rows.length,
      results:          dataRes.rows,
    });

  } catch (err) {
    return res.status(500).json({
      error:       'snapshot_read_failed',
      message:     err.message,
      market_open: marketOpen,
      session,
    });
  }
});

// ── GET /api/snapshots/health ─────────────────────────────────────────────────

router.get('/api/snapshots/health', async (req, res) => {
  try {
    const r = await queryWithTimeout(
      `SELECT
         COUNT(*)                                           AS total_snapshots,
         COUNT(DISTINCT batch_id)                          AS total_batches,
         MAX(created_at)                                   AS latest_snapshot_at,
         ROUND(EXTRACT(EPOCH FROM (NOW()-MAX(created_at)))/60,1) AS age_minutes,
         COUNT(*) FILTER (WHERE execution_ready = TRUE)    AS exec_ready,
         COUNT(*) FILTER (WHERE confidence IS NOT NULL)    AS has_confidence,
         ROUND(AVG(confidence)::NUMERIC,1)                 AS avg_confidence,
         ROUND(AVG(data_completeness)::NUMERIC,3)          AS avg_completeness,
         COUNT(*) FILTER (WHERE catalyst_type IS NOT NULL) AS with_catalyst
       FROM signal_snapshots
       WHERE created_at >= NOW() - INTERVAL '24 hours'`,
      [],
      { timeoutMs: 6000, label: 'snapshots.health' }
    );

    const row = r.rows[0] || {};
    return res.json({
      market_open:        isMarketOpen(),
      session:            getSessionLabel(),
      total_snapshots_24h: Number(row.total_snapshots || 0),
      total_batches_24h:   Number(row.total_batches   || 0),
      latest_snapshot_at:  row.latest_snapshot_at || null,
      snapshot_age_min:    Number(row.age_minutes  || 0),
      exec_ready:          Number(row.exec_ready   || 0),
      has_confidence:      Number(row.has_confidence || 0),
      avg_confidence:      Number(row.avg_confidence || 0),
      avg_completeness:    Number(row.avg_completeness || 0),
      with_catalyst:       Number(row.with_catalyst || 0),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
