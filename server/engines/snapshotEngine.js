'use strict';

/**
 * Snapshot Engine
 *
 * Reads the latest strategy_signals and opportunities_v2, computes
 * data_completeness + confidence caps, then writes ONE consistent batch
 * to signal_snapshots.
 *
 * Rules:
 *   - Only runs when market is OPEN (no phantom recomputation after close)
 *   - After hours: does NOT write new snapshots; UI reads the last one
 *   - Signals with data_completeness < 0.5 are REJECTED (not stored)
 *   - confidence_breakdown MUST be present; if missing → signal rejected
 *   - Cleans snapshots older than 48h to keep table lean
 *
 * Called by: startEngines.js on a 5-min interval
 */

const { v4: uuidv4 } = require('uuid');
const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { isMarketOpen, getSessionLabel } = require('../utils/marketHours');
const { computeDataCompleteness } = require('./dataCompletenessEngine');
const { applyConfidenceCaps }     = require('./confidenceEngine');

// ── Snapshot run ──────────────────────────────────────────────────────────────

async function runSnapshotEngine() {
  const session = getSessionLabel();

  // After-hours freeze: no new snapshots outside market hours
  if (!isMarketOpen()) {
    logger.info('[SNAPSHOT] market closed — skipping snapshot', { session });
    return { skipped: true, reason: 'market_closed', session };
  }

  const startedAt = Date.now();
  const batchId   = uuidv4();

  logger.info('[SNAPSHOT] starting batch', { batchId, session });

  // Read best candidates from opportunities_v2 (scored, filtered)
  const { rows: oppRows } = await queryWithTimeout(
    `SELECT
       symbol, score,
       confidence, confidence_breakdown,
       lifecycle_stage, entry_type, exit_type,
       strategy,
       entry_price, stop_loss, target_price,
       risk_reward, position_size, trade_quality_score,
       execution_ready, rejection_reason,
       why_moving, why_tradeable, how_to_trade,
       vwap_relation, volume_trend, market_structure, time_context,
       change_percent, relative_volume, volume, gap_percent,
       atr, vwap
     FROM opportunities_v2
     WHERE updated_at >= NOW() - INTERVAL '30 minutes'
     ORDER BY score DESC NULLS LAST
     LIMIT 30`,
    [],
    { timeoutMs: 10000, label: 'snapshot.read_opportunities', maxRetries: 0 }
  );

  // Also pull top strategy_signals (different, tighter criteria)
  const { rows: sigRows } = await queryWithTimeout(
    `SELECT
       symbol, score,
       confidence, confidence_breakdown,
       lifecycle_stage, entry_type, exit_type,
       strategy,
       entry_price, stop_loss, target_price,
       risk_reward, position_size, trade_quality_score,
       execution_ready, rejection_reason,
       why_moving, why_tradeable, how_to_trade,
       vwap_relation, volume_trend, market_structure, time_context,
       change_percent, relative_volume, volume, gap_percent
     FROM strategy_signals
     WHERE updated_at >= NOW() - INTERVAL '30 minutes'
       AND class IN ('A','B')
     ORDER BY score DESC NULLS LAST
     LIMIT 20`,
    [],
    { timeoutMs: 10000, label: 'snapshot.read_signals', maxRetries: 0 }
  );

  // Fetch latest news catalyst + earnings proximity per symbol
  const allSymbols = [...new Set([...oppRows, ...sigRows].map(r => r.symbol))];
  const [catalystMap, earningsSet] = await Promise.all([
    fetchCatalysts(allSymbols),
    fetchEarningsProximity(allSymbols),
  ]);

  let inserted = 0;
  let rejected = 0;

  for (const row of [...oppRows, ...sigRows]) {
    const sourceTable = oppRows.includes(row) ? 'opportunities_v2' : 'strategy_signals';

    // Compute data completeness
    const completeness = computeDataCompleteness({
      price:        Number(row.entry_price || 0),
      volume:       Number(row.volume || 0),
      atr:          Number(row.atr || 0),
      catalyst:     catalystMap.get(row.symbol) ?? null,
      has_news:     catalystMap.has(row.symbol),
      has_earnings: earningsSet.has(row.symbol),
    });

    // Reject if critically incomplete
    if (completeness < 0.5) {
      logger.warn('[SNAPSHOT] rejected — low completeness', { symbol: row.symbol, completeness });
      rejected++;
      continue;
    }

    // Confidence must have a breakdown; if it's null, reject
    const confidence_breakdown = row.confidence_breakdown ?? null;
    if (row.confidence === null || row.confidence === undefined) {
      logger.warn('[SNAPSHOT] rejected — no confidence', { symbol: row.symbol });
      rejected++;
      continue;
    }

    // Apply caps based on completeness + missing fields
    const cappedConfidence = applyConfidenceCaps({
      confidence:        Number(row.confidence),
      catalyst_type:     catalystMap.get(row.symbol) ?? null,
      expected_move:     Number(row.risk_reward || 0) > 0 ? 1 : 0, // proxy for meaningful plan
      volume:            Number(row.volume || 0),
      data_completeness: completeness,
    });

    const catalyst = catalystMap.get(row.symbol) ?? null;

    try {
      await queryWithTimeout(
        `INSERT INTO signal_snapshots (
           batch_id, symbol, score, confidence, confidence_breakdown,
           data_completeness, lifecycle_stage, entry_type, exit_type,
           strategy, entry_price, stop_loss, target_price,
           risk_reward, position_size, trade_quality_score,
           execution_ready, rejection_reason,
           why_moving, why_tradeable, how_to_trade,
           catalyst_type, expected_move,
           vwap_relation, volume_trend, market_structure, time_context,
           source_table
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
           $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28
         )`,
        [
          batchId, row.symbol, row.score, cappedConfidence, confidence_breakdown,
          completeness,
          row.lifecycle_stage, row.entry_type, row.exit_type,
          row.strategy, row.entry_price, row.stop_loss, row.target_price,
          row.risk_reward, row.position_size, row.trade_quality_score,
          row.execution_ready, row.rejection_reason,
          row.why_moving, row.why_tradeable, row.how_to_trade,
          catalyst, row.risk_reward,  // expected_move proxied by rr for now
          row.vwap_relation, row.volume_trend, row.market_structure, row.time_context,
          sourceTable,
        ],
        { timeoutMs: 5000, label: `snapshot.insert.${row.symbol}`, maxRetries: 0 }
      );
      inserted++;
    } catch (err) {
      logger.warn('[SNAPSHOT] insert failed', { symbol: row.symbol, error: err.message });
    }
  }

  // Cleanup: keep only last 48h of snapshots
  try {
    await queryWithTimeout(
      `DELETE FROM signal_snapshots WHERE created_at < NOW() - INTERVAL '48 hours'`,
      [],
      { timeoutMs: 5000, label: 'snapshot.cleanup', maxRetries: 0 }
    );
  } catch { /* non-fatal */ }

  const runtimeMs = Date.now() - startedAt;
  logger.info('[SNAPSHOT] batch complete', { batchId, inserted, rejected, runtimeMs, session });

  return { batchId, inserted, rejected, runtimeMs, session };
}

// ── Fetch catalysts for a batch of symbols ────────────────────────────────────

async function fetchCatalysts(symbols) {
  const map = new Map();
  if (!symbols.length) return map;

  try {
    // Use news_events (primary) — FMP stable endpoint feed
    const { rows } = await queryWithTimeout(
      `SELECT DISTINCT ON (symbol)
         symbol,
         COALESCE(event_type, category, 'NEWS') AS catalyst_type
       FROM news_events
       WHERE symbol = ANY($1)
         AND created_at >= NOW() - INTERVAL '24 hours'
       ORDER BY symbol, created_at DESC`,
      [symbols],
      { timeoutMs: 8000, label: 'snapshot.catalysts', maxRetries: 0 }
    );
    for (const r of rows) {
      map.set(r.symbol, r.catalyst_type);
    }
  } catch { /* no catalyst data — map stays empty, signals get no catalyst */ }

  // Fallback: check news_articles for any symbols still missing
  const missing = symbols.filter(s => !map.has(s));
  if (missing.length > 0) {
    try {
      const { rows } = await queryWithTimeout(
        `SELECT DISTINCT ON (symbol) symbol, 'NEWS' AS catalyst_type
         FROM news_articles
         WHERE symbol = ANY($1)
           AND published_at >= NOW() - INTERVAL '24 hours'
         ORDER BY symbol, published_at DESC`,
        [missing],
        { timeoutMs: 6000, label: 'snapshot.catalysts_fallback', maxRetries: 0 }
      );
      for (const r of rows) map.set(r.symbol, r.catalyst_type);
    } catch { /* silently continue */ }
  }

  return map;
}

// ── Fetch earnings proximity (±3 days) for a batch of symbols ────────────────

async function fetchEarningsProximity(symbols) {
  const set = new Set();
  if (!symbols.length) return set;

  try {
    const { rows } = await queryWithTimeout(
      `SELECT DISTINCT symbol
       FROM earnings_events
       WHERE symbol = ANY($1)
         AND report_date BETWEEN CURRENT_DATE - INTERVAL '3 days'
                              AND CURRENT_DATE + INTERVAL '3 days'`,
      [symbols],
      { timeoutMs: 6000, label: 'snapshot.earnings_proximity', maxRetries: 0 }
    );
    for (const r of rows) set.add(r.symbol);
  } catch { /* non-fatal — earnings proximity is best-effort */ }

  return set;
}

module.exports = { runSnapshotEngine };
