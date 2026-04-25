const { alignSingleSignal } = require('../alignment/single_signal');
const { categorizeBeaconCandidates } = require('../categorization/simple');
const { generateRunId, persistPicks } = require('../persistence/picks');
const { qualifyBeaconCandidates } = require('../qualification/basic_filters');
const { detectUpcomingEarningsWithin3d, SIGNAL_NAME } = require('../signals/earnings_upcoming_within_3d');

const BATCH_SIZE = 100;
const INTER_BATCH_DELAY_MS = 2000;

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
  const primarySignal = signals[0] || {};
  const daysUntilEarnings = primarySignal.evidence?.daysUntilEarnings;
  const timing = Number.isFinite(daysUntilEarnings)
    ? ` within ${daysUntilEarnings} day${daysUntilEarnings === 1 ? '' : 's'}`
    : '';

  return {
    symbol: candidate.symbol,
    pattern: candidate.patternCategory || 'Uncategorized Signal Alignment',
    confidence: candidate.confidenceQualification || 'basic_data_quality_passed',
    reasoning: `${candidate.symbol} has an upcoming earnings catalyst${timing}. ${candidate.patternDescription || ''}`.trim(),
    signals_aligned: signals.map((signal) => signal.signal),
    metadata: {
      direction: candidate.direction || 'neutral',
      alignment: candidate.alignment || null,
      signal_evidence: signals.map((signal) => signal.evidence || {}),
    },
  };
}

async function runSignalBatch(symbols, options = {}) {
  const signals = await detectUpcomingEarningsWithin3d({
    ...options,
    symbols,
  });
  const aligned = alignSingleSignal(signals);
  const qualified = qualifyBeaconCandidates(aligned, options.qualification || {});
  const categorized = categorizeBeaconCandidates(qualified);
  const candidates = categorized.filter((candidate) => candidate.qualified);
  const picks = candidates.map(candidateToPick);

  return {
    signals,
    aligned,
    categorized,
    candidates,
    picks,
  };
}

async function runBeaconPipeline(symbols = [], options = {}) {
  const startedAt = new Date().toISOString();
  const persist = options.persist !== false;
  const runId = options.runId || generateRunId();
  const batchSize = Number(options.batchSize || BATCH_SIZE);
  const interBatchDelayMs = Number(options.interBatchDelayMs ?? INTER_BATCH_DELAY_MS);
  const batches = Array.isArray(symbols) && symbols.length > 0
    ? chunkArray(symbols, batchSize)
    : [[]];

  const signals = [];
  const aligned = [];
  const categorized = [];
  const candidates = [];
  const picks = [];

  for (let index = 0; index < batches.length; index += 1) {
    const batchSymbols = batches[index];
    const result = await runSignalBatch(batchSymbols, options);
    signals.push(...result.signals);
    aligned.push(...result.aligned);
    categorized.push(...result.categorized);
    candidates.push(...result.candidates);
    picks.push(...result.picks);

    console.log(
      `[beacon-v0] Batch ${index + 1}/${batches.length} processed: ${batchSymbols.length || 'all'} symbols, ${result.signals.length} signals fired, ${result.picks.length} picks`,
    );

    if (index < batches.length - 1 && interBatchDelayMs > 0) {
      await sleep(interBatchDelayMs);
    }
  }

  let persistenceResult = { inserted: 0, runId, enabled: false };

  if (persist && picks.length > 0) {
    const result = await persistPicks(picks, runId);
    persistenceResult = { ...result, enabled: true };
    console.log(`[beacon-v0] Persisted ${result.inserted} picks under run_id=${runId}`);
  }

  return {
    scanVersion: 'beacon-v0-phase41',
    signalSlice: SIGNAL_NAME,
    generatedAt: startedAt,
    runId,
    persistence: {
      enabled: persist,
      inserted: persistenceResult.inserted,
      runId,
    },
    stats: {
      firedSignals: signals.length,
      alignedCandidates: aligned.length,
      qualifiedCandidates: candidates.length,
      disqualifiedCandidates: categorized.length - candidates.length,
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