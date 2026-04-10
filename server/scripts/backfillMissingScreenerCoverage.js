#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { queryWithTimeout } = require('../db/pg');
const { runNewsIngestion } = require('../ingestion/fmp_news_ingest');
const { runNewsBackfill } = require('../v2/ingestion/newsBackfill');
const { runEarningsIngestionEngine } = require('../engines/earningsIngestionEngine');

const LOG_DIR = path.resolve(__dirname, '..', 'logs', 'backfill');
const CHECKPOINT_PATH = path.join(LOG_DIR, 'missing_screener_coverage_checkpoint.json');
const REPORT_PATH = path.join(LOG_DIR, 'missing_screener_coverage_report.json');

const DEFAULT_NEWS_BATCH_SIZE = 25;
const DEFAULT_INTER_SYMBOL_DELAY_MS = 1200;
const DEFAULT_INTER_BATCH_DELAY_MS = 15000;
const DEFAULT_UPCOMING_DAYS = 180;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    newsOnly: false,
    earningsOnly: false,
    resetCheckpoint: false,
    retryAttemptedNews: false,
    newsBatchSize: DEFAULT_NEWS_BATCH_SIZE,
    maxNewsSymbols: null,
    interSymbolDelayMs: DEFAULT_INTER_SYMBOL_DELAY_MS,
    interBatchDelayMs: DEFAULT_INTER_BATCH_DELAY_MS,
    upcomingDays: DEFAULT_UPCOMING_DAYS,
  };

  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--news-only') options.newsOnly = true;
    else if (arg === '--earnings-only') options.earningsOnly = true;
    else if (arg === '--reset-checkpoint') options.resetCheckpoint = true;
    else if (arg === '--retry-attempted-news') options.retryAttemptedNews = true;
    else if (arg.startsWith('--news-batch-size=')) options.newsBatchSize = Math.max(1, Number(arg.split('=')[1]) || DEFAULT_NEWS_BATCH_SIZE);
    else if (arg.startsWith('--max-news-symbols=')) {
      const parsed = Number(arg.split('=')[1]);
      options.maxNewsSymbols = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    } else if (arg.startsWith('--inter-symbol-delay-ms=')) {
      options.interSymbolDelayMs = Math.max(0, Number(arg.split('=')[1]) || DEFAULT_INTER_SYMBOL_DELAY_MS);
    } else if (arg.startsWith('--inter-batch-delay-ms=')) {
      options.interBatchDelayMs = Math.max(0, Number(arg.split('=')[1]) || DEFAULT_INTER_BATCH_DELAY_MS);
    } else if (arg.startsWith('--upcoming-days=')) {
      options.upcomingDays = Math.max(1, Number(arg.split('=')[1]) || DEFAULT_UPCOMING_DAYS);
    }
  }

  if (options.newsOnly) options.earningsOnly = false;
  if (options.earningsOnly) options.newsOnly = false;

  return options;
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

function createEmptyCheckpoint() {
  return {
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    snapshot_created_at: null,
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

function dedupeSorted(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort();
}

async function loadCoverageState() {
  const result = await queryWithTimeout(
    `WITH latest_snapshot AS (
       SELECT id, created_at, data
       FROM screener_snapshots
       ORDER BY created_at DESC
       LIMIT 1
     ), screener_symbols AS (
       SELECT DISTINCT UPPER(BTRIM(item->>'symbol')) AS symbol
       FROM latest_snapshot
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(data->'screener'->'data', '[]'::jsonb)) AS item
       WHERE NULLIF(BTRIM(item->>'symbol'), '') IS NOT NULL
     ), earnings_symbols AS (
       SELECT DISTINCT UPPER(BTRIM(symbol)) AS symbol
       FROM earnings_events
       WHERE NULLIF(BTRIM(symbol), '') IS NOT NULL
         AND report_date IS NOT NULL
     ), news_symbols AS (
       SELECT DISTINCT UPPER(BTRIM(symbol)) AS symbol
       FROM news_articles
       WHERE NULLIF(BTRIM(symbol), '') IS NOT NULL
     )
     SELECT
       (SELECT created_at FROM latest_snapshot) AS snapshot_created_at,
       ARRAY(SELECT symbol FROM screener_symbols ORDER BY symbol) AS screener_symbols,
       ARRAY(
         SELECT s.symbol
         FROM screener_symbols s
         LEFT JOIN earnings_symbols e ON e.symbol = s.symbol
         WHERE e.symbol IS NULL
         ORDER BY s.symbol
       ) AS missing_earnings_symbols,
       ARRAY(
         SELECT s.symbol
         FROM screener_symbols s
         LEFT JOIN news_symbols n ON n.symbol = s.symbol
         WHERE n.symbol IS NULL
         ORDER BY s.symbol
       ) AS missing_news_symbols`,
    [],
    {
      timeoutMs: 30000,
      label: 'backfill.coverage.load_state',
      maxRetries: 1,
      retryDelayMs: 250,
    }
  );

  const row = result.rows?.[0] || {};
  return {
    snapshotCreatedAt: row.snapshot_created_at || null,
    screenerSymbols: dedupeSorted(row.screener_symbols || []),
    missingEarningsSymbols: dedupeSorted(row.missing_earnings_symbols || []),
    missingNewsSymbols: dedupeSorted(row.missing_news_symbols || []),
  };
}

async function hasDirectNews(symbol) {
  const result = await queryWithTimeout(
    `SELECT EXISTS(
       SELECT 1
       FROM news_articles
       WHERE UPPER(BTRIM(symbol)) = $1
     ) AS has_news`,
    [symbol],
    {
      timeoutMs: 5000,
      label: 'backfill.coverage.has_direct_news',
      maxRetries: 0,
    }
  );
  return Boolean(result.rows?.[0]?.has_news);
}

async function persistCheckpoint(checkpoint) {
  checkpoint.updated_at = new Date().toISOString();
  checkpoint.news.attempted_symbols = dedupeSorted(checkpoint.news.attempted_symbols);
  checkpoint.news.resolved_symbols = dedupeSorted(checkpoint.news.resolved_symbols);
  checkpoint.news.unresolved_symbols = dedupeSorted(checkpoint.news.unresolved_symbols);
  writeJson(CHECKPOINT_PATH, checkpoint);
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function runNewsPhase(state, checkpoint, options) {
  const attemptedSet = new Set(checkpoint.news.attempted_symbols || []);
  const pendingSymbols = state.missingNewsSymbols.filter((symbol) => options.retryAttemptedNews || !attemptedSet.has(symbol));
  const targetSymbols = options.maxNewsSymbols ? pendingSymbols.slice(0, options.maxNewsSymbols) : pendingSymbols;

  const summary = {
    starting_missing_news: state.missingNewsSymbols.length,
    pending_news_symbols: pendingSymbols.length,
    targeted_news_symbols: targetSymbols.length,
    batch_size: options.newsBatchSize,
    inter_symbol_delay_ms: options.interSymbolDelayMs,
    inter_batch_delay_ms: options.interBatchDelayMs,
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
      inserted_primary: 0,
      deduped_primary: 0,
      inserted_secondary: 0,
      duplicates_secondary: 0,
      errors: 0,
      resolved_symbols: [],
      unresolved_symbols: [],
      started_at: new Date().toISOString(),
    };

    for (let symbolIndex = 0; symbolIndex < batch.length; symbolIndex += 1) {
      const symbol = batch[symbolIndex];
      let primarySummary = null;
      let secondarySummary = null;

      try {
        primarySummary = await runNewsIngestion([symbol]);
        batchSummary.inserted_primary += Number(primarySummary?.inserted || 0);
        batchSummary.deduped_primary += Number(primarySummary?.deduped || 0);
      } catch (error) {
        batchSummary.errors += 1;
        console.warn('[BACKFILL_NEWS] primary ingestion failed', { symbol, error: error.message });
      }

      let resolved = await hasDirectNews(symbol);
      if (!resolved) {
        try {
          secondarySummary = await runNewsBackfill({ symbols: [symbol] });
          batchSummary.inserted_secondary += Number(secondarySummary?.inserted || 0);
          batchSummary.duplicates_secondary += Number(secondarySummary?.duplicates || 0);
        } catch (error) {
          batchSummary.errors += 1;
          console.warn('[BACKFILL_NEWS] secondary backfill failed', { symbol, error: error.message });
        }
        resolved = await hasDirectNews(symbol);
      }

      checkpoint.news.attempted_symbols.push(symbol);
      if (resolved) {
        checkpoint.news.resolved_symbols.push(symbol);
        checkpoint.news.unresolved_symbols = (checkpoint.news.unresolved_symbols || []).filter((value) => value !== symbol);
        batchSummary.resolved_symbols.push(symbol);
      } else {
        checkpoint.news.unresolved_symbols.push(symbol);
        batchSummary.unresolved_symbols.push(symbol);
      }

      await persistCheckpoint(checkpoint);

      console.log('[BACKFILL_NEWS]', {
        symbol,
        resolved,
        primary_inserted: Number(primarySummary?.inserted || 0),
        primary_deduped: Number(primarySummary?.deduped || 0),
        secondary_inserted: Number(secondarySummary?.inserted || 0),
        secondary_duplicates: Number(secondarySummary?.duplicates || 0),
      });

      const isLastSymbol = symbolIndex === batch.length - 1;
      if (!isLastSymbol && options.interSymbolDelayMs > 0) {
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

  checkpoint.news.completed = targetSymbols.length === pendingSymbols.length;
  await persistCheckpoint(checkpoint);
  return summary;
}

async function runEarningsPhase(state, checkpoint, options) {
  const summary = {
    starting_missing_earnings: state.missingEarningsSymbols.length,
    targeted_earnings_symbols: state.missingEarningsSymbols.length,
    upcoming_days: options.upcomingDays,
    engine_summary: null,
  };

  if (options.dryRun || state.missingEarningsSymbols.length === 0) {
    return summary;
  }

  const engineSummary = await runEarningsIngestionEngine({
    symbols: state.missingEarningsSymbols,
    upcomingDays: options.upcomingDays,
  });

  checkpoint.earnings.completed = true;
  checkpoint.earnings.summary = engineSummary;
  await persistCheckpoint(checkpoint);

  summary.engine_summary = engineSummary;
  return summary;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  ensureDir(LOG_DIR);

  if (options.resetCheckpoint && fs.existsSync(CHECKPOINT_PATH)) {
    fs.unlinkSync(CHECKPOINT_PATH);
  }

  const checkpoint = readJson(CHECKPOINT_PATH, createEmptyCheckpoint());
  const preState = await loadCoverageState();
  checkpoint.snapshot_created_at = preState.snapshotCreatedAt;
  await persistCheckpoint(checkpoint);

  const report = {
    generated_at: new Date().toISOString(),
    options,
    precheck: {
      snapshot_created_at: preState.snapshotCreatedAt,
      screener_universe_count: preState.screenerSymbols.length,
      missing_news_count: preState.missingNewsSymbols.length,
      missing_earnings_count: preState.missingEarningsSymbols.length,
      missing_news_sample: preState.missingNewsSymbols.slice(0, 8),
      missing_earnings_sample: preState.missingEarningsSymbols.slice(0, 8),
    },
    phases: {},
    postcheck: null,
    status: 'pending',
  };

  if (!options.earningsOnly) {
    report.phases.news = await runNewsPhase(preState, checkpoint, options);
  }

  const stateBeforeEarnings = options.earningsOnly ? preState : await loadCoverageState();
  if (!options.newsOnly) {
    report.phases.earnings = await runEarningsPhase(stateBeforeEarnings, checkpoint, options);
  }

  const postState = await loadCoverageState();
  report.postcheck = {
    snapshot_created_at: postState.snapshotCreatedAt,
    screener_universe_count: postState.screenerSymbols.length,
    missing_news_count: postState.missingNewsSymbols.length,
    missing_earnings_count: postState.missingEarningsSymbols.length,
    missing_news_sample: postState.missingNewsSymbols.slice(0, 8),
    missing_earnings_sample: postState.missingEarningsSymbols.slice(0, 8),
    news_backfilled: Math.max(0, preState.missingNewsSymbols.length - postState.missingNewsSymbols.length),
    earnings_backfilled: Math.max(0, preState.missingEarningsSymbols.length - postState.missingEarningsSymbols.length),
  };

  report.status = options.dryRun ? 'dry_run' : 'completed';
  writeJson(REPORT_PATH, report);

  console.log('[BACKFILL_MISSING_SCREENER_COVERAGE]', JSON.stringify(report, null, 2));
}

main().catch((error) => {
  const failure = {
    generated_at: new Date().toISOString(),
    status: 'failed',
    error: error.message,
  };
  writeJson(REPORT_PATH, failure);
  console.error('[BACKFILL_MISSING_SCREENER_COVERAGE] failed', error);
  process.exitCode = 1;
});