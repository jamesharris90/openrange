#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { queryWithTimeout } = require('../db/pg');
const { runNewsIngestion } = require('../ingestion/fmp_news_ingest');
const { runNewsBackfill } = require('../v2/ingestion/newsBackfill');
const { runEarningsIngestionEngine } = require('../engines/earningsIngestionEngine');
const {
  writeCoverageCampaignState,
  appendCoverageCampaignHourlyEntry,
  deleteCoverageCampaignState,
} = require('../services/coverageCampaignStateStore');

const LOG_DIR = path.resolve(__dirname, '..', 'logs', 'backfill');
const CHECKPOINT_PATH = path.join(LOG_DIR, 'coverage_completion_campaign_checkpoint.json');
const STATUS_PATH = path.join(LOG_DIR, 'coverage_completion_campaign_status.json');
const HOURLY_REPORT_PATH = path.join(LOG_DIR, 'coverage_completion_campaign_hourly.jsonl');

const DEFAULT_NEWS_BATCH_SIZE = 20;
const DEFAULT_NEWS_CONCURRENCY = 1;
const DEFAULT_INTER_SYMBOL_DELAY_MS = 1500;
const DEFAULT_INTER_BATCH_DELAY_MS = 15000;
const DEFAULT_CYCLE_SLEEP_MS = 300000;
const DEFAULT_REPORT_INTERVAL_MS = 3600000;
const DEFAULT_MIN_NEWS_ITEMS = 4;
const DEFAULT_MIN_EARNINGS_HISTORY = 8;
const DEFAULT_IPO_GRACE_DAYS = 730;
const DEFAULT_UPCOMING_DAYS = 180;
const DEFAULT_MAX_NEWS_ATTEMPTS_PER_SYMBOL = 2;
const DEFAULT_SAFE_MODE = !['0', 'false', 'no'].includes(String(process.env.COVERAGE_CAMPAIGN_SAFE_MODE || '').trim().toLowerCase());
const SAFE_NEWS_BATCH_SIZE = 3;
const SAFE_INTER_SYMBOL_DELAY_MS = 5000;
const SAFE_INTER_BATCH_DELAY_MS = 45000;
const SAFE_CYCLE_SLEEP_MS = 300000;
const DEFAULT_HEALTH_CHECK_URL = process.env.COVERAGE_CAMPAIGN_HEALTHCHECK_URL || 'http://127.0.0.1:3000/api/health';
const DEFAULT_BACKEND_HEALTH_CHECK_URL = process.env.COVERAGE_CAMPAIGN_BACKEND_HEALTHCHECK_URL || 'http://127.0.0.1:3007/api/health';
const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 4000;
const DEFAULT_HEALTH_BACKOFF_MS = 15000;
const SAFE_MAX_ARTICLES_PER_SYMBOL = 25;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientCampaignError(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();

  return (
    code === 'ENETUNREACH'
    || code === 'ECONNRESET'
    || code === 'ECONNREFUSED'
    || code === 'ETIMEDOUT'
    || code === 'QUERY_TIMEOUT'
    || message.includes('max client connections reached')
    || message.includes('too many clients')
    || message.includes('remaining connection slots are reserved')
    || message.includes('timeout')
    || message.includes('econnreset')
    || message.includes('econnrefused')
    || message.includes('enetunreach')
  );
}

function parseArgs(argv) {
  const options = {
    safeMode: DEFAULT_SAFE_MODE,
    loop: false,
    dryRun: false,
    newsOnly: false,
    earningsOnly: false,
    resetCheckpoint: false,
    retryAttemptedNews: false,
    newsBatchSize: DEFAULT_NEWS_BATCH_SIZE,
    newsConcurrency: DEFAULT_NEWS_CONCURRENCY,
    maxNewsSymbols: null,
    interSymbolDelayMs: DEFAULT_INTER_SYMBOL_DELAY_MS,
    interBatchDelayMs: DEFAULT_INTER_BATCH_DELAY_MS,
    cycleSleepMs: DEFAULT_CYCLE_SLEEP_MS,
    reportIntervalMs: DEFAULT_REPORT_INTERVAL_MS,
    minNewsItems: DEFAULT_MIN_NEWS_ITEMS,
    minEarningsHistory: DEFAULT_MIN_EARNINGS_HISTORY,
    ipoGraceDays: DEFAULT_IPO_GRACE_DAYS,
    upcomingDays: DEFAULT_UPCOMING_DAYS,
    maxNewsAttemptsPerSymbol: DEFAULT_MAX_NEWS_ATTEMPTS_PER_SYMBOL,
    maxCycles: null,
    healthCheckEnabled: DEFAULT_SAFE_MODE,
    healthCheckUrl: DEFAULT_HEALTH_CHECK_URL,
    backendHealthCheckUrl: DEFAULT_BACKEND_HEALTH_CHECK_URL,
    healthCheckTimeoutMs: DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
    healthBackoffMs: DEFAULT_HEALTH_BACKOFF_MS,
    allowMissingFrontend: true,
    maxArticlesPerSymbol: null,
  };

  const explicit = {
    newsBatchSize: false,
    newsConcurrency: false,
    interSymbolDelayMs: false,
    interBatchDelayMs: false,
    cycleSleepMs: false,
  };

  for (const arg of argv) {
    if (arg === '--loop') options.loop = true;
    else if (arg === '--safe') options.safeMode = true;
    else if (arg === '--unsafe') {
      options.safeMode = false;
      options.healthCheckEnabled = false;
    }
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--news-only') options.newsOnly = true;
    else if (arg === '--earnings-only') options.earningsOnly = true;
    else if (arg === '--reset-checkpoint') options.resetCheckpoint = true;
    else if (arg === '--retry-attempted-news') options.retryAttemptedNews = true;
    else if (arg === '--skip-health-check') options.healthCheckEnabled = false;
    else if (arg === '--require-frontend-health') options.allowMissingFrontend = false;
    else if (arg.startsWith('--news-batch-size=')) {
      explicit.newsBatchSize = true;
      options.newsBatchSize = Math.max(1, Number(arg.split('=')[1]) || DEFAULT_NEWS_BATCH_SIZE);
    }
    else if (arg.startsWith('--news-concurrency=')) {
      explicit.newsConcurrency = true;
      options.newsConcurrency = Math.max(1, Number(arg.split('=')[1]) || DEFAULT_NEWS_CONCURRENCY);
    }
    else if (arg.startsWith('--max-news-symbols=')) {
      const parsed = Number(arg.split('=')[1]);
      options.maxNewsSymbols = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    } else if (arg.startsWith('--inter-symbol-delay-ms=')) {
      explicit.interSymbolDelayMs = true;
      options.interSymbolDelayMs = Math.max(0, Number(arg.split('=')[1]) || DEFAULT_INTER_SYMBOL_DELAY_MS);
    } else if (arg.startsWith('--inter-batch-delay-ms=')) {
      explicit.interBatchDelayMs = true;
      options.interBatchDelayMs = Math.max(0, Number(arg.split('=')[1]) || DEFAULT_INTER_BATCH_DELAY_MS);
    } else if (arg.startsWith('--cycle-sleep-ms=')) {
      explicit.cycleSleepMs = true;
      options.cycleSleepMs = Math.max(0, Number(arg.split('=')[1]) || DEFAULT_CYCLE_SLEEP_MS);
    } else if (arg.startsWith('--report-interval-ms=')) {
      options.reportIntervalMs = Math.max(60000, Number(arg.split('=')[1]) || DEFAULT_REPORT_INTERVAL_MS);
    } else if (arg.startsWith('--min-news-items=')) {
      options.minNewsItems = Math.max(1, Number(arg.split('=')[1]) || DEFAULT_MIN_NEWS_ITEMS);
    } else if (arg.startsWith('--min-earnings-history=')) {
      options.minEarningsHistory = Math.max(1, Number(arg.split('=')[1]) || DEFAULT_MIN_EARNINGS_HISTORY);
    } else if (arg.startsWith('--ipo-grace-days=')) {
      options.ipoGraceDays = Math.max(1, Number(arg.split('=')[1]) || DEFAULT_IPO_GRACE_DAYS);
    } else if (arg.startsWith('--upcoming-days=')) {
      options.upcomingDays = Math.max(1, Number(arg.split('=')[1]) || DEFAULT_UPCOMING_DAYS);
    } else if (arg.startsWith('--max-news-attempts-per-symbol=')) {
      options.maxNewsAttemptsPerSymbol = Math.max(1, Number(arg.split('=')[1]) || DEFAULT_MAX_NEWS_ATTEMPTS_PER_SYMBOL);
    } else if (arg.startsWith('--max-cycles=')) {
      const parsed = Number(arg.split('=')[1]);
      options.maxCycles = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    } else if (arg.startsWith('--health-check-url=')) {
      options.healthCheckUrl = String(arg.split('=')[1] || '').trim() || DEFAULT_HEALTH_CHECK_URL;
    } else if (arg.startsWith('--backend-health-check-url=')) {
      options.backendHealthCheckUrl = String(arg.split('=')[1] || '').trim() || DEFAULT_BACKEND_HEALTH_CHECK_URL;
    } else if (arg.startsWith('--health-check-timeout-ms=')) {
      options.healthCheckTimeoutMs = Math.max(500, Number(arg.split('=')[1]) || DEFAULT_HEALTH_CHECK_TIMEOUT_MS);
    } else if (arg.startsWith('--health-backoff-ms=')) {
      options.healthBackoffMs = Math.max(1000, Number(arg.split('=')[1]) || DEFAULT_HEALTH_BACKOFF_MS);
    } else if (arg.startsWith('--max-articles-per-symbol=')) {
      options.maxArticlesPerSymbol = Math.max(1, Number(arg.split('=')[1]) || SAFE_MAX_ARTICLES_PER_SYMBOL);
    }
  }

  if (options.newsOnly) options.earningsOnly = false;
  if (options.earningsOnly) options.newsOnly = false;

  if (options.safeMode) {
    if (!explicit.newsBatchSize) {
      options.newsBatchSize = Math.min(options.newsBatchSize, SAFE_NEWS_BATCH_SIZE);
    }
    if (!explicit.interSymbolDelayMs) {
      options.interSymbolDelayMs = Math.max(options.interSymbolDelayMs, SAFE_INTER_SYMBOL_DELAY_MS);
    }
    if (!explicit.interBatchDelayMs) {
      options.interBatchDelayMs = Math.max(options.interBatchDelayMs, SAFE_INTER_BATCH_DELAY_MS);
    }
    if (!explicit.cycleSleepMs) {
      options.cycleSleepMs = Math.max(options.cycleSleepMs, SAFE_CYCLE_SLEEP_MS);
    }
    options.newsConcurrency = 1;
    options.healthCheckEnabled = options.healthCheckEnabled !== false;
    options.maxArticlesPerSymbol = Math.max(1, Number(options.maxArticlesPerSymbol || SAFE_MAX_ARTICLES_PER_SYMBOL));
  }

  return options;
}

function isConnectionRefused(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('econnrefused') || message.includes('fetch failed') || message.includes('connect');
}

async function probeHealth(url, timeoutMs) {
  if (!url) {
    return { ok: true, status: null, skipped: true };
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    return {
      ok: response.status === 200,
      status: response.status,
      error: null,
      connectionRefused: false,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error.message,
      connectionRefused: isConnectionRefused(error),
    };
  }
}

async function waitForHealthyRuntime(options, context) {
  if (!options.healthCheckEnabled) {
    return;
  }

  while (true) {
    const [frontend, backend] = await Promise.all([
      probeHealth(options.healthCheckUrl, options.healthCheckTimeoutMs),
      probeHealth(options.backendHealthCheckUrl, options.healthCheckTimeoutMs),
    ]);

    const frontendUnavailable = options.allowMissingFrontend && frontend.connectionRefused;
    if (backend.ok && (frontend.ok || frontendUnavailable)) {
      return;
    }

    console.warn('[COVERAGE_CAMPAIGN_BACKPRESSURE]', {
      context,
      frontend,
      backend,
      health_backoff_ms: options.healthBackoffMs,
    });
    await sleep(options.healthBackoffMs);
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function appendJsonLine(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

function dedupeSorted(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort();
}

function extractSnapshotSymbols(snapshotData) {
  const screenerData = Array.isArray(snapshotData?.screener?.data) ? snapshotData.screener.data : [];
  return dedupeSorted(
    screenerData
      .map((item) => String(item?.symbol || '').trim().toUpperCase())
      .filter(Boolean)
  );
}

function createEmptyCheckpoint() {
  const now = new Date().toISOString();
  return {
    version: 1,
    created_at: now,
    updated_at: now,
    snapshot_created_at: null,
    supervisor: {
      cycles_completed: 0,
      no_progress_cycles: 0,
      last_hourly_report_at: null,
      retry_attempted_news: false,
      effective_news_batch_size: DEFAULT_NEWS_BATCH_SIZE,
      effective_news_concurrency: DEFAULT_NEWS_CONCURRENCY,
    },
    news: {
      attempted_symbols: [],
      resolved_symbols: [],
      unresolved_symbols: [],
      batches: [],
      completed: false,
    },
    earnings: {
      completed: false,
      summary: null,
    },
  };
}

async function loadCoverageState(options) {
  const snapshotResult = await queryWithTimeout(
    `SELECT created_at, data
     FROM screener_snapshots
     ORDER BY created_at DESC
     LIMIT 1`,
    [],
    {
      timeoutMs: 20000,
      label: 'coverage_campaign.load_snapshot',
      maxRetries: 2,
      retryDelayMs: 1000,
    }
  );

  const row = snapshotResult.rows?.[0] || {};
  const screenerSymbols = extractSnapshotSymbols(row.data);

  if (screenerSymbols.length === 0) {
    return {
      snapshotCreatedAt: row.created_at || null,
      screenerSymbols: [],
      missingNewsSymbols: [],
      missingEarningsSymbols: [],
      recentIpoSymbols: [],
    };
  }

  const [newsCountsResult, earningsCountsResult, recentIposResult] = await Promise.all([
    queryWithTimeout(
      `SELECT symbol, COUNT(*)::int AS article_count
       FROM news_articles
       WHERE symbol = ANY($1::text[])
       GROUP BY symbol`,
      [screenerSymbols],
      {
        timeoutMs: 20000,
        label: 'coverage_campaign.load_news_counts',
        maxRetries: 1,
      }
    ),
    queryWithTimeout(
      `SELECT symbol, COUNT(DISTINCT report_date)::int AS report_count
       FROM earnings_history
       WHERE symbol = ANY($1::text[])
         AND report_date IS NOT NULL
       GROUP BY symbol`,
      [screenerSymbols],
      {
        timeoutMs: 20000,
        label: 'coverage_campaign.load_earnings_counts',
        maxRetries: 1,
      }
    ),
    queryWithTimeout(
      `SELECT DISTINCT symbol
       FROM ipo_calendar
       WHERE symbol = ANY($1::text[])
         AND event_date >= CURRENT_DATE - make_interval(days => $2::int)`,
      [screenerSymbols, options.ipoGraceDays],
      {
        timeoutMs: 12000,
        label: 'coverage_campaign.load_recent_ipos',
        maxRetries: 1,
      }
    ),
  ]);

  const newsCounts = new Map(
    (newsCountsResult.rows || []).map((entry) => [String(entry.symbol || '').trim().toUpperCase(), Number(entry.article_count || 0)])
  );
  const earningsCounts = new Map(
    (earningsCountsResult.rows || []).map((entry) => [String(entry.symbol || '').trim().toUpperCase(), Number(entry.report_count || 0)])
  );
  const recentIpoSymbols = dedupeSorted(
    (recentIposResult.rows || []).map((entry) => String(entry.symbol || '').trim().toUpperCase())
  );
  const recentIpoSet = new Set(recentIpoSymbols);

  const missingNewsSymbols = screenerSymbols.filter(
    (symbol) => (newsCounts.get(symbol) || 0) < options.minNewsItems
  );
  const missingEarningsSymbols = screenerSymbols.filter(
    (symbol) => !recentIpoSet.has(symbol) && (earningsCounts.get(symbol) || 0) < options.minEarningsHistory
  );

  return {
    snapshotCreatedAt: row.created_at || null,
    screenerSymbols,
    missingNewsSymbols,
    missingEarningsSymbols,
    recentIpoSymbols,
  };
}

async function getDirectNewsCount(symbol) {
  const result = await queryWithTimeout(
    `SELECT COUNT(*)::int AS article_count
     FROM news_articles
     WHERE UPPER(BTRIM(symbol)) = $1`,
    [symbol],
    {
      timeoutMs: 20000,
      label: 'coverage_campaign.news_count',
      maxRetries: 0,
    }
  );

  return Number(result.rows?.[0]?.article_count || 0);
}

async function persistCheckpoint(checkpoint) {
  checkpoint.updated_at = new Date().toISOString();
  checkpoint.news.attempted_symbols = dedupeSorted(checkpoint.news.attempted_symbols);
  checkpoint.news.resolved_symbols = dedupeSorted(checkpoint.news.resolved_symbols);
  checkpoint.news.unresolved_symbols = dedupeSorted(checkpoint.news.unresolved_symbols);
  writeJson(CHECKPOINT_PATH, checkpoint);
  await writeCoverageCampaignState('checkpoint', checkpoint).catch((error) => {
    console.warn('[COVERAGE_CAMPAIGN_SHARED_STATE] checkpoint write failed', { error: error.message });
  });
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function processNewsSymbol(symbol, options, cycle, batchIndex) {
  await waitForHealthyRuntime(options, { phase: 'news', cycle, batchIndex, symbol });

  const symbolSummary = {
    symbol,
    before_count: await getDirectNewsCount(symbol),
    after_count: 0,
    resolved: false,
    attempts: [],
  };
  const totals = {
    insertedPrimary: 0,
    dedupedPrimary: 0,
    insertedSecondary: 0,
    duplicatesSecondary: 0,
  };

  let currentCount = symbolSummary.before_count;
  let attempts = 0;
  while (currentCount < options.minNewsItems && attempts < options.maxNewsAttemptsPerSymbol) {
    attempts += 1;
    let primarySummary = null;
    let secondarySummary = null;

    try {
      primarySummary = await runNewsIngestion([symbol], {
        maxArticlesPerSymbol: options.maxArticlesPerSymbol,
      });
    } catch (error) {
      primarySummary = { inserted: 0, deduped: 0, error: error.message };
      console.warn('[COVERAGE_CAMPAIGN_NEWS] primary ingestion failed', { symbol, error: error.message });
    }

    currentCount = await getDirectNewsCount(symbol);
    if (currentCount < options.minNewsItems) {
      try {
        secondarySummary = await runNewsBackfill({ symbols: [symbol] });
      } catch (error) {
        secondarySummary = { inserted: 0, duplicates: 0, error: error.message };
        console.warn('[COVERAGE_CAMPAIGN_NEWS] secondary backfill failed', { symbol, error: error.message });
      }
      currentCount = await getDirectNewsCount(symbol);
    }

    totals.insertedPrimary += Number(primarySummary?.inserted || 0);
    totals.dedupedPrimary += Number(primarySummary?.deduped || 0);
    totals.insertedSecondary += Number(secondarySummary?.inserted || 0);
    totals.duplicatesSecondary += Number(secondarySummary?.duplicates || 0);
    symbolSummary.attempts.push({
      attempt: attempts,
      primary_inserted: Number(primarySummary?.inserted || 0),
      primary_deduped: Number(primarySummary?.deduped || 0),
      secondary_inserted: Number(secondarySummary?.inserted || 0),
      secondary_duplicates: Number(secondarySummary?.duplicates || 0),
      count_after_attempt: currentCount,
    });
  }

  symbolSummary.after_count = currentCount;
  symbolSummary.resolved = currentCount >= options.minNewsItems;

  return { symbolSummary, totals };
}

async function runNewsPhase(state, checkpoint, options, runtime, cycle) {
  const attemptedSet = new Set(checkpoint.news.attempted_symbols || []);
  const pendingSymbols = state.missingNewsSymbols.filter((symbol) => options.retryAttemptedNews || !attemptedSet.has(symbol));
  const targetSymbols = options.maxNewsSymbols ? pendingSymbols.slice(0, options.maxNewsSymbols) : pendingSymbols;
  const summary = {
    starting_missing_news: state.missingNewsSymbols.length,
    pending_news_symbols: pendingSymbols.length,
    targeted_news_symbols: targetSymbols.length,
    minimum_news_items: options.minNewsItems,
    batch_size: options.newsBatchSize,
    news_concurrency: options.newsConcurrency,
    max_attempts_per_symbol: options.maxNewsAttemptsPerSymbol,
    retry_attempted_news: options.retryAttemptedNews,
    batches: [],
  };

  if (options.dryRun || targetSymbols.length === 0) {
    return summary;
  }

  const batches = chunkArray(targetSymbols, options.newsBatchSize);
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const batchSummary = {
      batch_index: batchIndex + 1,
      symbol_count: batch.length,
      symbols: batch,
      resolved_symbols: [],
      unresolved_symbols: [],
      total_inserted_primary: 0,
      total_deduped_primary: 0,
      total_inserted_secondary: 0,
      total_duplicates_secondary: 0,
      symbol_runs: [],
      started_at: new Date().toISOString(),
    };

    const concurrentGroups = chunkArray(batch, Math.max(1, options.newsConcurrency || 1));
    for (let groupIndex = 0; groupIndex < concurrentGroups.length; groupIndex += 1) {
      const group = concurrentGroups[groupIndex];
      const results = await Promise.allSettled(
        group.map((symbol) => processNewsSymbol(symbol, options, cycle, batchIndex + 1))
      );

      for (let resultIndex = 0; resultIndex < results.length; resultIndex += 1) {
        const symbol = group[resultIndex];
        const result = results[resultIndex];
        const symbolResult = result.status === 'fulfilled'
          ? result.value
          : {
              symbolSummary: {
                symbol,
                before_count: 0,
                after_count: 0,
                resolved: false,
                attempts: [{ attempt: 1, error: result.reason?.message || String(result.reason || 'unknown error') }],
              },
              totals: {
                insertedPrimary: 0,
                dedupedPrimary: 0,
                insertedSecondary: 0,
                duplicatesSecondary: 0,
              },
            };

        const { symbolSummary, totals } = symbolResult;
        batchSummary.total_inserted_primary += totals.insertedPrimary;
        batchSummary.total_deduped_primary += totals.dedupedPrimary;
        batchSummary.total_inserted_secondary += totals.insertedSecondary;
        batchSummary.total_duplicates_secondary += totals.duplicatesSecondary;

        checkpoint.news.attempted_symbols.push(symbol);
        if (symbolSummary.resolved) {
          checkpoint.news.resolved_symbols.push(symbol);
          checkpoint.news.unresolved_symbols = (checkpoint.news.unresolved_symbols || []).filter((value) => value !== symbol);
          batchSummary.resolved_symbols.push(symbol);
        } else {
          checkpoint.news.unresolved_symbols.push(symbol);
          batchSummary.unresolved_symbols.push(symbol);
        }

        batchSummary.symbol_runs.push(symbolSummary);
        await persistCheckpoint(checkpoint);
        await maybeWriteProgressReport({
          cycle,
          phase: 'news',
          options,
          runtime,
          checkpoint,
        });

        console.log('[COVERAGE_CAMPAIGN_NEWS]', {
          symbol,
          before_count: symbolSummary.before_count,
          after_count: symbolSummary.after_count,
          resolved: symbolSummary.resolved,
          attempts: symbolSummary.attempts.length,
        });
      }

      const isLastGroup = groupIndex === concurrentGroups.length - 1;
      if (!isLastGroup && options.interSymbolDelayMs > 0) {
        await sleep(options.interSymbolDelayMs);
      }
    }

    batchSummary.completed_at = new Date().toISOString();
    checkpoint.news.batches.push(batchSummary);
    summary.batches.push(batchSummary);
    await persistCheckpoint(checkpoint);

    const isLastBatch = batchIndex === batches.length - 1;
    if (!isLastBatch && options.interBatchDelayMs > 0) {
      await sleep(options.interBatchDelayMs);
    }
  }

  checkpoint.news.completed = false;
  await persistCheckpoint(checkpoint);
  return summary;
}

async function runEarningsPhase(state, checkpoint, options, runtime, cycle) {
  const summary = {
    starting_missing_earnings: state.missingEarningsSymbols.length,
    targeted_earnings_symbols: state.missingEarningsSymbols.length,
    minimum_history_reports: options.minEarningsHistory,
    upcoming_days: options.upcomingDays,
    recent_ipo_exemptions: state.recentIpoSymbols.length,
    engine_summary: null,
  };

  if (options.dryRun || state.missingEarningsSymbols.length === 0) {
    return summary;
  }

  await maybeWriteProgressReport({
    cycle,
    phase: 'earnings',
    options,
    runtime,
    checkpoint,
  });

  await waitForHealthyRuntime(options, { phase: 'earnings', cycle, symbol_count: state.missingEarningsSymbols.length });

  const engineSummary = await runEarningsIngestionEngine({
    symbols: state.missingEarningsSymbols,
    upcomingDays: options.upcomingDays,
  });

  checkpoint.earnings.completed = false;
  checkpoint.earnings.summary = engineSummary;
  await persistCheckpoint(checkpoint);

  summary.engine_summary = engineSummary;
  return summary;
}

function createStatusReport(cycle, options, runtime, preState, phases, postState) {
  const newsProgress = Math.max(0, preState.missingNewsSymbols.length - postState.missingNewsSymbols.length);
  const earningsProgress = Math.max(0, preState.missingEarningsSymbols.length - postState.missingEarningsSymbols.length);
  const completed = postState.missingNewsSymbols.length === 0 && postState.missingEarningsSymbols.length === 0;

  return {
    generated_at: new Date().toISOString(),
    cycle,
    completed,
    options: {
      min_news_items: options.minNewsItems,
      min_earnings_history: options.minEarningsHistory,
      ipo_grace_days: options.ipoGraceDays,
      upcoming_days: options.upcomingDays,
    },
    runtime,
    precheck: {
      snapshot_created_at: preState.snapshotCreatedAt,
      screener_universe_count: preState.screenerSymbols.length,
      missing_news_count: preState.missingNewsSymbols.length,
      missing_earnings_count: preState.missingEarningsSymbols.length,
      recent_ipo_exemptions: preState.recentIpoSymbols.length,
      missing_news_sample: preState.missingNewsSymbols.slice(0, 8),
      missing_earnings_sample: preState.missingEarningsSymbols.slice(0, 8),
    },
    phases,
    postcheck: {
      snapshot_created_at: postState.snapshotCreatedAt,
      screener_universe_count: postState.screenerSymbols.length,
      missing_news_count: postState.missingNewsSymbols.length,
      missing_earnings_count: postState.missingEarningsSymbols.length,
      recent_ipo_exemptions: postState.recentIpoSymbols.length,
      missing_news_sample: postState.missingNewsSymbols.slice(0, 8),
      missing_earnings_sample: postState.missingEarningsSymbols.slice(0, 8),
      news_progress: newsProgress,
      earnings_progress: earningsProgress,
    },
    progress_made: newsProgress > 0 || earningsProgress > 0,
  };
}

function createCheckpointStatusSnapshot(cycle, phase, runtime, checkpoint, fallback = {}) {
  const attemptedCount = Array.isArray(checkpoint?.news?.attempted_symbols) ? checkpoint.news.attempted_symbols.length : 0;
  const resolvedCount = Array.isArray(checkpoint?.news?.resolved_symbols) ? checkpoint.news.resolved_symbols.length : 0;
  const unresolvedCount = Array.isArray(checkpoint?.news?.unresolved_symbols) ? checkpoint.news.unresolved_symbols.length : 0;
  const baselineMissingNews = Number.isFinite(fallback.preMissingNews) ? fallback.preMissingNews : null;
  const baselineMissingEarnings = Number.isFinite(fallback.preMissingEarnings) ? fallback.preMissingEarnings : null;
  const liveMissingNews = baselineMissingNews !== null ? Math.max(0, baselineMissingNews - resolvedCount) : null;

  return {
    generated_at: new Date().toISOString(),
    cycle,
    phase,
    in_progress: true,
    completed: false,
    missing_news_count: liveMissingNews,
    missing_earnings_count: baselineMissingEarnings,
    recent_ipo_exemptions: Number.isFinite(fallback.recentIpoExemptions) ? fallback.recentIpoExemptions : null,
    attempted_news_symbols: attemptedCount,
    resolved_news_symbols: resolvedCount,
    unresolved_news_symbols: unresolvedCount,
    retry_attempted_news: runtime.retryAttemptedNews,
    news_batch_size: runtime.newsBatchSize,
    news_concurrency: runtime.newsConcurrency,
    no_progress_cycles: runtime.noProgressCycles,
    degraded: true,
    degraded_reason: fallback.reason || 'coverage_state_unavailable',
  };
}

async function maybeWriteProgressReport({ cycle, phase, options, runtime, checkpoint, force = false }) {
  const now = Date.now();
  const lastReportAt = runtime.lastHourlyReportAt ? Date.parse(runtime.lastHourlyReportAt) : 0;
  const shouldAppendHourly = force || lastReportAt <= 0 || (now - lastReportAt) >= options.reportIntervalMs;

  let payload;
  try {
    const state = await loadCoverageState(options);
    payload = {
      generated_at: new Date(now).toISOString(),
      cycle,
      phase,
      in_progress: true,
      completed: false,
      missing_news_count: state.missingNewsSymbols.length,
      missing_earnings_count: state.missingEarningsSymbols.length,
      recent_ipo_exemptions: state.recentIpoSymbols.length,
      attempted_news_symbols: checkpoint.news.attempted_symbols.length,
      resolved_news_symbols: checkpoint.news.resolved_symbols.length,
      unresolved_news_symbols: checkpoint.news.unresolved_symbols.length,
      retry_attempted_news: runtime.retryAttemptedNews,
      news_batch_size: runtime.newsBatchSize,
      news_concurrency: runtime.newsConcurrency,
      no_progress_cycles: runtime.noProgressCycles,
    };
  } catch (error) {
    console.warn('[COVERAGE_CAMPAIGN_PROGRESS_REPORT] degraded snapshot', {
      cycle,
      phase,
      error: error.message,
    });
    payload = createCheckpointStatusSnapshot(cycle, phase, runtime, checkpoint, {
      preMissingNews: checkpoint.snapshot_created_at ? undefined : undefined,
      reason: error.message,
    });

    try {
      const previousStatus = readJson(STATUS_PATH, null);
      const previousPrecheck = previousStatus?.precheck || {};
      const previousPostcheck = previousStatus?.postcheck || {};
      if (typeof previousPrecheck.missing_news_count === 'number') {
        payload.missing_news_count = Math.max(0, previousPrecheck.missing_news_count - payload.resolved_news_symbols);
      } else if (typeof previousPostcheck.missing_news_count === 'number' && typeof previousPostcheck.news_progress === 'number') {
        payload.missing_news_count = Math.max(0, (previousPostcheck.missing_news_count + previousPostcheck.news_progress) - payload.resolved_news_symbols);
      }
      if (typeof previousPrecheck.missing_earnings_count === 'number') {
        payload.missing_earnings_count = previousPrecheck.missing_earnings_count;
      } else if (typeof previousPostcheck.missing_earnings_count === 'number') {
        payload.missing_earnings_count = previousPostcheck.missing_earnings_count;
      }
      if (typeof previousPrecheck.recent_ipo_exemptions === 'number') {
        payload.recent_ipo_exemptions = previousPrecheck.recent_ipo_exemptions;
      } else if (typeof previousPostcheck.recent_ipo_exemptions === 'number') {
        payload.recent_ipo_exemptions = previousPostcheck.recent_ipo_exemptions;
      }
    } catch (_error) {
      // Best-effort degraded payload only.
    }
  }

  writeJson(STATUS_PATH, payload);
  await writeCoverageCampaignState('status', payload).catch((error) => {
    console.warn('[COVERAGE_CAMPAIGN_SHARED_STATE] status write failed', { error: error.message });
  });
  if (shouldAppendHourly) {
    appendJsonLine(HOURLY_REPORT_PATH, payload);
    await appendCoverageCampaignHourlyEntry(payload).catch((error) => {
      console.warn('[COVERAGE_CAMPAIGN_SHARED_STATE] hourly append failed', { error: error.message });
    });
    runtime.lastHourlyReportAt = payload.generated_at;
    checkpoint.supervisor.last_hourly_report_at = payload.generated_at;
  }
  await persistCheckpoint(checkpoint);
}

async function runCycle(cycle, options, runtime, checkpoint) {
  const preState = await loadCoverageState(options);
  checkpoint.snapshot_created_at = preState.snapshotCreatedAt;
  await persistCheckpoint(checkpoint);
  await maybeWriteProgressReport({
    cycle,
    phase: 'cycle_start',
    options,
    runtime,
    checkpoint,
    force: cycle === 1,
  });

  const phases = {};
  if (!options.newsOnly) {
    phases.earnings = await runEarningsPhase(preState, checkpoint, options, runtime, cycle);
  }

  const stateBeforeNews = options.newsOnly ? preState : await loadCoverageState(options);
  if (!options.earningsOnly) {
    phases.news = await runNewsPhase(stateBeforeNews, checkpoint, {
      ...options,
      retryAttemptedNews: runtime.retryAttemptedNews,
      newsBatchSize: runtime.newsBatchSize,
      newsConcurrency: runtime.newsConcurrency,
    }, runtime, cycle);
  }

  const postState = await loadCoverageState(options);
  const report = createStatusReport(cycle, options, runtime, preState, phases, postState);
  writeJson(STATUS_PATH, report);
  await writeCoverageCampaignState('status', report).catch((error) => {
    console.warn('[COVERAGE_CAMPAIGN_SHARED_STATE] final status write failed', { error: error.message });
  });

  checkpoint.news.completed = postState.missingNewsSymbols.length === 0;
  checkpoint.earnings.completed = postState.missingEarningsSymbols.length === 0;
  checkpoint.supervisor.cycles_completed = cycle;
  await persistCheckpoint(checkpoint);

  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  ensureDir(LOG_DIR);

  if (options.resetCheckpoint && fs.existsSync(CHECKPOINT_PATH)) {
    fs.unlinkSync(CHECKPOINT_PATH);
  }
  if (options.resetCheckpoint) {
    await deleteCoverageCampaignState(['status', 'checkpoint', 'hourly']).catch((error) => {
      console.warn('[COVERAGE_CAMPAIGN_SHARED_STATE] reset failed', { error: error.message });
    });
  }

  const checkpoint = readJson(CHECKPOINT_PATH, createEmptyCheckpoint());
  checkpoint.supervisor = checkpoint.supervisor || createEmptyCheckpoint().supervisor;
  checkpoint.news = checkpoint.news || createEmptyCheckpoint().news;
  checkpoint.earnings = checkpoint.earnings || createEmptyCheckpoint().earnings;

  const runtime = {
    retryAttemptedNews: Boolean(options.retryAttemptedNews || checkpoint.supervisor.retry_attempted_news),
    newsBatchSize: Math.max(1, Number(options.newsBatchSize || checkpoint.supervisor.effective_news_batch_size || DEFAULT_NEWS_BATCH_SIZE)),
    newsConcurrency: Math.max(1, Number(options.newsConcurrency || checkpoint.supervisor.effective_news_concurrency || DEFAULT_NEWS_CONCURRENCY)),
    noProgressCycles: Number(checkpoint.supervisor.no_progress_cycles || 0),
    lastHourlyReportAt: checkpoint.supervisor.last_hourly_report_at || null,
  };

  if (options.safeMode) {
    runtime.newsBatchSize = Math.min(runtime.newsBatchSize, options.newsBatchSize);
    runtime.newsConcurrency = 1;
  }

  let cycle = Number(checkpoint.supervisor.cycles_completed || 0);
  while (true) {
    cycle += 1;
    let report;
    try {
      report = await runCycle(cycle, options, runtime, checkpoint);
    } catch (error) {
      const failure = {
        generated_at: new Date().toISOString(),
        cycle,
        status: 'retrying',
        error: error.message,
        retrying: options.loop && isTransientCampaignError(error),
      };

      writeJson(STATUS_PATH, failure);
      await writeCoverageCampaignState('status', failure).catch((writeError) => {
        console.warn('[COVERAGE_CAMPAIGN_SHARED_STATE] retry status write failed', { error: writeError.message });
      });
      console.error('[COVERAGE_COMPLETION_CAMPAIGN] cycle failed', error);

      if (!options.loop || !isTransientCampaignError(error)) {
        throw error;
      }

      await sleep(Math.max(30000, Number(options.cycleSleepMs) || 0));
      continue;
    }

    const nowIso = new Date().toISOString();

    const shouldWriteHourly = !runtime.lastHourlyReportAt || (Date.now() - Date.parse(runtime.lastHourlyReportAt)) >= options.reportIntervalMs || report.completed;
    if (shouldWriteHourly) {
      appendJsonLine(HOURLY_REPORT_PATH, {
        generated_at: nowIso,
        cycle,
        missing_news_count: report.postcheck.missing_news_count,
        missing_earnings_count: report.postcheck.missing_earnings_count,
        news_progress: report.postcheck.news_progress,
        earnings_progress: report.postcheck.earnings_progress,
        retry_attempted_news: runtime.retryAttemptedNews,
        news_batch_size: runtime.newsBatchSize,
        news_concurrency: runtime.newsConcurrency,
      });
      await appendCoverageCampaignHourlyEntry({
        generated_at: nowIso,
        cycle,
        missing_news_count: report.postcheck.missing_news_count,
        missing_earnings_count: report.postcheck.missing_earnings_count,
        news_progress: report.postcheck.news_progress,
        earnings_progress: report.postcheck.earnings_progress,
        retry_attempted_news: runtime.retryAttemptedNews,
        news_batch_size: runtime.newsBatchSize,
        news_concurrency: runtime.newsConcurrency,
      }).catch((error) => {
        console.warn('[COVERAGE_CAMPAIGN_SHARED_STATE] hourly summary append failed', { error: error.message });
      });
      runtime.lastHourlyReportAt = nowIso;
    }

    if (report.progress_made) {
      runtime.noProgressCycles = 0;
    } else {
      runtime.noProgressCycles += 1;
      runtime.retryAttemptedNews = true;
      const reducedBatchSize = Math.max(1, Math.floor(runtime.newsBatchSize / 2));
      runtime.newsBatchSize = options.safeMode
        ? Math.min(options.newsBatchSize, reducedBatchSize)
        : Math.max(5, reducedBatchSize);
    }

    checkpoint.supervisor.no_progress_cycles = runtime.noProgressCycles;
    checkpoint.supervisor.retry_attempted_news = runtime.retryAttemptedNews;
    checkpoint.supervisor.effective_news_batch_size = runtime.newsBatchSize;
    checkpoint.supervisor.effective_news_concurrency = runtime.newsConcurrency;
    checkpoint.supervisor.last_hourly_report_at = runtime.lastHourlyReportAt;
    await persistCheckpoint(checkpoint);

    console.log('[COVERAGE_COMPLETION_CAMPAIGN]', JSON.stringify({
      cycle,
      completed: report.completed,
      safe_mode: options.safeMode,
      missing_news_count: report.postcheck.missing_news_count,
      missing_earnings_count: report.postcheck.missing_earnings_count,
      news_progress: report.postcheck.news_progress,
      earnings_progress: report.postcheck.earnings_progress,
      retry_attempted_news: runtime.retryAttemptedNews,
      news_batch_size: runtime.newsBatchSize,
      news_concurrency: runtime.newsConcurrency,
      no_progress_cycles: runtime.noProgressCycles,
    }, null, 2));

    if (report.completed || options.dryRun || !options.loop || (options.maxCycles && cycle >= options.maxCycles)) {
      break;
    }

    await sleep(options.cycleSleepMs);
  }
}

main().catch((error) => {
  const failure = {
    generated_at: new Date().toISOString(),
    status: 'failed',
    error: error.message,
  };
  writeJson(STATUS_PATH, failure);
  writeCoverageCampaignState('status', failure).catch((writeError) => {
    console.warn('[COVERAGE_CAMPAIGN_SHARED_STATE] failure status write failed', { error: writeError.message });
  });
  console.error('[COVERAGE_COMPLETION_CAMPAIGN] failed', error);
  process.exitCode = 1;
});