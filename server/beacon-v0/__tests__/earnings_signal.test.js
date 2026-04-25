const assert = require('assert');
const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '../../.env'),
  override: false,
});

const { runBeaconV0 } = require('../orchestrator/run');
const { pool } = require('../../db/pg');

(async () => {
  try {
    const result = await runBeaconV0({ limit: 500 });

    assert.strictEqual(result.scanVersion, 'beacon-v0-skeleton-phase40');
    assert.strictEqual(result.signalSlice, 'earnings_upcoming_within_3d');
    assert.strictEqual(result.persistence.enabled, false);
    assert.ok(result.stats.firedSignals > 0, 'expected at least one upcoming earnings signal');
    assert.ok(result.stats.alignedCandidates > 0, 'expected at least one aligned candidate');
    assert.ok(result.stats.qualifiedCandidates > 0, 'expected at least one qualified candidate');

    const [candidate] = result.candidates;
    assert.ok(candidate.symbol, 'candidate symbol is required');
    assert.strictEqual(candidate.patternCategory, 'Upcoming Earnings');
    assert.strictEqual(candidate.qualified, true);
    assert.ok(Array.isArray(candidate.signals), 'candidate signals must be an array');
    assert.strictEqual(candidate.signals[0].signal, 'earnings_upcoming_within_3d');
    assert.strictEqual(candidate.signals[0].direction, 'neutral');
    assert.ok(candidate.signals[0].evidence.earningsDate, 'earnings date evidence is required');

    console.log(JSON.stringify({
      status: 'PASS',
      signalSlice: result.signalSlice,
      firedSignals: result.stats.firedSignals,
      alignedCandidates: result.stats.alignedCandidates,
      qualifiedCandidates: result.stats.qualifiedCandidates,
      firstCandidate: {
        symbol: candidate.symbol,
        patternCategory: candidate.patternCategory,
        earningsDate: candidate.signals[0].evidence.earningsDate,
        direction: candidate.signals[0].direction,
      },
    }, null, 2));
  } finally {
    await pool.end().catch(() => {});
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});