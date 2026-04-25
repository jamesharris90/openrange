const { alignSingleSignal } = require('../alignment/single_signal');
const { categorizeBeaconCandidates } = require('../categorization/simple');
const { qualifyBeaconCandidates } = require('../qualification/basic_filters');
const { detectUpcomingEarningsWithin3d, SIGNAL_NAME } = require('../signals/earnings_upcoming_within_3d');

async function runBeaconV0(options = {}) {
  const startedAt = new Date().toISOString();
  const signals = await detectUpcomingEarningsWithin3d(options);
  const aligned = alignSingleSignal(signals);
  const qualified = qualifyBeaconCandidates(aligned, options.qualification || {});
  const categorized = categorizeBeaconCandidates(qualified);
  const candidates = categorized.filter((candidate) => candidate.qualified);

  return {
    scanVersion: 'beacon-v0-skeleton-phase40',
    signalSlice: SIGNAL_NAME,
    generatedAt: startedAt,
    persistence: {
      enabled: false,
      reason: 'Phase 40 is read-only and in-memory only.',
    },
    stats: {
      firedSignals: signals.length,
      alignedCandidates: aligned.length,
      qualifiedCandidates: candidates.length,
      disqualifiedCandidates: categorized.length - candidates.length,
    },
    candidates,
    disqualifiedCandidates: categorized.filter((candidate) => !candidate.qualified),
  };
}

module.exports = {
  runBeaconV0,
};

if (require.main === module) {
  runBeaconV0()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}