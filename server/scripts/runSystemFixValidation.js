const fs = require('fs/promises');
const path = require('path');
const dotenv = require('dotenv');

const envPath = path.resolve(__dirname, '..', '.env');
dotenv.config({ path: envPath });

const { queryWithTimeout } = require('../db/pg');
const { backfillTechnicalIndicators } = require('../engines/indicatorEngine');
const { runEarningsIngestionEngine } = require('../engines/earningsIngestionEngine');

const OUTPUT_PATH = path.resolve(__dirname, '..', '..', 'SYSTEM_FIX_REPORT.json');
const CHART_PORT_CANDIDATES = [3001, 3007];
const MAX_SERIES_JUMP_RATIO = 3;
const MIN_SERIES_JUMP_RATIO = 1 / MAX_SERIES_JUMP_RATIO;
const CHART_SAMPLE_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'SPY'];

function countSpikes(rows, key = 'close') {
  const data = Array.isArray(rows) ? rows : [];
  let spikes = 0;
  let previous = null;

  for (const row of data) {
    const value = Number(row?.[key]);
    if (!Number.isFinite(value) || value <= 0) {
      continue;
    }

    if (Number.isFinite(previous) && previous > 0) {
      const ratio = value / previous;
      if (ratio > MAX_SERIES_JUMP_RATIO || ratio < MIN_SERIES_JUMP_RATIO) {
        spikes += 1;
      }
    }

    previous = value;
  }

  return spikes;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function validateChartSamples() {
  const validations = [];
  let workingPort = null;

  for (const port of CHART_PORT_CANDIDATES) {
    try {
      await fetchJson(`http://127.0.0.1:${port}/api/v5/chart?symbol=AAPL&interval=1day`);
      workingPort = port;
      break;
    } catch (_error) {
    }
  }

  if (!workingPort) {
    return {
      ok: false,
      checked: 0,
      port: null,
      reason: 'chart_endpoint_unreachable',
      samples: [],
    };
  }

  for (const symbol of CHART_SAMPLE_SYMBOLS) {
    try {
      const payload = await fetchJson(`http://127.0.0.1:${workingPort}/api/v5/chart?symbol=${encodeURIComponent(symbol)}&interval=1day`);
      const candleSpikes = countSpikes(payload?.candles, 'close');
      const ema9Spikes = countSpikes(payload?.indicators?.ema9, 'value');
      const ema20Spikes = countSpikes(payload?.indicators?.ema20, 'value');
      const vwapSpikes = countSpikes(payload?.indicators?.vwap, 'value');

      validations.push({
        symbol,
        candles: Array.isArray(payload?.candles) ? payload.candles.length : 0,
        candle_spikes: candleSpikes,
        ema9_spikes: ema9Spikes,
        ema20_spikes: ema20Spikes,
        vwap_spikes: vwapSpikes,
        ok: candleSpikes === 0 && ema9Spikes === 0 && ema20Spikes === 0 && vwapSpikes === 0,
      });
    } catch (error) {
      validations.push({
        symbol,
        ok: false,
        error: error.message,
      });
    }
  }

  return {
    ok: validations.every((item) => item.ok),
    checked: validations.length,
    port: workingPort,
    samples: validations,
  };
}

async function getUniverseCounts() {
  const result = await queryWithTimeout(
    `SELECT COUNT(DISTINCT UPPER(symbol))::int AS total_symbols
     FROM ticker_universe
     WHERE symbol IS NOT NULL
       AND NULLIF(BTRIM(symbol), '') IS NOT NULL`,
    [],
    { timeoutMs: 15000, label: 'system_fix.universe', maxRetries: 0 }
  );

  return Number(result.rows?.[0]?.total_symbols || 0);
}

async function getNewsValidation() {
  const result = await queryWithTimeout(
    `WITH symbol_news AS (
       SELECT UPPER(symbol) AS symbol, COUNT(*)::int AS article_count
       FROM news_articles
       WHERE symbol IS NOT NULL
         AND NULLIF(BTRIM(symbol), '') IS NOT NULL
       GROUP BY UPPER(symbol)
     ), duplicate_rows AS (
       SELECT COUNT(*)::int AS duplicate_groups
       FROM (
         SELECT UPPER(symbol) AS symbol, published_at, COALESCE(headline, title) AS headline
         FROM news_articles
         WHERE symbol IS NOT NULL
           AND NULLIF(BTRIM(symbol), '') IS NOT NULL
         GROUP BY UPPER(symbol), published_at, COALESCE(headline, title)
         HAVING COUNT(*) > 1
       ) duplicates
     )
     SELECT
       COUNT(*) FILTER (WHERE article_count >= 5)::int AS symbols_with_5_plus_articles,
       COUNT(*) FILTER (WHERE article_count > 0)::int AS symbols_with_any_articles,
       COALESCE((SELECT duplicate_groups FROM duplicate_rows), 0)::int AS duplicate_groups
     FROM symbol_news`,
    [],
    { timeoutMs: 15000, label: 'system_fix.news_validation', maxRetries: 0 }
  );

  return result.rows?.[0] || {};
}

async function dedupeNewsArticles() {
  const result = await queryWithTimeout(
    `WITH ranked AS (
       SELECT
         ctid,
         ROW_NUMBER() OVER (
           PARTITION BY UPPER(symbol), published_at, COALESCE(headline, title)
           ORDER BY created_at DESC NULLS LAST, id DESC NULLS LAST
         ) AS row_rank
       FROM news_articles
       WHERE symbol IS NOT NULL
         AND NULLIF(BTRIM(symbol), '') IS NOT NULL
         AND published_at IS NOT NULL
         AND NULLIF(BTRIM(COALESCE(headline, title)), '') IS NOT NULL
     )
     DELETE FROM news_articles target
     USING ranked
     WHERE target.ctid = ranked.ctid
       AND ranked.row_rank > 1
     RETURNING 1`,
    [],
    {
      timeoutMs: 30000,
      label: 'system_fix.news_dedupe',
      maxRetries: 0,
      poolType: 'write',
    }
  );

  return {
    deleted_rows: Number(result.rowCount || 0),
  };
}

async function getTechnicalValidation() {
  const result = await queryWithTimeout(
    `WITH eligible AS (
       SELECT symbol
       FROM daily_ohlc
       GROUP BY symbol
       HAVING COUNT(*) >= 200
     )
     SELECT
       (SELECT COUNT(*)::int FROM eligible) AS eligible_symbols,
       (SELECT COUNT(*)::int FROM technical_indicators) AS persisted_symbols,
       (SELECT COUNT(*)::int FROM technical_indicators WHERE ema200 IS NOT NULL AND rsi14 IS NOT NULL) AS fully_populated_symbols`,
    [],
    { timeoutMs: 15000, label: 'system_fix.technical_validation', maxRetries: 0 }
  );

  return result.rows?.[0] || {};
}

async function getEarningsValidation() {
  const result = await queryWithTimeout(
    `WITH history AS (
       SELECT symbol, COUNT(*)::int AS history_count
       FROM earnings_history
       GROUP BY symbol
     )
     SELECT
       COUNT(*) FILTER (WHERE history_count >= 8)::int AS symbols_with_8_plus_history,
       COUNT(*) FILTER (WHERE history_count > 0 AND history_count < 8)::int AS symbols_with_partial_history,
       COUNT(*)::int AS symbols_with_any_history,
       COALESCE((SELECT COUNT(*)::int FROM earnings_history), 0)::int AS total_history_rows
     FROM history`,
    [],
    { timeoutMs: 15000, label: 'system_fix.earnings_validation', maxRetries: 0 }
  );

  return result.rows?.[0] || {};
}

async function main() {
  const startedAt = Date.now();
  const totalUniverseSymbols = await getUniverseCounts();

  const technicalBackfill = await backfillTechnicalIndicators({ batchSize: 25 });
  const earningsBackfill = await runEarningsIngestionEngine({ symbolLimit: 10000 });
  const newsDedupe = await dedupeNewsArticles();

  const [newsValidation, technicalValidation, earningsValidation, chartValidation] = await Promise.all([
    getNewsValidation(),
    getTechnicalValidation(),
    getEarningsValidation(),
    validateChartSamples(),
  ]);

  const report = {
    generated_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    universe: {
      total_symbols: totalUniverseSymbols,
    },
    actions: {
      news_dedupe: newsDedupe,
      technical_backfill: technicalBackfill,
      earnings_backfill: earningsBackfill,
    },
    validation: {
      news: {
        symbols_with_any_articles: Number(newsValidation.symbols_with_any_articles || 0),
        symbols_with_5_plus_articles: Number(newsValidation.symbols_with_5_plus_articles || 0),
        duplicate_groups: Number(newsValidation.duplicate_groups || 0),
      },
      technical_indicators: {
        eligible_symbols: Number(technicalValidation.eligible_symbols || 0),
        persisted_symbols: Number(technicalValidation.persisted_symbols || 0),
        fully_populated_symbols: Number(technicalValidation.fully_populated_symbols || 0),
      },
      earnings_history: {
        symbols_with_any_history: Number(earningsValidation.symbols_with_any_history || 0),
        symbols_with_8_plus_history: Number(earningsValidation.symbols_with_8_plus_history || 0),
        symbols_with_partial_history: Number(earningsValidation.symbols_with_partial_history || 0),
        total_history_rows: Number(earningsValidation.total_history_rows || 0),
      },
      chart_samples: chartValidation,
    },
  };

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch(async (error) => {
  const fallback = {
    generated_at: new Date().toISOString(),
    success: false,
    error: error.message,
  };

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(fallback, null, 2));
  console.error(error);
  process.exitCode = 1;
});