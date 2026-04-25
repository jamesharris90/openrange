const PATTERN_RULES = [
  {
    name: 'earnings_catalyst_with_volume',
    requires: ['earnings_upcoming_within_3d', 'top_rvol_today', 'top_news_last_12h'],
    label: 'Earnings Catalyst Building',
  },
  {
    name: 'earnings_reaction_with_volume',
    requires: ['earnings_reaction_last_3d', 'top_rvol_today', 'top_news_last_12h'],
    label: 'Earnings Reaction Continuing',
  },
  {
    name: 'news_driven_volume',
    requires: ['top_news_last_12h', 'top_rvol_today'],
    label: 'News-Driven Volume',
  },
  {
    name: 'news_driven_gap',
    requires: ['top_news_last_12h', 'top_gap_today'],
    label: 'News-Driven Gap',
  },
  {
    name: 'pre_earnings_volume',
    requires: ['earnings_upcoming_within_3d', 'top_rvol_today'],
    label: 'Pre-Earnings Volume',
  },
  {
    name: 'pre_earnings_gap',
    requires: ['earnings_upcoming_within_3d', 'top_gap_today'],
    label: 'Pre-Earnings Gap',
  },
  {
    name: 'post_earnings_continuation',
    requires: ['earnings_reaction_last_3d', 'top_rvol_today'],
    label: 'Post-Earnings Continuation',
  },
  {
    name: 'post_earnings_gap',
    requires: ['earnings_reaction_last_3d', 'top_gap_today'],
    label: 'Post-Earnings Gap',
  },
  {
    name: 'gap_with_volume',
    requires: ['top_gap_today', 'top_rvol_today'],
    label: 'Gap with Volume',
  },
];

function derivePattern(signalsAligned = []) {
  const signalNames = new Set(signalsAligned);

  for (const rule of PATTERN_RULES) {
    if (rule.requires.every((requiredSignal) => signalNames.has(requiredSignal))) {
      return { name: rule.name, label: rule.label };
    }
  }

  return { name: 'multi_signal_alignment', label: 'Multi-Signal Alignment' };
}

function categorizeCandidate(candidate) {
  const signalsAligned = (candidate.signals || []).map((signal) => signal.signal).filter(Boolean);
  const signalNames = new Set(signalsAligned);

  if ((candidate.alignment?.alignmentCount || 0) >= 2) {
    const pattern = derivePattern(signalsAligned);
    return {
      ...candidate,
      patternName: pattern.name,
      patternLabel: pattern.label,
      patternCategory: pattern.label,
      patternDescription: `${pattern.label}: ${candidate.alignment.alignmentCount} Beacon v0 leaderboards align on this symbol.`,
    };
  }

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
  PATTERN_RULES,
  categorizeBeaconCandidates,
  categorizeCandidate,
  derivePattern,
};