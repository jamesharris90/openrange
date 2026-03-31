'use strict';

/**
 * Data Orchestrator
 *
 * Central control layer for all ingestion. Runs every 60 seconds and
 * coordinates quotes, intraday, daily OHLC, and news ingestion.
 *
 * Calls ingestion functions directly (not HTTP self-calls) for reliability.
 * Each sub-job has a minimum run interval to avoid hammering external APIs.
 */

let orchestratorInFlight = false;
let runCount = 0;

const lastRun = {
  quotes:   0,
  intraday: 0,
  daily:    0,
  news:     0,
};

// Minimum intervals between runs for each job
const MIN_INTERVAL = {
  quotes:   0,             // run every orchestrator cycle (60s)
  intraday: 0,             // run every orchestrator cycle (already idempotent via ON CONFLICT)
  daily:    60 * 60 * 1000, // at most once per hour — daily data does not change faster
  news:     10 * 60 * 1000, // at most once per 10 minutes
};

async function runQuotes() {
  try {
    const { ingestMarketQuotesRefresh } = require('../engines/fmpMarketIngestion');
    const result = await ingestMarketQuotesRefresh();
    const rows = Number(result?.rowsInserted || 0);
    console.log('[ORCHESTRATOR] quotes refreshed, rows inserted:', rows);
    return rows;
  } catch (err) {
    console.error('[ORCHESTRATOR] quotes refresh failed:', err.message);
    return 0;
  }
}

async function runIntraday() {
  try {
    const { runIntradayIngestion } = require('../ingestion/fmp_intraday_ingest');
    const result = await runIntradayIngestion();
    const rows = Number(result?.inserted || 0);
    console.log('[ORCHESTRATOR] intraday ingested, rows inserted:', rows);
    return rows;
  } catch (err) {
    console.error('[ORCHESTRATOR] intraday ingestion failed:', err.message);
    return 0;
  }
}

async function runDaily() {
  try {
    const { runPricesIngestion } = require('../ingestion/fmp_prices_ingest');
    const result = await runPricesIngestion();
    const rows = Number(result?.inserted || 0);
    console.log('[DAILY INGEST] rows inserted:', rows);
    return rows;
  } catch (err) {
    console.error('[ORCHESTRATOR] daily prices ingestion failed:', err.message);
    return 0;
  }
}

async function runNews() {
  try {
    const { runNewsIngestion } = require('../ingestion/fmp_news_ingest');
    const result = await runNewsIngestion();
    const rows = Number(result?.inserted || result?.count || 0);
    console.log('[ORCHESTRATOR] news ingested, rows inserted:', rows);
    return rows;
  } catch (err) {
    console.error('[ORCHESTRATOR] news ingestion failed:', err.message);
    return 0;
  }
}

async function runDataOrchestrator() {
  if (orchestratorInFlight) {
    console.log('[ORCHESTRATOR] previous run still in flight — skipping');
    return;
  }

  orchestratorInFlight = true;
  runCount += 1;
  const startedAt = Date.now();
  console.log('[ORCHESTRATOR] Running full data sync', { run: runCount });

  const now = Date.now();
  const results = {};

  try {
    // Quotes — every cycle
    if (now - lastRun.quotes >= MIN_INTERVAL.quotes) {
      lastRun.quotes = now;
      results.quotes = await runQuotes();
    }

    // Intraday — every cycle (ON CONFLICT DO NOTHING makes it safe)
    if (now - lastRun.intraday >= MIN_INTERVAL.intraday) {
      lastRun.intraday = now;
      results.intraday = await runIntraday();
    }

    // Daily OHLC — at most once per hour
    if (now - lastRun.daily >= MIN_INTERVAL.daily) {
      lastRun.daily = now;
      results.daily = await runDaily();
    }

    // News — at most once per 10 minutes
    if (now - lastRun.news >= MIN_INTERVAL.news) {
      lastRun.news = now;
      results.news = await runNews();
    }

    const elapsed = Date.now() - startedAt;
    console.log('[ORCHESTRATOR] Complete', { elapsedMs: elapsed, ...results });
  } catch (err) {
    console.error('[ORCHESTRATOR ERROR]', err.message);
  } finally {
    orchestratorInFlight = false;
  }
}

function getOrchestratorState() {
  return {
    runCount,
    inFlight: orchestratorInFlight,
    lastRun: {
      quotes:   lastRun.quotes   ? new Date(lastRun.quotes).toISOString()   : null,
      intraday: lastRun.intraday ? new Date(lastRun.intraday).toISOString() : null,
      daily:    lastRun.daily    ? new Date(lastRun.daily).toISOString()    : null,
      news:     lastRun.news     ? new Date(lastRun.news).toISOString()     : null,
    },
  };
}

module.exports = { runDataOrchestrator, getOrchestratorState };
