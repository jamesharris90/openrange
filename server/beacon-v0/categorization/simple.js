const topRvol = require('../signals/top_rvol_today');
const topGap = require('../signals/top_gap_today');
const topNews = require('../signals/top_news_last_12h');
const topUpcomingEarnings = require('../signals/earnings_upcoming_within_3d');
const earningsReaction = require('../signals/earnings_reaction_last_3d');
const topCoiledSpring = require('../signals/top_coiled_spring');
const topCongressionalTradesRecent = require('../signals/top_congressional_trades_recent');
const topVolumeBuilding = require('../signals/top_volume_building');

const SIGNAL_MODULES = {
  [topRvol.SIGNAL_NAME]: topRvol,
  [topGap.SIGNAL_NAME]: topGap,
  [topNews.SIGNAL_NAME]: topNews,
  [topUpcomingEarnings.SIGNAL_NAME]: topUpcomingEarnings,
  [earningsReaction.SIGNAL_NAME]: earningsReaction,
  [topCoiledSpring.SIGNAL_NAME]: topCoiledSpring,
  [topCongressionalTradesRecent.SIGNAL_NAME]: topCongressionalTradesRecent,
  [topVolumeBuilding.SIGNAL_NAME]: topVolumeBuilding,
};

const PRIORITY_ORDER = [
  topUpcomingEarnings.SIGNAL_NAME,
  earningsReaction.SIGNAL_NAME,
  topCongressionalTradesRecent.SIGNAL_NAME,
  topCoiledSpring.SIGNAL_NAME,
  topVolumeBuilding.SIGNAL_NAME,
  topGap.SIGNAL_NAME,
  topRvol.SIGNAL_NAME,
  topNews.SIGNAL_NAME,
];

const PATTERN_RULES = [
  {
    name: 'pre_earnings_coiled_spring',
    requires: ['top_coiled_spring', 'earnings_upcoming_within_3d', 'top_rvol_today'],
    label: 'Pre-Earnings Coiled Spring',
  },
  {
    name: 'coiled_spring_with_news',
    requires: ['top_coiled_spring', 'top_news_last_12h', 'top_rvol_today'],
    label: 'Coiled Spring with News Catalyst',
  },
  {
    name: 'pre_earnings_compression_news',
    requires: ['top_coiled_spring', 'earnings_upcoming_within_3d', 'top_news_last_12h'],
    label: 'Pre-Earnings Compression with News',
  },
  {
    name: 'pre_earnings_compression_gap',
    requires: ['top_coiled_spring', 'earnings_upcoming_within_3d', 'top_gap_today'],
    label: 'Pre-Earnings Compression Gap',
  },
  {
    name: 'earnings_reaction_compression',
    requires: ['earnings_reaction_last_3d', 'top_coiled_spring', 'top_news_last_12h'],
    label: 'Post-Earnings Compression Building',
  },
  {
    name: 'earnings_reaction_compression_gap',
    requires: ['earnings_reaction_last_3d', 'top_coiled_spring', 'top_gap_today'],
    label: 'Post-Earnings Compression Gap',
  },
  {
    name: 'coiled_spring_gap_volume',
    requires: ['top_coiled_spring', 'top_gap_today', 'top_rvol_today'],
    label: 'Compression Breakout',
  },
  {
    name: 'volume_building_with_news_pre_earnings',
    requires: ['top_volume_building', 'top_news_last_12h', 'earnings_upcoming_within_3d'],
    label: 'Pre-Earnings Accumulation with News',
  },
  {
    name: 'volume_building_compression_news',
    requires: ['top_volume_building', 'top_coiled_spring', 'top_news_last_12h'],
    label: 'Coiled Accumulation with Catalyst',
  },
  {
    name: 'congressional_pre_earnings_news',
    requires: ['top_congressional_trades_recent', 'earnings_upcoming_within_3d', 'top_news_last_12h'],
    label: 'Congressional + Pre-Earnings + News',
  },
  {
    name: 'congressional_with_earnings_reaction',
    requires: ['top_congressional_trades_recent', 'earnings_reaction_last_3d', 'top_rvol_today'],
    label: 'Congressional Conviction with Earnings Reaction',
  },
  {
    name: 'congressional_news_volume',
    requires: ['top_congressional_trades_recent', 'top_news_last_12h', 'top_rvol_today'],
    label: 'Congressional + News Catalyst',
  },
  {
    name: 'compression_with_news',
    requires: ['top_coiled_spring', 'top_news_last_12h'],
    label: 'Compression with News',
  },
  {
    name: 'compression_breaking_volume',
    requires: ['top_coiled_spring', 'top_rvol_today'],
    label: 'Compression Breaking on Volume',
  },
  {
    name: 'compression_resolving_gap',
    requires: ['top_coiled_spring', 'top_gap_today'],
    label: 'Compression Resolving Gap',
  },
  {
    name: 'pre_earnings_compression',
    requires: ['top_coiled_spring', 'earnings_upcoming_within_3d'],
    label: 'Pre-Earnings Compression',
  },
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
    name: 'pre_earnings_news_gap',
    requires: ['earnings_upcoming_within_3d', 'top_news_last_12h', 'top_gap_today'],
    label: 'Pre-Earnings News Gap',
  },
  {
    name: 'earnings_reaction_news_gap',
    requires: ['earnings_reaction_last_3d', 'top_news_last_12h', 'top_gap_today'],
    label: 'Earnings Reaction with News & Gap',
  },
  {
    name: 'news_gap_volume',
    requires: ['top_news_last_12h', 'top_gap_today', 'top_rvol_today'],
    label: 'News Catalyst Breakout',
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
  {
    name: 'pre_earnings_news',
    requires: ['earnings_upcoming_within_3d', 'top_news_last_12h'],
    label: 'Pre-Earnings News',
  },
  {
    name: 'earnings_reaction_news',
    requires: ['earnings_reaction_last_3d', 'top_news_last_12h'],
    label: 'Earnings Reaction with News',
  },
  {
    name: 'earnings_reaction_compression_only',
    requires: ['earnings_reaction_last_3d', 'top_coiled_spring'],
    label: 'Post-Earnings Coiled Spring',
  },
  {
    name: 'congressional_with_news',
    requires: ['top_congressional_trades_recent', 'top_news_last_12h'],
    label: 'Congressional + News',
  },
  {
    name: 'congressional_pre_earnings',
    requires: ['top_congressional_trades_recent', 'earnings_upcoming_within_3d'],
    label: 'Congressional + Pre-Earnings',
  },
  {
    name: 'volume_building_with_news',
    requires: ['top_volume_building', 'top_news_last_12h'],
    label: 'Accumulation with News',
  },
  {
    name: 'pre_earnings_accumulation',
    requires: ['top_volume_building', 'earnings_upcoming_within_3d'],
    label: 'Pre-Earnings Accumulation',
  },
  {
    name: 'coiled_accumulation',
    requires: ['top_volume_building', 'top_coiled_spring'],
    label: 'Coiled Accumulation',
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

function normalizeSignalData(pick) {
  const signalsBy = new Map();
  const metadataSignals = pick?.metadata?.signals || [];
  const candidateSignals = pick?.signals || [];

  for (const signal of metadataSignals) {
    const name = signal.name || signal.signal;
    if (!name) continue;
    signalsBy.set(name, {
      name,
      metadata: signal.metadata || signal.evidence || {},
    });
  }

  for (const signal of candidateSignals) {
    const name = signal.name || signal.signal;
    if (!name || signalsBy.has(name)) continue;
    signalsBy.set(name, {
      name,
      metadata: signal.metadata || signal.evidence || {},
    });
  }

  return signalsBy;
}

function composeReasoning(pick) {
  const signalsBy = normalizeSignalData(pick);
  const fragments = [];

  for (const signalName of PRIORITY_ORDER) {
    if (!signalsBy.has(signalName)) continue;
    const signalData = signalsBy.get(signalName);
    const signalModule = SIGNAL_MODULES[signalName];

    if (!signalModule || typeof signalModule.summarize !== 'function') {
      continue;
    }

    try {
      const fragment = signalModule.summarize(signalData.metadata || {});
      if (fragment) fragments.push(fragment);
    } catch (error) {
      console.warn(`[beacon-v0] summarize failed for ${signalName}:`, error.message);
    }
  }

  if (fragments.length === 0) {
    const alignmentCount = pick?.alignment_count || pick?.alignment?.alignmentCount || pick?.signals_aligned?.length || pick?.signals?.length || 0;
    return `${alignmentCount} Beacon v0 leaderboards align.`;
  }

  const sentences = fragments.map((fragment) => fragment.charAt(0).toUpperCase() + fragment.slice(1));

  return `${sentences.join('. ')}.`;
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
      patternDescription: composeReasoning(candidate),
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
  PRIORITY_ORDER,
  SIGNAL_MODULES,
  categorizeBeaconCandidates,
  categorizeCandidate,
  composeReasoning,
  derivePattern,
};