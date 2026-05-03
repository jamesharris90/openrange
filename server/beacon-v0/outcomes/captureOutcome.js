'use strict';

const { queryWithTimeout } = require('../../db/pg');
const { lookupPrice } = require('./priceLookup');

const CHECKPOINTS = [1, 2, 3, 4];
const BAR_TYPE = {
  1: 'open-like',
  2: 'close-like',
  3: 'open-like',
  4: 'close-like',
};

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function findDuePicks(limit = 200) {
  const boundedLimit = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const result = await queryWithTimeout(
    `
      SELECT
        id,
        symbol,
        pick_price,
        pick_volume_baseline,
        baseline_source,
        outcome_t1_due_at,
        outcome_t2_due_at,
        outcome_t3_due_at,
        outcome_t4_due_at,
        outcome_t1_captured_at,
        outcome_t2_captured_at,
        outcome_t3_captured_at,
        outcome_t4_captured_at,
        outcome_status
      FROM beacon_v0_picks
      WHERE outcome_status IN ('pending', 'partial', 'stale')
        AND baseline_source != 'unavailable'
        AND pick_price IS NOT NULL
        AND pick_price > 0
        AND (
          (outcome_t1_due_at IS NOT NULL AND outcome_t1_due_at <= NOW() AND outcome_t1_captured_at IS NULL) OR
          (outcome_t2_due_at IS NOT NULL AND outcome_t2_due_at <= NOW() AND outcome_t2_captured_at IS NULL) OR
          (outcome_t3_due_at IS NOT NULL AND outcome_t3_due_at <= NOW() AND outcome_t3_captured_at IS NULL) OR
          (outcome_t4_due_at IS NOT NULL AND outcome_t4_due_at <= NOW() AND outcome_t4_captured_at IS NULL)
        )
      ORDER BY LEAST(
        COALESCE(outcome_t1_due_at, 'infinity'::timestamptz),
        COALESCE(outcome_t2_due_at, 'infinity'::timestamptz),
        COALESCE(outcome_t3_due_at, 'infinity'::timestamptz),
        COALESCE(outcome_t4_due_at, 'infinity'::timestamptz)
      ) ASC,
      id ASC
      LIMIT $1
    `,
    [boundedLimit],
    {
      timeoutMs: 5000,
      slowQueryMs: 1000,
      label: 'beacon_v0.outcomes.find_due',
      poolType: 'read',
      maxRetries: 0,
    },
  );
  return result.rows;
}

function hasCapturedCheckpoint(pick, updates, checkpoint) {
  return updates[`outcome_t${checkpoint}_captured_at`] !== undefined
    || pick[`outcome_t${checkpoint}_captured_at`] !== null;
}

function computeStatus(pick, updates) {
  const capturedCount = CHECKPOINTS.filter((checkpoint) => hasCapturedCheckpoint(pick, updates, checkpoint)).length;

  if (capturedCount === 4) return 'complete';
  if (capturedCount > 0) return 'partial';
  return pick.outcome_status;
}

async function writeUpdates(pickId, updates) {
  const columns = Object.keys(updates);
  if (columns.length === 0) {
    return;
  }

  const setClauses = columns.map((column, index) => `${column} = $${index + 2}`);
  const values = [pickId, ...columns.map((column) => updates[column])];

  await queryWithTimeout(
    `UPDATE beacon_v0_picks SET ${setClauses.join(', ')} WHERE id = $1`,
    values,
    {
      timeoutMs: 3000,
      slowQueryMs: 1000,
      label: 'beacon_v0.outcomes.write_updates',
      poolType: 'write',
      maxRetries: 0,
    },
  );
}

async function capturePick(pick) {
  const updates = {};
  const now = new Date();

  for (const checkpoint of CHECKPOINTS) {
    const dueAt = pick[`outcome_t${checkpoint}_due_at`];
    const capturedAt = pick[`outcome_t${checkpoint}_captured_at`];
    if (!dueAt || dueAt > now || capturedAt) {
      continue;
    }

    const lookup = await lookupPrice(pick.symbol, dueAt, BAR_TYPE[checkpoint]);
    if (!lookup) {
      continue;
    }

    const pickPrice = toFiniteNumber(pick.pick_price);
    const volumeBaseline = toFiniteNumber(pick.pick_volume_baseline);
    const pctChange = pickPrice && pickPrice > 0
      ? ((lookup.price - pickPrice) / pickPrice) * 100
      : null;
    const volumeRatio = volumeBaseline && volumeBaseline > 0 && lookup.volume != null
      ? lookup.volume / volumeBaseline
      : null;

    updates[`outcome_t${checkpoint}_captured_at`] = lookup.captured_at;
    updates[`outcome_t${checkpoint}_price`] = lookup.price;
    updates[`outcome_t${checkpoint}_pct_change`] = pctChange;
    updates[`outcome_t${checkpoint}_volume_ratio`] = volumeRatio;
  }

  updates.outcome_last_attempted_at = now;

  const capturedCount = Object.keys(updates).filter((key) => /^outcome_t\d_captured_at$/.test(key)).length;
  const newStatus = computeStatus(pick, updates);
  updates.outcome_status = newStatus;
  updates.outcome_complete = newStatus === 'complete';

  await writeUpdates(pick.id, updates);

  return {
    pickId: pick.id,
    captured: capturedCount,
    status: newStatus,
  };
}

async function runOutcomeCapture() {
  const startedAt = Date.now();
  const picks = await findDuePicks(200);

  if (picks.length === 0) {
    const summary = {
      scanned: 0,
      captured: 0,
      errors: [],
      durationMs: Date.now() - startedAt,
    };
    console.log(JSON.stringify({ log: 'beacon_v0_outcomes.cycle', scanned: 0, captured: 0, errors: 0, duration_ms: summary.durationMs }));
    return summary;
  }

  let totalCaptured = 0;
  const errors = [];

  for (const pick of picks) {
    try {
      const result = await capturePick(pick);
      totalCaptured += result.captured;
    } catch (error) {
      errors.push({ pickId: pick.id, error: error.message });
    }
  }

  console.log(JSON.stringify({
    log: 'beacon_v0_outcomes.cycle',
    scanned: picks.length,
    captured: totalCaptured,
    errors: errors.length,
    duration_ms: Date.now() - startedAt,
  }));

  return {
    scanned: picks.length,
    captured: totalCaptured,
    errors,
    durationMs: Date.now() - startedAt,
  };
}

module.exports = {
  runOutcomeCapture,
  findDuePicks,
  capturePick,
  computeStatus,
};
