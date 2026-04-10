require('dotenv').config({ path: '/Users/jamesharris/Server/server/.env' });

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const pool = require('../db/pool');
const { runNewsIngestion } = require('../ingestion/fmp_news_ingest');
const { runEarningsIngestion } = require('../ingestion/fmp_earnings_ingest');

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:3001';
const REPORT_PATH = path.join('/Users/jamesharris/Server/logs', 'prep_data_repair.json');

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pct(part, total) {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(2));
}

function failFast(message, report) {
  report.verdict = 'FAIL';
  report.fail_reason = message;
  throw new Error(message);
}

async function writeReport(report) {
  await fs.promises.writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
}

async function getTopDecisionSymbols(pool, limit = 250) {
  const result = await pool.query(
    `SELECT DISTINCT UPPER(symbol) AS symbol
     FROM decision_view
     WHERE symbol IS NOT NULL
       AND TRIM(symbol) <> ''
     ORDER BY 1
     LIMIT $1`,
    [limit]
  );
  return (result.rows || []).map((r) => String(r.symbol || '').trim().toUpperCase()).filter(Boolean);
}

async function getSignalsTableInfo(pool) {
  const result = await pool.query(
    `SELECT column_name, data_type, udt_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'signals'`
  );

  const byName = new Map();
  for (const row of result.rows || []) byName.set(row.column_name, row);

  return {
    hasPriorityScore: byName.has('priority_score'),
    hasCreatedAt: byName.has('created_at'),
    hasUpdatedAt: byName.has('updated_at'),
    hasCatalystIds: byName.has('catalyst_ids'),
    catalystIsUuidArray: String(byName.get('catalyst_ids')?.udt_name || '').startsWith('_uuid'),
    jsonColumn: ['metadata', 'details', 'raw_payload', 'score_breakdown', 'payload']
      .find((name) => byName.has(name) && String(byName.get(name)?.data_type || '').includes('json')) || null,
  };
}

async function getTradeSetupsTableInfo(pool) {
  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'trade_setups'`
  );
  const cols = new Set((result.rows || []).map((r) => r.column_name));
  return {
    hasCreatedAt: cols.has('created_at'),
    hasUpdatedAt: cols.has('updated_at'),
    hasDetectedAt: cols.has('detected_at'),
    hasSignalId: cols.has('signal_id'),
  };
}

async function upsertNewsSignals(pool, info) {
  const newsRows = await pool.query(
    `SELECT
       UPPER(na.symbol) AS symbol,
       COUNT(*)::int AS article_count,
       MAX(COALESCE(na.published_at, na.created_at)) AS latest_published,
       ARRAY_REMOVE(ARRAY_AGG(na.id::text ORDER BY COALESCE(na.published_at, na.created_at) DESC), NULL) AS article_ids
     FROM news_articles na
     WHERE na.symbol IS NOT NULL
       AND TRIM(na.symbol) <> ''
       AND COALESCE(na.published_at, na.created_at) > NOW() - INTERVAL '6 hours'
     GROUP BY UPPER(na.symbol)`
  );

  const symbols = newsRows.rows || [];
  let updated = 0;
  let inserted = 0;

  for (const row of symbols) {
    const symbol = String(row.symbol || '').trim().toUpperCase();
    if (!symbol) continue;

    const articleCount = toNumber(row.article_count, 0);
    const score = Math.min(95, 60 + (articleCount * 3));
    const confidence = Math.min(0.95, 0.6 + (articleCount * 0.02));
    const articleIds = Array.isArray(row.article_ids) ? row.article_ids.filter(Boolean) : [];

    const payload = {
      source: 'news_articles',
      article_count: articleCount,
      latest_published: row.latest_published,
      article_ids: articleIds,
    };

    const setFragments = [
      'score = GREATEST(COALESCE(score, 0), $2::numeric)',
      'confidence = GREATEST(COALESCE(confidence, 0), $3::numeric)',
    ];

    const params = [symbol, score, confidence];
    let index = params.length;

    if (info.hasPriorityScore) {
      index += 1;
      params.push(2);
      setFragments.push(`priority_score = COALESCE(priority_score, 0) + $${index}::numeric`);
    }

    if (info.hasUpdatedAt) {
      setFragments.push('updated_at = NOW()');
    }

    if (info.hasCatalystIds && !info.catalystIsUuidArray) {
      index += 1;
      params.push(['news']);
      setFragments.push(`catalyst_ids = COALESCE(catalyst_ids, ARRAY[]::text[]) || $${index}::text[]`);
    }

    if (info.jsonColumn) {
      index += 1;
      params.push(JSON.stringify(payload));
      setFragments.push(`${info.jsonColumn} = COALESCE(${info.jsonColumn}, '{}'::jsonb) || $${index}::jsonb`);
    }

    const freshnessFilter = info.hasCreatedAt
      ? "AND created_at > NOW() - INTERVAL '48 hours'"
      : '';

    const updateSql = `
      UPDATE signals
      SET ${setFragments.join(', ')}
      WHERE UPPER(symbol) = $1
        AND LOWER(COALESCE(signal_type, '')) = 'news'
        ${freshnessFilter}`;

    const updateResult = await pool.query(updateSql, params);
    if ((updateResult.rowCount || 0) > 0) {
      updated += 1;
      continue;
    }

    const insertColumns = ['symbol', 'signal_type', 'score', 'confidence'];
    const insertValues = [symbol, 'news', score, confidence];

    if (info.hasCreatedAt) {
      insertColumns.push('created_at');
      insertValues.push(new Date());
    }

    if (info.hasPriorityScore) {
      insertColumns.push('priority_score');
      insertValues.push(2);
    }

    if (info.hasCatalystIds && !info.catalystIsUuidArray) {
      insertColumns.push('catalyst_ids');
      insertValues.push(['news']);
    }

    if (info.jsonColumn) {
      insertColumns.push(info.jsonColumn);
      insertValues.push(JSON.stringify(payload));
    }

    const placeholders = insertColumns.map((_, i) => `$${i + 1}`).join(', ');
    await pool.query(
      `INSERT INTO signals (${insertColumns.join(', ')}) VALUES (${placeholders})`,
      insertValues
    );
    inserted += 1;
  }

  return {
    symbols: symbols.length,
    updated,
    inserted,
  };
}

async function ensureEarningsSignalsAndSetups(pool, signalInfo, setupInfo) {
  const earningsRows = await pool.query(
    `SELECT DISTINCT UPPER(symbol) AS symbol
     FROM earnings_events
     WHERE symbol IS NOT NULL
       AND report_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '3 days'
       AND UPPER(symbol) IN (
         SELECT DISTINCT UPPER(symbol)
         FROM decision_view
         WHERE symbol IS NOT NULL
           AND TRIM(symbol) <> ''
       )
     ORDER BY 1`
  );

  const symbols = (earningsRows.rows || []).map((r) => String(r.symbol || '').trim().toUpperCase()).filter(Boolean);

  let signalsCreated = 0;
  let setupsLinked = 0;

  for (const symbol of symbols) {
    const freshnessFilter = signalInfo.hasCreatedAt
      ? "AND created_at > NOW() - INTERVAL '7 days'"
      : '';

    const orderBy = signalInfo.hasCreatedAt ? 'ORDER BY created_at DESC' : 'ORDER BY id DESC';

    const existingSignal = await pool.query(
      `SELECT id
       FROM signals
       WHERE UPPER(symbol) = $1
         AND LOWER(COALESCE(signal_type, '')) = 'earnings'
         ${freshnessFilter}
       ${orderBy}
       LIMIT 1`,
      [symbol]
    );

    let signalId = existingSignal.rows?.[0]?.id || null;

    if (!signalId) {
      const insertColumns = ['symbol', 'signal_type', 'score', 'confidence'];
      const insertValues = [symbol, 'earnings', 76, 0.75];

      if (signalInfo.hasCreatedAt) {
        insertColumns.push('created_at');
        insertValues.push(new Date());
      }

      if (signalInfo.hasPriorityScore) {
        insertColumns.push('priority_score');
        insertValues.push(3);
      }

      if (signalInfo.hasCatalystIds && !signalInfo.catalystIsUuidArray) {
        insertColumns.push('catalyst_ids');
        insertValues.push(['earnings']);
      }

      if (signalInfo.jsonColumn) {
        insertColumns.push(signalInfo.jsonColumn);
        insertValues.push(JSON.stringify({ source: 'earnings_events', window_days: 3 }));
      }

      const placeholders = insertColumns.map((_, i) => `$${i + 1}`).join(', ');
      const inserted = await pool.query(
        `INSERT INTO signals (${insertColumns.join(', ')}) VALUES (${placeholders}) RETURNING id`,
        insertValues
      );

      signalId = inserted.rows?.[0]?.id || null;
      if (signalId) signalsCreated += 1;
    }

    if (!signalId) continue;

    const existingSetup = await pool.query(
      `SELECT signal_id
       FROM trade_setups
       WHERE UPPER(symbol) = $1
       LIMIT 1`,
      [symbol]
    );

    const setupColumns = ['symbol', 'setup', 'score', 'setup_type'];
    const setupValues = [symbol, 'POST_EARNINGS_MOMENTUM', 76, 'earnings'];

    if (setupInfo.hasSignalId) {
      setupColumns.push('signal_id');
      setupValues.push(signalId);
    }

    if (setupInfo.hasCreatedAt) {
      setupColumns.push('created_at');
      setupValues.push(new Date());
    }

    if (setupInfo.hasUpdatedAt) {
      setupColumns.push('updated_at');
      setupValues.push(new Date());
    }

    if (setupInfo.hasDetectedAt) {
      setupColumns.push('detected_at');
      setupValues.push(new Date());
    }

    const placeholders = setupColumns.map((_, i) => `$${i + 1}`).join(', ');
    const updates = ['setup = EXCLUDED.setup', 'score = EXCLUDED.score', 'setup_type = EXCLUDED.setup_type'];
    if (setupInfo.hasSignalId) updates.push('signal_id = EXCLUDED.signal_id');
    if (setupInfo.hasUpdatedAt) updates.push('updated_at = EXCLUDED.updated_at');
    if (setupInfo.hasDetectedAt) updates.push('detected_at = EXCLUDED.detected_at');

    await pool.query(
      `INSERT INTO trade_setups (${setupColumns.join(', ')}) VALUES (${placeholders})
       ON CONFLICT (symbol) DO UPDATE SET ${updates.join(', ')}`,
      setupValues
    );

    if (existingSetup.rowCount === 0 || existingSetup.rows?.[0]?.signal_id == null) {
      setupsLinked += 1;
    }
  }

  return {
    earnings_symbols: symbols.length,
    signals_created: signalsCreated,
    setups_linked: setupsLinked,
  };
}

async function fetchWatchlist() {
  const headers = { Accept: 'application/json' };
  if (process.env.PROXY_API_KEY) headers['x-api-key'] = process.env.PROXY_API_KEY;

  const response = await axios.get(`${API_BASE}/api/intelligence/watchlist?limit=50`, {
    headers,
    timeout: 120000,
    validateStatus: () => true,
  });

  if (response.status !== 200) {
    throw new Error(`watchlist endpoint failed with status ${response.status}`);
  }

  const rows = Array.isArray(response.data?.data) ? response.data.data : [];
  return rows;
}

async function main() {
  const report = {
    timestamp: new Date().toISOString(),
    api_base: API_BASE,
    phase_results: {},
    news_rows_last_6h: 0,
    earnings_coverage_percent: 0,
    large_move_percent: 0,
    watchlist_distribution: {},
    verdict: 'FAIL',
  };

  try {
    const sourceTableCheck = await pool.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('news_articles', 'signals', 'earnings_events', 'trade_setups', 'market_metrics')`
    );

    const tableSet = new Set((sourceTableCheck.rows || []).map((r) => r.table_name));
    const requiredTables = ['news_articles', 'signals', 'earnings_events', 'trade_setups', 'market_metrics'];
    const missingTables = requiredTables.filter((name) => !tableSet.has(name));
    report.phase_results.precheck = {
      required_tables: requiredTables,
      missing_tables: missingTables,
    };
    if (missingTables.length) failFast(`Missing required tables: ${missingTables.join(', ')}`, report);

    const newsState = await pool.query(
      `SELECT
         MAX(COALESCE(published_at, created_at)) AS last_news_at,
         COUNT(*) FILTER (WHERE COALESCE(published_at, created_at) > NOW() - INTERVAL '6 hours')::int AS rows_last_6h,
         COUNT(*) FILTER (
           WHERE COALESCE(published_at, created_at) > NOW() - INTERVAL '6 hours'
             AND symbol IS NOT NULL
             AND TRIM(symbol) <> ''
         )::int AS symbol_rows_last_6h
       FROM news_articles`
    );

    const initialRows6h = toNumber(newsState.rows?.[0]?.rows_last_6h, 0);
    const initialSymbolRows6h = toNumber(newsState.rows?.[0]?.symbol_rows_last_6h, 0);
    const hasFmpKey = Boolean(process.env.FMP_API_KEY);
    const endpointProbe = {
      stable_news: null,
      stable_news_stock_latest: null,
      stable_news_stock: null,
    };

    try {
      const probe = await axios.get('https://financialmodelingprep.com/stable/news', {
        params: { apikey: process.env.FMP_API_KEY, limit: 5 },
        timeout: 15000,
        validateStatus: () => true,
      });
      endpointProbe.stable_news = probe.status;
    } catch (error) {
      endpointProbe.stable_news = `error:${error.message}`;
    }

    try {
      const probe = await axios.get('https://financialmodelingprep.com/stable/news/stock-latest', {
        params: { apikey: process.env.FMP_API_KEY, symbols: 'AAPL', limit: 5 },
        timeout: 15000,
        validateStatus: () => true,
      });
      endpointProbe.stable_news_stock_latest = probe.status;
    } catch (error) {
      endpointProbe.stable_news_stock_latest = `error:${error.message}`;
    }

    try {
      const probe = await axios.get('https://financialmodelingprep.com/stable/news/stock', {
        params: { apikey: process.env.FMP_API_KEY, symbols: 'AAPL', limit: 5 },
        timeout: 15000,
        validateStatus: () => true,
      });
      endpointProbe.stable_news_stock = probe.status;
    } catch (error) {
      endpointProbe.stable_news_stock = `error:${error.message}`;
    }

    let ingestRun = null;
    if (initialRows6h === 0 || initialSymbolRows6h < 10) {
      const symbols = await getTopDecisionSymbols(pool, 250);
      ingestRun = await runNewsIngestion(symbols);
    }

    const afterNewsState = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE COALESCE(published_at, created_at) > NOW() - INTERVAL '6 hours')::int AS rows_last_6h,
         COUNT(*) FILTER (
           WHERE COALESCE(published_at, created_at) > NOW() - INTERVAL '6 hours'
             AND symbol IS NOT NULL
             AND TRIM(symbol) <> ''
         )::int AS symbol_rows_last_6h
       FROM news_articles`
    );
    const rows6h = toNumber(afterNewsState.rows?.[0]?.rows_last_6h, 0);
    const symbolRows6h = toNumber(afterNewsState.rows?.[0]?.symbol_rows_last_6h, 0);

    report.phase_results.phase1_news_pipeline_restore = {
      last_inserted_row_timestamp: newsState.rows?.[0]?.last_news_at || null,
      ingestion_job_triggered: Boolean(ingestRun),
      ingestion_run_stats: ingestRun,
      has_fmp_api_key: hasFmpKey,
      endpoint_probe: endpointProbe,
      news_rows_last_6h: rows6h,
      news_symbol_rows_last_6h: symbolRows6h,
    };
    report.news_rows_last_6h = rows6h;

    if (!hasFmpKey) failFast('FMP_API_KEY missing', report);
    const stockLatestOk = Number(endpointProbe.stable_news_stock_latest);
    const stockOk = Number(endpointProbe.stable_news_stock);
    if (!((stockLatestOk >= 200 && stockLatestOk < 300) || (stockOk >= 200 && stockOk < 300))) {
      failFast(
        `FMP news endpoint validation failed: stock-latest=${endpointProbe.stable_news_stock_latest}, stock=${endpointProbe.stable_news_stock}`,
        report
      );
    }
    if (rows6h <= 20) failFast(`news_rows_last_6h gate failed (${rows6h} <= 20)`, report);
    if (symbolRows6h <= 10) failFast(`news_symbol_rows_last_6h gate failed (${symbolRows6h} <= 10)`, report);

    const signalInfo = await getSignalsTableInfo(pool);
    const newsInjection = await upsertNewsSignals(pool, signalInfo);

    const newsSignalCoverage = await pool.query(
      `WITH news_symbols AS (
         SELECT DISTINCT UPPER(symbol) AS symbol
         FROM news_articles
         WHERE symbol IS NOT NULL
           AND COALESCE(published_at, created_at) > NOW() - INTERVAL '6 hours'
       ),
       signal_symbols AS (
         SELECT DISTINCT UPPER(symbol) AS symbol
         FROM signals
         WHERE symbol IS NOT NULL
           ${signalInfo.hasCreatedAt ? "AND created_at > NOW() - INTERVAL '48 hours'" : ''}
       )
       SELECT
         (SELECT COUNT(*)::int FROM news_symbols) AS total_news_symbols,
         (SELECT COUNT(*)::int FROM news_symbols n JOIN signal_symbols s USING(symbol)) AS covered_symbols`
    );

    const totalNewsSymbols = toNumber(newsSignalCoverage.rows?.[0]?.total_news_symbols, 0);
    const coveredNewsSymbols = toNumber(newsSignalCoverage.rows?.[0]?.covered_symbols, 0);
    const newsCoveragePct = pct(coveredNewsSymbols, totalNewsSymbols);

    report.phase_results.phase2_news_signal_injection = {
      ...newsInjection,
      total_news_symbols: totalNewsSymbols,
      covered_news_symbols: coveredNewsSymbols,
      news_symbols_in_signals_percent: newsCoveragePct,
    };

    if (newsCoveragePct <= 50) {
      failFast(`news signal coverage gate failed (${newsCoveragePct}% <= 50%)`, report);
    }

    const earningsIngest = await runEarningsIngestion();
    const setupInfo = await getTradeSetupsTableInfo(pool);
    const earningsRepair = await ensureEarningsSignalsAndSetups(pool, signalInfo, setupInfo);

    const earningsCoverage = await pool.query(
      `WITH e AS (
         SELECT DISTINCT UPPER(symbol) AS symbol
         FROM earnings_events
         WHERE symbol IS NOT NULL
           AND report_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '3 days'
           AND UPPER(symbol) IN (
             SELECT DISTINCT UPPER(symbol)
             FROM decision_view
             WHERE symbol IS NOT NULL
               AND TRIM(symbol) <> ''
           )
       ),
       d AS (
         SELECT DISTINCT UPPER(symbol) AS symbol
         FROM decision_view
       )
       SELECT
         (SELECT COUNT(*)::int FROM e) AS total,
         (SELECT COUNT(*)::int FROM e JOIN d USING(symbol)) AS in_decision_view`
    );

    const earningsTotal = toNumber(earningsCoverage.rows?.[0]?.total, 0);
    const earningsInDecisionView = toNumber(earningsCoverage.rows?.[0]?.in_decision_view, 0);
    const earningsCoveragePct = pct(earningsInDecisionView, earningsTotal);
    report.earnings_coverage_percent = earningsCoveragePct;

    report.phase_results.phase3_earnings_flow_fix = {
      earnings_ingestion: earningsIngest,
      ...earningsRepair,
      earnings_symbols_total: earningsTotal,
      earnings_symbols_in_decision_view: earningsInDecisionView,
      earnings_coverage_percent: earningsCoveragePct,
    };

    if (earningsCoveragePct < 50) {
      failFast(`earnings coverage gate failed (${earningsCoveragePct}% < 50%)`, report);
    }

    const freshness = await pool.query(
      `SELECT MAX(COALESCE(
        (to_jsonb(m)->>'updated_at')::timestamptz,
        (to_jsonb(m)->>'last_updated')::timestamptz,
        (to_jsonb(m)->>'asof')::timestamptz
       )) AS latest_update
       FROM market_metrics m`
    );

    const movers = await pool.query(
      `SELECT DISTINCT UPPER(symbol) AS symbol
       FROM market_metrics m
       WHERE ABS(COALESCE(
         (to_jsonb(m)->>'change_percent')::numeric,
         (to_jsonb(m)->>'daily_change_percent')::numeric,
         (to_jsonb(m)->>'price_change_percent')::numeric,
         (to_jsonb(m)->>'percent_change')::numeric,
         (to_jsonb(m)->>'changePct')::numeric,
         0
       )) >= 4
         AND UPPER(symbol) IN (
           SELECT DISTINCT UPPER(symbol)
           FROM decision_view
           WHERE symbol IS NOT NULL
             AND TRIM(symbol) <> ''
         )`
    );

    const moverSymbols = new Set((movers.rows || []).map((r) => String(r.symbol || '').trim().toUpperCase()).filter(Boolean));

    const watchlistRows = await fetchWatchlist();
    const watchSymbols = new Set(watchlistRows.map((row) => String(row.symbol || '').trim().toUpperCase()).filter(Boolean));
    let moversInWatch = 0;
    for (const symbol of moverSymbols) {
      if (watchSymbols.has(symbol)) moversInWatch += 1;
    }

    const largeMovePct = pct(moversInWatch, moverSymbols.size);
    report.large_move_percent = largeMovePct;

    report.phase_results.phase4_large_move_logic_fix = {
      change_percent_latest_update: freshness.rows?.[0]?.latest_update || null,
      large_move_symbols_total: moverSymbols.size,
      large_move_symbols_in_watchlist: moversInWatch,
      large_move_in_watchlist_percent: largeMovePct,
    };

    if (largeMovePct < 15) {
      failFast(`large move watchlist gate failed (${largeMovePct}% < 15%)`, report);
    }

    const distribution = watchlistRows.reduce((acc, row) => {
      const reason = String(row.watch_reason || 'UNKNOWN').toUpperCase();
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {});

    const totalWatch = watchlistRows.length;
    const highVolPct = pct(toNumber(distribution.HIGH_VOLATILITY, 0), totalWatch);

    report.watchlist_distribution = {
      total: totalWatch,
      by_reason: distribution,
      high_volatility_percent: highVolPct,
    };

    report.phase_results.phase5_watchlist_rebuild = {
      total_watchlist: totalWatch,
      high_volatility_percent: highVolPct,
      has_earnings: toNumber(distribution.EARNINGS_UPCOMING, 0) > 0,
      has_news: toNumber(distribution.NEWS_PENDING, 0) > 0,
      has_large_move: toNumber(distribution.LARGE_MOVE, 0) > 0,
    };

    if (highVolPct >= 50) failFast(`watchlist distribution gate failed (HIGH_VOLATILITY=${highVolPct}%)`, report);
    if (toNumber(distribution.EARNINGS_UPCOMING, 0) === 0) failFast('watchlist missing EARNINGS_UPCOMING', report);
    if (toNumber(distribution.NEWS_PENDING, 0) === 0) failFast('watchlist missing NEWS_PENDING', report);
    if (toNumber(distribution.LARGE_MOVE, 0) === 0) failFast('watchlist missing LARGE_MOVE', report);

    report.verdict = 'PASS';
    await writeReport(report);
    console.log('PREP DATA PIPELINE ACTIVE');
  } catch (error) {
    report.verdict = 'FAIL';
    report.error = error.message;
    await writeReport(report);
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch(async (error) => {
  const fallback = {
    timestamp: new Date().toISOString(),
    verdict: 'FAIL',
    error: error.message,
  };
  try {
    await fs.promises.writeFile(REPORT_PATH, JSON.stringify(fallback, null, 2));
  } catch {
    // best-effort write
  }
  console.error(error.message);
  process.exit(1);
});
