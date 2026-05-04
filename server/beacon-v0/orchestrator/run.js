const { alignLeaderboardSignals, MIN_ALIGNMENT_COUNT, TOP_ALIGNED_PICKS } = require('../alignment/simple_count');
const { categorizeBeaconCandidates } = require('../categorization/simple');
const { generatePickNarrative } = require('../narrative/generateNarrative');
const { generateRunId, persistPicks } = require('../persistence/picks');
const { recordRunFunnel } = require('../persistence/runs');
const { qualifyBeaconCandidates } = require('../qualification/basic_filters');
const { computeTierRanking } = require('../ranking/computeTier');
const { queryWithTimeout } = require('../../db/pg');
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

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pickFirstMetadataNumber(signals, keys) {
  for (const signal of signals || []) {
    const metadata = signal?.evidence || signal?.metadata || {};
    for (const key of keys) {
      const value = toFiniteNumber(metadata[key]);
      if (value != null) return value;
    }
  }
  return null;
}

function extractPickBaselines(signals) {
  return {
    pick_price: pickFirstMetadataNumber(signals, ['price', 'latest_close', 'close']),
  };
}

async function computeCandidatePriceFallbacks(symbols = []) {
  const normalizedSymbols = [...new Set((symbols || [])
    .map((symbol) => String(symbol || '').trim().toUpperCase())
    .filter(Boolean))];

  if (normalizedSymbols.length === 0) {
    return new Map();
  }

  try {
    const { rows } = await queryWithTimeout(
      `
        WITH requested AS (
          SELECT DISTINCT UPPER(unnest($1::text[])) AS symbol
        ),
        latest_quotes AS (
          SELECT DISTINCT ON (UPPER(mq.symbol))
            UPPER(mq.symbol) AS symbol,
            mq.price,
            mq.updated_at
          FROM market_quotes mq
          JOIN requested r ON r.symbol = UPPER(mq.symbol)
          ORDER BY UPPER(mq.symbol), mq.updated_at DESC
        ),
        latest_closes AS (
          SELECT DISTINCT ON (UPPER(d.symbol))
            UPPER(d.symbol) AS symbol,
            d.close,
            d.date
          FROM daily_ohlc d
          JOIN requested r ON r.symbol = UPPER(d.symbol)
          ORDER BY UPPER(d.symbol), d.date DESC
        )
        SELECT
          r.symbol,
          q.price AS market_quote_price,
          q.updated_at AS market_quote_updated_at,
          d.close AS daily_close,
          d.date AS daily_close_date
        FROM requested r
        LEFT JOIN latest_quotes q ON q.symbol = r.symbol
        LEFT JOIN latest_closes d ON d.symbol = r.symbol
      `,
      [normalizedSymbols],
      {
        label: 'beacon_v0.compute_candidate_price_fallbacks',
        timeoutMs: 10000,
        slowQueryMs: 1000,
        poolType: 'read',
        maxRetries: 0,
      },
    );

    const fallbackPrices = new Map();
    for (const row of rows) {
      const symbol = String(row.symbol || '').toUpperCase();
      const marketQuotePrice = toFiniteNumber(row.market_quote_price);
      if (marketQuotePrice != null && marketQuotePrice > 0) {
        fallbackPrices.set(symbol, {
          pick_price: marketQuotePrice,
          price_source: 'market_quotes',
          price_timestamp: row.market_quote_updated_at || null,
        });
        continue;
      }

      const dailyClose = toFiniteNumber(row.daily_close);
      if (dailyClose != null && dailyClose > 0) {
        fallbackPrices.set(symbol, {
          pick_price: dailyClose,
          price_source: 'daily_ohlc',
          price_timestamp: row.daily_close_date || null,
        });
      }
    }

    return fallbackPrices;
  } catch (error) {
    console.warn('[beacon-v0] Failed to compute candidate price fallbacks', error.message || error);
    return new Map();
  }
}

async function computePickVolumeBaselines(symbols = []) {
  const normalizedSymbols = [...new Set((symbols || [])
    .map((symbol) => String(symbol || '').trim().toUpperCase())
    .filter(Boolean))];

  if (normalizedSymbols.length === 0) {
    return new Map();
  }

  try {
    const { rows } = await queryWithTimeout(
      `
        WITH requested AS (
          SELECT DISTINCT UPPER(unnest($1::text[])) AS symbol
        ),
        recent_bars AS (
          SELECT
            UPPER(d.symbol) AS symbol,
            d.volume,
            ROW_NUMBER() OVER (PARTITION BY UPPER(d.symbol) ORDER BY d.date DESC) AS rn
          FROM daily_ohlc d
          JOIN requested r ON r.symbol = UPPER(d.symbol)
          WHERE d.date > CURRENT_DATE - INTERVAL '40 days'
        )
        SELECT
          symbol,
          AVG(volume)::bigint AS avg_volume_20d,
          COUNT(*)::int AS bar_count
        FROM recent_bars
        WHERE rn <= 20
        GROUP BY symbol
        HAVING COUNT(*) >= 20
      `,
      [normalizedSymbols],
      {
        label: 'beacon_v0.compute_volume_baselines',
        timeoutMs: 10000,
        slowQueryMs: 1000,
        poolType: 'read',
        maxRetries: 0,
      },
    );

    const baselines = new Map();
    for (const row of rows) {
      const volume = toFiniteNumber(row.avg_volume_20d);
      if (volume != null) {
        baselines.set(String(row.symbol || '').toUpperCase(), volume);
      }
    }
    return baselines;
  } catch (error) {
    console.warn('[beacon-v0] Failed to compute authoritative volume baselines', error.message || error);
    return new Map();
  }
}

function candidateToPick(candidate, fallbackPriceMap = new Map()) {
  const signals = candidate.signals || [];
  const signalsAligned = signals.map((signal) => signal.signal);
  const forwardCount = signalsAligned.filter((signalName) => forwardLookingMap.get(signalName) === true).length;
  const signalBaselines = extractPickBaselines(signals);
  const fallbackBaselines = fallbackPriceMap.get(String(candidate.symbol || '').toUpperCase()) || null;
  const baselines = signalBaselines.pick_price != null
    ? {
      ...signalBaselines,
      price_source: 'signal',
    }
    : {
      ...signalBaselines,
      ...(fallbackBaselines || {}),
    };

  if (signalBaselines.pick_price == null && fallbackBaselines?.pick_price != null) {
    if (fallbackBaselines.price_source === 'market_quotes') {
      console.log(`[beacon-v0] using market_quotes price for ${candidate.symbol}`);
    } else if (fallbackBaselines.price_source === 'daily_ohlc') {
      console.log(`[beacon-v0] using daily_ohlc close for ${candidate.symbol}`);
    }
  }

  if (baselines.pick_price == null) {
    console.warn('[beacon-v0] Skipping pick without generation price baseline', {
      symbol: candidate.symbol,
      signals: signalsAligned,
    });
    return null;
  }

  return {
    symbol: candidate.symbol,
    ...baselines,
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
      generation_price_source: baselines.price_source || 'signal',
      generation_price_timestamp: baselines.price_timestamp || null,
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

function findSignalEvidence(pick, signalName) {
  const evidence = Array.isArray(pick?.metadata?.signal_evidence) ? pick.metadata.signal_evidence : [];
  return evidence.find((item) => item.signal === signalName) || null;
}

function pickTextArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item;
      return item?.headline || item?.title || item?.summary || null;
    })
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function buildNarrativeContext(pick) {
  const context = {};
  const newsEvidence = findSignalEvidence(pick, 'top_news_last_12h');
  const newsMetadata = newsEvidence?.metadata || {};
  const headlines = [
    ...pickTextArray(newsMetadata.headlines),
    ...pickTextArray(newsMetadata.news),
    ...pickTextArray(newsMetadata.articles),
    ...pickTextArray(newsMetadata.items),
  ];

  if (headlines.length > 0) {
    context.news_headlines = [...new Set(headlines)].slice(0, 2);
  }

  const upcomingEarnings = findSignalEvidence(pick, 'earnings_upcoming_within_3d');
  if (upcomingEarnings) {
    const metadata = upcomingEarnings.metadata || {};
    context.earnings_summary = metadata.days_until !== undefined
      ? `Earnings in ${metadata.days_until} days`
      : upcomingEarnings.reasoning || 'Upcoming earnings signal fired';
  }

  const earningsReaction = findSignalEvidence(pick, 'earnings_reaction_last_3d');
  if (!context.earnings_summary && earningsReaction) {
    const metadata = earningsReaction.metadata || {};
    context.earnings_summary = metadata.surprise_pct !== undefined
      ? `Recent earnings reaction with ${Number(metadata.surprise_pct).toFixed(1)}% surprise`
      : earningsReaction.reasoning || 'Recent earnings reaction signal fired';
  }

  const congressional = findSignalEvidence(pick, 'top_congressional_trades_recent');
  if (congressional) {
    const metadata = congressional.metadata || {};
    const purchases = metadata.total_purchases ?? metadata.purchase_count ?? metadata.purchases;
    const members = metadata.distinct_members ?? metadata.member_count ?? metadata.members;
    context.congressional_summary = purchases !== undefined || members !== undefined
      ? `${purchases ?? '?'} purchases by ${members ?? '?'} members`
      : congressional.reasoning || 'Recent congressional trade signal fired';
  }

  return context;
}

async function generateNarrativesBounded(picks, concurrency = 3) {
  const results = new Array(picks.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= picks.length) {
        return;
      }

      try {
        results[index] = await generatePickNarrative(picks[index], buildNarrativeContext(picks[index]));
      } catch (error) {
        results[index] = {
          thesis: null,
          watch_for: null,
          input_tokens: 0,
          output_tokens: 0,
          error: String(error.message || error),
        };
      }
    }
  }

  const workerCount = Math.min(Math.max(Number(concurrency) || 1, 1), picks.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  return results;
}

async function enrichPicksWithNarratives(picks) {
  if (!Array.isArray(picks) || picks.length === 0) {
    return picks;
  }

  console.log(`[beacon-v0] Generating narratives for ${picks.length} picks...`);
  const narrativeStartedAt = Date.now();

  const narratives = await generateNarrativesBounded(picks, 3);

  const enrichedPicks = picks.map((pick, index) => {
    const narrative = narratives[index];
    return {
      ...pick,
      narrative_thesis: narrative.thesis,
      narrative_watch_for: narrative.watch_for,
      narrative_generated_at: narrative.thesis ? new Date().toISOString() : null,
      narrative_model: narrative.model,
      narrative_input_tokens: narrative.input_tokens,
      narrative_output_tokens: narrative.output_tokens,
      narrative_error: narrative.error,
    };
  });

  const narrativeDuration = Math.round((Date.now() - narrativeStartedAt) / 1000);
  const narrativeSuccessCount = enrichedPicks.filter((pick) => pick.narrative_thesis).length;
  const totalInputTokens = enrichedPicks.reduce((sum, pick) => sum + (pick.narrative_input_tokens || 0), 0);
  const totalOutputTokens = enrichedPicks.reduce((sum, pick) => sum + (pick.narrative_output_tokens || 0), 0);

  console.log(`[beacon-v0] Narrative generation: ${narrativeSuccessCount}/${enrichedPicks.length} success, ${narrativeDuration}s`);
  console.log(`[beacon-v0] Token usage: ${totalInputTokens} input, ${totalOutputTokens} output`);

  return enrichedPicks;
}

function buildSignalDerivedReasoning(pick) {
  const evidence = Array.isArray(pick?.metadata?.signal_evidence) ? pick.metadata.signal_evidence : [];
  const signals = evidence.map((item) => item.signal).filter(Boolean);
  return `Aligned on ${signals.length > 0 ? signals.join(', ') : 'multiple signals'}. Window-discovered, no nightly narrative.`;
}

async function getExistingNightlyNarratives(symbols = []) {
  const normalizedSymbols = [...new Set((symbols || [])
    .map((symbol) => String(symbol || '').trim().toUpperCase())
    .filter(Boolean))];

  if (normalizedSymbols.length === 0) {
    return new Map();
  }

  const { rows } = await queryWithTimeout(
    `
      SELECT DISTINCT ON (UPPER(symbol))
        UPPER(symbol) AS symbol,
        narrative_thesis AS thesis,
        narrative_watch_for AS watch_for
      FROM beacon_v0_picks
      WHERE UPPER(symbol) = ANY($1::text[])
        AND discovered_in_window = 'nightly'
        AND created_at > NOW() - INTERVAL '24 hours'
      ORDER BY UPPER(symbol), created_at DESC
    `,
    [normalizedSymbols],
    {
      label: 'beacon_v0.orchestrator.existing_narratives',
      timeoutMs: 5000,
      slowQueryMs: 1000,
      poolType: 'read',
      maxRetries: 0,
    },
  );

  const narratives = new Map();
  for (const row of rows) {
    narratives.set(row.symbol, {
      thesis: row.thesis || null,
      watch_for: row.watch_for || null,
    });
  }
  return narratives;
}

async function enrichPicksWithoutNarrativeGeneration(picks) {
  if (!Array.isArray(picks) || picks.length === 0) {
    return picks;
  }

  const narratives = await getExistingNightlyNarratives(picks.map((pick) => pick.symbol));
  return picks.map((pick) => {
    const existing = narratives.get(String(pick.symbol || '').toUpperCase());
    return {
      ...pick,
      narrative_thesis: existing?.thesis || buildSignalDerivedReasoning(pick),
      narrative_watch_for: existing?.watch_for || null,
      narrative_generated_at: null,
      narrative_model: existing?.thesis ? 'nightly_reuse' : 'signal_derived',
      narrative_input_tokens: 0,
      narrative_output_tokens: 0,
      narrative_error: null,
    };
  });
}

async function runBeaconPipeline(symbols = [], options = {}) {
  const startedAt = new Date().toISOString();
  const persist = options.persist !== false;
  const runId = options.runId || generateRunId();
  const signalsToRun = options.signals || SIGNALS;
  const windowContext = options.windowContext || null;
  const skipNarrativeGeneration = options.skipNarrativeGeneration === true;
  const signalResults = [];
  const funnel = {
    candidates_evaluated: Array.isArray(symbols) ? symbols.length : 0,
    candidates_aligned: 0,
    candidates_qualified: 0,
    candidates_picked: 0,
    candidates_skipped_no_price: 0,
  };

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
  funnel.candidates_aligned = aligned.length;
  const qualified = qualifyBeaconCandidates(aligned, {
    ...(options.qualification || {}),
    minAlignmentCount,
  });
  const categorized = categorizeBeaconCandidates(qualified);
  const candidates = categorized.filter((candidate) => candidate.qualified);
  funnel.candidates_qualified = candidates.length;
  const missingSignalPriceSymbols = candidates
    .filter((candidate) => extractPickBaselines(candidate.signals || []).pick_price == null)
    .map((candidate) => candidate.symbol);
  const fallbackPriceMap = await computeCandidatePriceFallbacks(missingSignalPriceSymbols);
  const candidatePicks = [];
  for (const candidate of candidates) {
    const pick = candidateToPick(candidate, fallbackPriceMap);
    if (pick) {
      candidatePicks.push(pick);
    } else {
      funnel.candidates_skipped_no_price += 1;
    }
  }
  const narrativeReadyPicks = skipNarrativeGeneration
    ? await enrichPicksWithoutNarrativeGeneration(candidatePicks)
    : await enrichPicksWithNarratives(candidatePicks);
  const picks = computeTierRanking(narrativeReadyPicks);
  const volumeBaselines = await computePickVolumeBaselines(picks.map((pick) => pick.symbol));
  picks.forEach((pick) => {
    pick.pick_volume_baseline = volumeBaselines.get(String(pick.symbol || '').toUpperCase()) ?? null;
  });
  funnel.candidates_picked = picks.length;
  let persistenceResult = { inserted: 0, runId, enabled: false };

  if (persist && picks.length > 0) {
    const result = await persistPicks(picks, runId, {
      discoveredInWindow: windowContext?.name || 'nightly',
    });
    persistenceResult = { ...result, enabled: true };
    await recordRunFunnel(runId, funnel);
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
      funnel,
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
  computeCandidatePriceFallbacks,
  chunkArray,
  computePickVolumeBaselines,
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