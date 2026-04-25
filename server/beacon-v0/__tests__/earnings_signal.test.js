const assert = require('assert');
const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '../../.env'),
  override: false,
});

const { runBeaconPipeline } = require('../orchestrator/run');
const { pool } = require('../../db/pg');

(async () => {
  try {
    const result = await runBeaconPipeline([], { limit: 20, persist: false });

    assert.strictEqual(result.scanVersion, 'beacon-v0-phase43');
    assert.strictEqual(result.signalSlice, 'leaderboard_alignment_v1');
    assert.strictEqual(result.persistence.enabled, false);
    assert.ok(result.runId, 'runId is required');
    assert.strictEqual(result.stats.signalLeaderboards, 5, 'expected five signal leaderboards');
    assert.strictEqual(result.stats.minAlignmentCount, 2, 'expected alignment threshold of 2');
    assert.ok(result.stats.firedSignals > 0, 'expected at least one leaderboard signal hit');
    assert.ok(result.stats.alignedCandidates > 0, 'expected at least one aligned candidate');
    assert.ok(result.stats.qualifiedCandidates > 0, 'expected at least one qualified candidate');
    assert.ok(Array.isArray(result.signalResults), 'signalResults must be an array');
    assert.strictEqual(result.signalResults.length, 5, 'expected five signal summaries');
    assert.ok(result.signalResults.every((signal) => signal.count > 0), 'each signal should produce leaderboard hits');
    assert.ok(Array.isArray(result.picks), 'picks must be an array');
    assert.ok(result.picks.length > 0, 'expected at least one pick');
    assert.ok(result.picks.length <= 20, 'expected at most 20 aligned picks');

    const [candidate] = result.candidates;
    const [pick] = result.picks;
    assert.ok(candidate.symbol, 'candidate symbol is required');
    assert.strictEqual(candidate.patternCategory, 'Multi-Signal Alignment');
    assert.strictEqual(candidate.qualified, true);
    assert.strictEqual(pick.pattern, 'Multi-Signal Alignment');
    assert.ok(pick.reasoning, 'pick reasoning is required');
    assert.ok(Array.isArray(candidate.signals), 'candidate signals must be an array');
    assert.ok(candidate.signals.length >= 2, 'candidate should have at least two aligned signals');
    assert.ok(candidate.alignment.alignmentCount >= 2, 'candidate alignment count should meet threshold');
    assert.ok(Array.isArray(pick.signals_aligned), 'pick signals_aligned must be an array');
    assert.ok(pick.signals_aligned.length >= 2, 'pick should expose aligned signals');
    assert.strictEqual(pick.metadata.alignment.alignmentCount, candidate.alignment.alignmentCount);
    assert.ok(Array.isArray(pick.metadata.signal_evidence), 'pick should expose signal evidence');
    assert.ok(pick.metadata.signal_evidence.length >= 2, 'pick should expose at least two evidence rows');

    console.log(JSON.stringify({
      status: 'PASS',
      signalSlice: result.signalSlice,
      firedSignals: result.stats.firedSignals,
      alignedCandidates: result.stats.alignedCandidates,
      qualifiedCandidates: result.stats.qualifiedCandidates,
      picks: result.picks.length,
      runId: result.runId,
      firstCandidate: {
        symbol: pick.symbol,
        pattern: pick.pattern,
        alignmentCount: candidate.alignment.alignmentCount,
        signals: pick.signals_aligned,
      },
    }, null, 2));
  } finally {
    await pool.end().catch(() => {});
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});