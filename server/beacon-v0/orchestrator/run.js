const { alignLeaderboardSignals, MIN_ALIGNMENT_COUNT, TOP_ALIGNED_PICKS } = require('../alignment/simple_count');
const { categorizeBeaconCandidates } = require('../categorization/simple');
const { generateRunId, persistPicks } = require('../persistence/picks');
const { qualifyBeaconCandidates } = require('../qualification/basic_filters');
const earningsReactionLast3d = require('../signals/earnings_reaction_last_3d');
const earningsUpcomingWithin3d = require('../signals/earnings_upcoming_within_3d');
const topCoiledSpring = require('../signals/top_coiled_spring');
const topCongressionalTradesRecent = require('../signals/top_congressional_trades_recent');
const topGapToday = require('../signals/top_gap_today');
const topNewsLast12h = require('../signals/top_news_last_12h');
const topRvolToday = require('../signals/top_rvol_today');
const topVolumeBuilding = require('../signals/top_volume_building');

const BATCH_SIZE = 100;
const INTER_BATCH_DELAY_MS = 2000;
const SIGNALS = [
  topRvolToday,
  topGapToday,
  topNewsLast12h,
  earningsUpcomingWithin3d,
  earningsReactionLast3d,
  topCoiledSpring,
  topVolumeBuilding,
  topCongressionalTradesRecent,
];

const forwardLookingMap = new Map();
SIGNALS.forEach((signal) => {
  if (signal && signal.SIGNAL_NAME) {
    forwardLookingMap.set(signal.SIGNAL_NAME, Boolean(signal.FORWARD_LOOKING));
  }
});

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function candidateToPick(candidate) {
  const signals = candidate.signals || [];
  const signalsAligned = signals.map((signal) => signal.signal);
  const forwardCount = signalsAligned.filter((signalName) => forwardLookingMap.get(signalName) === true).length;

  return {
    symbol: candidate.symbol,
    pattern: candidate.patternCategory || 'Multi-Signal Alignment',
    pattern_label: candidate.patternLabel || candidate.patternCategory || 'Multi-Signal Alignment',
    confidence: candidate.confidenceQualification || 'emerging_alignment',
    reasoning: candidate.patternDescription
      ? `${candidate.symbol}: ${candidate.patternDescription}`
      : `${candidate.symbol}: multiple Beacon v0 leaderboards align on this symbol.`,
    signals_aligned: signalsAligned,
    forward_count: forwardCount,
    backward_count: signalsAligned.length - forwardCount,
    metadata: {
      direction: candidate.direction || 'neutral',
      pattern_name: candidate.patternName || 'multi_signal_alignment',
      pattern_label: candidate.patternLabel || candidate.patternCategory || 'Multi-Signal Alignment',
      alignment: candidate.alignment || null,
      signal_evidence: signals.map((signal) => ({
        signal: signal.signal,
        category: signal.category || signal.signalCategory || null,
        rank: signal.rank || null,
        score: signal.score || null,
        reasoning: signal.reasoning || null,
        metadata: signal.evidence || signal.metadata || {},
      })),
    },
  };
}

async function runBeaconPipeline(symbols = [], options = {}) {
  const startedAt = new Date().toISOString();
  const persist = options.persist !== false;
  const runId = options.runId || generateRunId();
  const signalsToRun = options.signals || SIGNALS;
  const signalResults = [];

  for (let index = 0; index < signalsToRun.length; index += 1) {
    const signal = signalsToRun[index];
    const results = await signal.detect(symbols, options);
    signalResults.push({
      signal: signal.SIGNAL_NAME,
      category: signal.CATEGORY,
      runMode: signal.RUN_MODE,
      results,
    });
    console.log(`[beacon-v0] Signal ${index + 1}/${signalsToRun.length} ${signal.SIGNAL_NAME}: ${results.size} leaderboard hits`);

    if (index < signalsToRun.length - 1 && Number(options.interSignalDelayMs || 0) > 0) {
      await sleep(Number(options.interSignalDelayMs));
    }
  }

  const firedSignals = signalResults.reduce((total, item) => total + item.results.size, 0);
  const minAlignmentCount = Number(options.minAlignmentCount || MIN_ALIGNMENT_COUNT);
  const aligned = alignLeaderboardSignals(signalResults, {
    minAlignmentCount,
    limit: Number(options.limit || TOP_ALIGNED_PICKS),
  });
  const qualified = qualifyBeaconCandidates(aligned, {
    ...(options.qualification || {}),
    minAlignmentCount,
  });
  const categorized = categorizeBeaconCandidates(qualified);
  const candidates = categorized.filter((candidate) => candidate.qualified);
  const picks = candidates.map(candidateToPick);
  let persistenceResult = { inserted: 0, runId, enabled: false };

  if (persist && picks.length > 0) {
    const result = await persistPicks(picks, runId);
    persistenceResult = { ...result, enabled: true };
    console.log(`[beacon-v0] Persisted ${result.inserted} picks under run_id=${runId}`);
  }

  return {
    scanVersion: 'beacon-v0-phase43',
    signalSlice: 'leaderboard_alignment_v1',
    generatedAt: startedAt,
    runId,
    signalResults: signalResults.map((item) => ({
      signal: item.signal,
      category: item.category,
      runMode: item.runMode,
      count: item.results.size,
    })),
    persistence: {
      enabled: persist,
      inserted: persistenceResult.inserted,
      runId,
    },
    stats: {
      firedSignals,
      alignedCandidates: aligned.length,
      qualifiedCandidates: candidates.length,
      disqualifiedCandidates: categorized.length - candidates.length,
      signalLeaderboards: signalResults.length,
      minAlignmentCount,
    },
    picks,
    candidates,
    disqualifiedCandidates: categorized.filter((candidate) => !candidate.qualified),
  };
}

async function runBeaconV0(options = {}) {
  return runBeaconPipeline(options.symbols || [], options);
}

module.exports = {
  BATCH_SIZE,
  INTER_BATCH_DELAY_MS,
  SIGNALS,
  candidateToPick,
  chunkArray,
  runBeaconPipeline,
  runBeaconV0,
  sleep,
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