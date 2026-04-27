const FORWARD_SETUP_SIGNALS = new Set([
  'earnings_upcoming_within_3d',
  'top_coiled_spring',
  'top_volume_building',
]);

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getSignalEvidence(pick) {
  const evidence = pick?.metadata?.signal_evidence;
  return Array.isArray(evidence) ? evidence : [];
}

function getAlignmentCount(pick) {
  const alignmentCount = toNumber(pick?.metadata?.alignment?.alignmentCount);
  if (alignmentCount != null) return alignmentCount;

  if (Array.isArray(pick?.signals_aligned)) return pick.signals_aligned.length;
  return 0;
}

function getBestSignalRank(signalEvidence) {
  const ranks = signalEvidence
    .map((signal) => toNumber(signal?.rank))
    .filter((rank) => rank != null && rank > 0);

  return ranks.length > 0 ? Math.min(...ranks) : null;
}

function rankContribution(rank) {
  const boundedRank = Math.min(Math.max(toNumber(rank) || 100, 1), 100);
  return 50 - ((boundedRank - 1) * (49 / 99));
}

function getSignal(signalEvidence, signalName) {
  return signalEvidence.find((signal) => signal?.signal === signalName) || null;
}

function getSignalMetadataValue(signal, keys) {
  const metadata = signal?.metadata || {};
  for (const key of keys) {
    const value = toNumber(metadata[key]);
    if (value != null) return value;
  }
  return null;
}

function forwardSetupReason(signal) {
  if (!signal) return null;

  if (signal.signal === 'earnings_upcoming_within_3d') {
    const daysUntil = getSignalMetadataValue(signal, ['days_until_earnings', 'days_until']);
    if (daysUntil === 0) return 'Earnings today';
    if (daysUntil === 1) return 'Earnings tomorrow';
    if (daysUntil != null) return `Earnings within ${daysUntil} days`;
    return 'Upcoming earnings catalyst';
  }

  if (signal.signal === 'top_volume_building') return 'Forward setup: volume building';
  if (signal.signal === 'top_coiled_spring') return 'Forward setup: coiled spring';
  return null;
}

function scorePick(pick, originalIndex) {
  const signalEvidence = getSignalEvidence(pick);
  const alignmentCount = getAlignmentCount(pick);
  const forwardSignals = signalEvidence.filter((signal) => FORWARD_SETUP_SIGNALS.has(signal?.signal));
  const bestRank = getBestSignalRank(signalEvidence);
  const rvolSignal = getSignal(signalEvidence, 'top_rvol_today');
  const rvol = getSignalMetadataValue(rvolSignal, ['rvol', 'relative_volume']);
  const earningsSignal = getSignal(signalEvidence, 'earnings_upcoming_within_3d');
  const daysUntilEarnings = getSignalMetadataValue(earningsSignal, ['days_until_earnings', 'days_until']);

  const factors = [];
  let score = 0;

  // HEURISTIC v1 — additive score, never displayed.
  // Replaced by empirical weights in G2b once outcome data exists.
  //
  //   alignment_count       × 10
  //   forward_setup_count   ×  5   (earnings_upcoming_within_3d, top_coiled_spring, top_volume_building)
  //   best_signal_rank      maps Rank 1 → +50, Rank 100 → +1, linear inverse
  //   rvol_multiplier       × 5   (e.g. 2.0x rvol → +10)
  //   earnings_today_bonus  +20 if earnings_upcoming_within_3d Forward Setup with 0 days
  if (alignmentCount > 0) {
    const contribution = alignmentCount * 10;
    score += contribution;
    factors.push({ contribution, reason: `${alignmentCount} alignment signal${alignmentCount === 1 ? '' : 's'}` });
  }

  forwardSignals.forEach((signal) => {
    score += 5;
    const reason = forwardSetupReason(signal);
    if (reason) factors.push({ contribution: 5, reason });
  });

  if (bestRank != null) {
    const contribution = rankContribution(bestRank);
    score += contribution;
    factors.push({ contribution, reason: 'Strong leaderboard position' });
  }

  if (rvol != null && rvol > 0) {
    const contribution = rvol * 5;
    score += contribution;
    factors.push({ contribution, reason: `Trading at ${rvol.toFixed(1)}x average volume` });
  }

  if (daysUntilEarnings === 0) {
    score += 20;
    factors.push({ contribution: 20, reason: 'Earnings today' });
  }

  const congressionalSignal = getSignal(signalEvidence, 'top_congressional_trades_recent');
  if (congressionalSignal) {
    factors.push({ contribution: 4, reason: 'Disclosed congressional buying' });
  }

  const reasons = [];
  factors
    .sort((a, b) => b.contribution - a.contribution)
    .forEach((factor) => {
      if (reasons.length >= 4) return;
      if (!reasons.includes(factor.reason)) reasons.push(factor.reason);
    });

  return { pick, originalIndex, score, reasons };
}

function computeTierRanking(picks) {
  if (!Array.isArray(picks) || picks.length === 0) return [];

  const scored = picks.map(scorePick).sort((a, b) => {
    const scoreDelta = b.score - a.score;
    if (scoreDelta !== 0) return scoreDelta;
    return a.originalIndex - b.originalIndex;
  });

  const rankedByOriginalIndex = new Map();
  scored.forEach((item, sortedIndex) => {
    const rank = sortedIndex + 1;
    const tier = rank <= 3 ? 1 : rank <= 5 ? 2 : null;
    rankedByOriginalIndex.set(item.originalIndex, {
      top_catalyst_tier: tier,
      top_catalyst_rank: tier ? rank : null,
      top_catalyst_reasons: tier ? item.reasons.slice(0, 4) : null,
    });
  });

  return picks.map((pick, index) => ({
    ...pick,
    ...rankedByOriginalIndex.get(index),
  }));
}

module.exports = {
  computeTierRanking,
};
