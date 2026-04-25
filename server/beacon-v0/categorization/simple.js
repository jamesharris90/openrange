function categorizeCandidate(candidate) {
  const signalNames = new Set((candidate.signals || []).map((signal) => signal.signal));

  if (signalNames.has('earnings_upcoming_within_3d')) {
    return {
      ...candidate,
      patternCategory: 'Upcoming Earnings',
      patternDescription: 'A scheduled earnings event is close enough to create catalyst awareness, but direction remains trader-assessed.',
    };
  }

  return {
    ...candidate,
    patternCategory: 'Uncategorized Signal Alignment',
    patternDescription: 'Signals fired, but no specific Beacon v0 pattern category matched yet.',
  };
}

function categorizeBeaconCandidates(candidates) {
  return (candidates || []).map(categorizeCandidate);
}

module.exports = {
  categorizeBeaconCandidates,
  categorizeCandidate,
};