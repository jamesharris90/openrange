'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { Client } = require('pg');
const { computeDueTimes } = require('../beacon-v0/outcomes/dueTimeCalculator');
const { lookupPrice } = require('../beacon-v0/outcomes/priceLookup');

const CHECKPOINTS = [1, 2, 3, 4];
const BAR_TYPE = {
  1: 'open-like',
  2: 'close-like',
  3: 'open-like',
  4: 'close-like',
};
const ROW_LOOKUP_TIMEOUT_MS = 5000;

function parseArgs(argv = process.argv.slice(2)) {
  const isDryRun = argv.includes('--dry-run');
  const limitIndex = argv.indexOf('--limit');
  const parsedLimit = limitIndex >= 0 ? Number.parseInt(argv[limitIndex + 1], 10) : null;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null;

  return { isDryRun, limit };
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildCheckpointColumns(checkpoint) {
  return {
    dueAt: `outcome_t${checkpoint}_due_at`,
    sessionMinutes: `outcome_t${checkpoint}_session_minutes`,
    capturedAt: `outcome_t${checkpoint}_captured_at`,
    price: `outcome_t${checkpoint}_price`,
    pctChange: `outcome_t${checkpoint}_pct_change`,
    volumeRatio: `outcome_t${checkpoint}_volume_ratio`,
  };
}

function countCapturedCheckpoints(pick, pendingUpdates = {}) {
  return CHECKPOINTS.filter((checkpoint) => {
    const columns = buildCheckpointColumns(checkpoint);
    return pendingUpdates[columns.capturedAt] !== undefined || pick[columns.capturedAt] != null;
  }).length;
}

function computeStatusFromCaptures(pick, pendingUpdates = {}) {
  const capturedCount = countCapturedCheckpoints(pick, pendingUpdates);

  if (capturedCount === 4) return 'complete';
  if (capturedCount > 0) return 'partial';
  return 'errored';
}

async function withTimeout(promise, timeoutMs, timeoutMessage) {
  let timerId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timerId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
        if (typeof timerId.unref === 'function') {
          timerId.unref();
        }
      }),
    ]);
  } finally {
    clearTimeout(timerId);
  }
}

async function loadRows(client, limit) {
  const params = [];
  let limitClause = '';
  if (limit) {
    params.push(limit);
    limitClause = 'LIMIT $1';
  }

  const result = await client.query(
    `
      SELECT
        id,
        symbol,
        pick_price,
        pick_volume_baseline,
        created_at,
        discovered_in_window,
        outcome_status,
        outcome_complete,
        outcome_t1_due_at,
        outcome_t2_due_at,
        outcome_t3_due_at,
        outcome_t4_due_at,
        outcome_t1_session_minutes,
        outcome_t2_session_minutes,
        outcome_t3_session_minutes,
        outcome_t4_session_minutes,
        outcome_t1_captured_at,
        outcome_t2_captured_at,
        outcome_t3_captured_at,
        outcome_t4_captured_at,
        outcome_t1_price,
        outcome_t2_price,
        outcome_t3_price,
        outcome_t4_price,
        outcome_t1_pct_change,
        outcome_t2_pct_change,
        outcome_t3_pct_change,
        outcome_t4_pct_change,
        outcome_t1_volume_ratio,
        outcome_t2_volume_ratio,
        outcome_t3_volume_ratio,
        outcome_t4_volume_ratio
      FROM beacon_v0_picks
      WHERE outcome_status IN ('corrupted', 'partial')
      ORDER BY created_at ASC, id ASC
      ${limitClause}
    `,
    params,
  );

  return result.rows;
}

async function writeUpdates(client, pickId, updates) {
  const columns = Object.keys(updates);
  if (columns.length === 0) {
    return;
  }

  const assignments = columns.map((column, index) => `${column} = $${index + 2}`);
  await client.query(
    `UPDATE beacon_v0_picks SET ${assignments.join(', ')} WHERE id = $1`,
    [pickId, ...columns.map((column) => updates[column])],
  );
}

async function repairRow(client, pick, options = {}) {
  const isDryRun = Boolean(options.isDryRun);
  const lookupTimeoutMs = Number.isFinite(Number(options.lookupTimeoutMs))
    ? Number(options.lookupTimeoutMs)
    : ROW_LOOKUP_TIMEOUT_MS;
  const window = String(pick.discovered_in_window || 'nightly').trim() || 'nightly';
  const createdAt = new Date(pick.created_at);
  const dueTimes = computeDueTimes(createdAt, window);
  const updates = {
    outcome_t1_due_at: dueTimes.t1_due_at,
    outcome_t2_due_at: dueTimes.t2_due_at,
    outcome_t3_due_at: dueTimes.t3_due_at,
    outcome_t4_due_at: dueTimes.t4_due_at,
    outcome_t1_session_minutes: dueTimes.t1_session_minutes,
    outcome_t2_session_minutes: dueTimes.t2_session_minutes,
    outcome_t3_session_minutes: dueTimes.t3_session_minutes,
    outcome_t4_session_minutes: dueTimes.t4_session_minutes,
  };

  const pickPrice = toFiniteNumber(pick.pick_price);
  const volumeBaseline = toFiniteNumber(pick.pick_volume_baseline);
  let capturesRecovered = 0;
  let existingCaptures = 0;

  for (const checkpoint of CHECKPOINTS) {
    const columns = buildCheckpointColumns(checkpoint);
    if (pick[columns.capturedAt] != null && pick[columns.price] != null) {
      existingCaptures += 1;
      continue;
    }

    const dueAt = dueTimes[`t${checkpoint}_due_at`];
    const lookup = await withTimeout(
      lookupPrice(pick.symbol, dueAt, BAR_TYPE[checkpoint]),
      lookupTimeoutMs,
      `price lookup exceeded ${lookupTimeoutMs}ms for pick ${pick.id} checkpoint t${checkpoint}`,
    );

    if (!lookup) {
      continue;
    }

    const pctChange = pickPrice && pickPrice > 0
      ? ((lookup.price - pickPrice) / pickPrice) * 100
      : null;
    const volumeRatio = volumeBaseline && volumeBaseline > 0 && lookup.volume != null
      ? lookup.volume / volumeBaseline
      : null;

    updates[columns.capturedAt] = lookup.captured_at;
    updates[columns.price] = lookup.price;
    updates[columns.pctChange] = pctChange;
    updates[columns.volumeRatio] = volumeRatio;
    capturesRecovered += 1;
  }

  const totalCaptures = existingCaptures + capturesRecovered;
  const newStatus = computeStatusFromCaptures(pick, updates);
  updates.outcome_status = newStatus;
  updates.outcome_complete = newStatus === 'complete';
  updates.outcome_last_attempted_at = new Date();

  if (!isDryRun) {
    await writeUpdates(client, pick.id, updates);
  }

  return {
    pickId: pick.id,
    symbol: pick.symbol,
    beforeStatus: pick.outcome_status,
    afterStatus: newStatus,
    existingCaptures,
    capturesRecovered,
    totalCaptures,
    updates,
  };
}

function summarizeResults(results) {
  const transitions = {};
  let totalRecovered = 0;
  const errors = [];

  for (const result of results) {
    if (result.error) {
      errors.push(result);
      continue;
    }

    const key = `${result.beforeStatus} -> ${result.afterStatus}`;
    transitions[key] = (transitions[key] || 0) + 1;
    totalRecovered += result.capturesRecovered || 0;
  }

  return {
    transitions,
    totalRecovered,
    errors,
  };
}

async function main(argv = process.argv.slice(2)) {
  const { isDryRun, limit } = parseArgs(argv);
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    const startedAt = Date.now();
    const rows = await loadRows(client, limit);
    console.log(`Loaded ${rows.length} corrupted/partial rows. ${isDryRun ? '[DRY RUN]' : '[LIVE]'}`);

    const results = [];
    for (const [index, pick] of rows.entries()) {
      try {
        const result = await repairRow(client, pick, { isDryRun, lookupTimeoutMs: ROW_LOOKUP_TIMEOUT_MS });
        results.push(result);
        console.log(JSON.stringify({
          pick_id: result.pickId,
          symbol: result.symbol,
          before_status: result.beforeStatus,
          after_status: result.afterStatus,
          existing_captures: result.existingCaptures,
          captures_recovered: result.capturesRecovered,
          total_captures: result.totalCaptures,
        }));
      } catch (error) {
        console.error(`ERROR on pick ${pick.id} (${pick.symbol}): ${error.message}`);
        results.push({
          pickId: pick.id,
          symbol: pick.symbol,
          beforeStatus: pick.outcome_status,
          afterStatus: 'ERROR',
          error: error.message,
        });
      }

      if ((index + 1) % 50 === 0) {
        console.log(`Progress: ${index + 1}/${rows.length}`);
      }
    }

    const summary = summarizeResults(results);
    console.log('\n=== Summary ===');
    console.log(`Total processed: ${results.length}`);
    console.log(`Total captures recovered: ${summary.totalRecovered}`);
    console.log(`Duration: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    console.log('Status transitions:');
    for (const [transition, count] of Object.entries(summary.transitions).sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`  ${transition}: ${count}`);
    }

    if (summary.errors.length > 0) {
      console.log('Errors:');
      for (const result of summary.errors) {
        console.log(`  ${result.pickId} ${result.symbol}: ${result.error}`);
      }
    }

    return {
      processed: results.length,
      totalRecovered: summary.totalRecovered,
      transitions: summary.transitions,
      errors: summary.errors,
    };
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('FATAL:', error.message);
    process.exit(1);
  });
}

module.exports = {
  BAR_TYPE,
  CHECKPOINTS,
  ROW_LOOKUP_TIMEOUT_MS,
  buildCheckpointColumns,
  computeStatusFromCaptures,
  countCapturedCheckpoints,
  loadRows,
  main,
  parseArgs,
  repairRow,
  summarizeResults,
  toFiniteNumber,
  withTimeout,
  writeUpdates,
};