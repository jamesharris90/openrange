const express = require('express');
const { pool, queryWithTimeout } = require('../db/pg');
const { fmpFetch } = require('../services/fmpClient');
const { fetchNextEventForSymbol } = require('../engines/earningsIngestionEngine');
const { getCoverageContext, getCoverageExplanation, hasStructuralEarningsGap } = require('../services/dataCoverageService');
const {
  classifyEarningsTrade,
  buildExecutionPlan,
  deriveBias,
} = require('../intelligence/earningsClassifier');
const { getCachedEarningsCalendarPayload } = require('../v2/services/experienceSnapshotService');
const { evaluateTradeTruth } = require('../services/truthEngine');
const { buildFinalTradeObject } = require('../engines/finalTradeBuilder');
const { validateTrade } = require('../utils/validateTrade');
const router = express.Router();
const earningsHistoryCache = new Map();
const EARNINGS_HISTORY_TTL_MS = 5 * 60 * 1000;
const EARNINGS_FRESH_TTL_MS = 24 * 60 * 60 * 1000;

const EARNINGS_REQUIRED_COLUMNS = {
  earnings_history: ['symbol', 'report_date', 'eps_actual'],
};
const EARNINGS_LIST_TIMEOUT_MS = 3000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, fallbackValue) {
  const ms = Number(timeoutMs) || 1800;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve(fallbackValue), ms);
    }),
  ]);
}

function parseTimestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function isFreshTimestamp(value, ttlMs = EARNINGS_FRESH_TTL_MS) {
  const parsed = parseTimestamp(value);
  return parsed !== null && (Date.now() - parsed) < ttlMs;
}

function normalizeEventSource(value, fallback = 'fallback') {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'db') return 'db';
  if (text.startsWith('fmp')) return 'fmp';
  if (text === 'fallback') return 'fallback';
  return fallback;
}

function normalizeSymbolEventRow(symbol, row) {
  return {
    symbol: String(row?.symbol || symbol || '').trim().toUpperCase() || null,
    report_date: row?.report_date || row?.date || null,
    report_time: row?.report_time || row?.time || 'TBD',
    eps_estimate: row?.eps_estimate != null ? Number(row.eps_estimate) : null,
    eps_actual: row?.eps_actual != null ? Number(row.eps_actual) : null,
    revenue_estimate: row?.revenue_estimate != null ? Number(row.revenue_estimate) : row?.rev_estimate != null ? Number(row.rev_estimate) : null,
    revenue_actual: row?.revenue_actual != null ? Number(row.revenue_actual) : row?.rev_actual != null ? Number(row.rev_actual) : null,
    expected_move_percent: row?.expected_move_percent != null ? Number(row.expected_move_percent) : row?.expectedMove != null ? Number(row.expectedMove) : null,
    updated_at: row?.updated_at || null,
    source: normalizeEventSource(row?.source, 'fallback'),
  };
}

function deriveEventStatus(row) {
  if (!row?.report_date) {
    return 'none';
  }

  const hasTime = Boolean(row.report_time && String(row.report_time).trim().toUpperCase() !== 'TBD');
  const hasEstimate = row.eps_estimate != null;
  const hasExpectedMove = row.expected_move_percent != null;
  return hasTime && hasEstimate && hasExpectedMove ? 'full' : 'partial';
}

function buildSymbolEnvelope(symbol, row, source) {
  const data = normalizeSymbolEventRow(symbol, row);
  return {
    status: deriveEventStatus(data),
    source,
    data,
    meta: {
      fallback: source === 'fallback',
      reason: source === 'fallback' ? 'no_data' : null,
    },
  };
}

function summarizeCalendarStatus(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 'none';
  }

  const allFull = rows.every((row) => {
    const reportTime = String(row?.time || row?.report_time || '').trim().toUpperCase();
    return Boolean((row?.report_date || row?.date) && row?.eps_estimate != null && reportTime && reportTime !== 'TBD' && row?.expected_move_percent != null);
  });

  return allFull ? 'full' : 'partial';
}

async function readUpcomingDbEvent(symbol) {
  const schemaMap = await getSchemaMap(['earnings_events']);
  const result = await safePoolQuery(
    'earnings.symbol_db',
    `SELECT *
     FROM (
       SELECT
         symbol,
         report_date::text AS report_date,
         COALESCE(NULLIF(report_time, ''), 'TBD') AS report_time,
         eps_estimate,
         eps_actual,
         COALESCE(${selectColumn(schemaMap, 'earnings_events', 'e', 'revenue_estimate')}, ${selectColumn(schemaMap, 'earnings_events', 'e', 'rev_estimate')}) AS revenue_estimate,
         COALESCE(${selectColumn(schemaMap, 'earnings_events', 'e', 'revenue_actual')}, ${selectColumn(schemaMap, 'earnings_events', 'e', 'rev_actual')}) AS revenue_actual,
         expected_move_percent,
         COALESCE(source, 'db') AS source,
         COALESCE(updated_at, created_at, NOW()) AS updated_at,
         0 AS source_rank
       FROM earnings_events e
       WHERE UPPER(symbol) = $1
         AND report_date >= CURRENT_DATE

       UNION ALL

       SELECT
         symbol,
         next_earnings_date::text AS report_date,
         'TBD' AS report_time,
         eps_estimate,
         eps_actual,
         NULL::numeric AS revenue_estimate,
         NULL::numeric AS revenue_actual,
         expected_move_percent,
         'snapshot' AS source,
         updated_at,
         1 AS source_rank
       FROM earnings_snapshot
       WHERE UPPER(symbol) = $1
         AND next_earnings_date >= CURRENT_DATE
     ) upcoming
     ORDER BY source_rank ASC, report_date ASC
     LIMIT 1`,
    [symbol]
  );

  return result.rows?.[0] || null;
}

function getFreshCacheEntry(cache, key, ttlMs) {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }

  if ((Date.now() - entry.timestamp) >= ttlMs) {
    cache.delete(key);
    return null;
  }

  return entry.data;
}

function fallbackCalendarPayload(extra = {}) {
  return {
    success: false,
    data: [],
    count: 0,
    status: 'unavailable',
    source: 'earnings_calendar',
    error: 'backend_unavailable',
    meta: {
      fallback: true,
      reason: 'no_data',
    },
    ...extra,
  };
}

function emptyHistoryPayload(extra = {}) {
  return {
    success: true,
    data: [],
    count: 0,
    status: 'no_data',
    source: 'earnings_history',
    meta: {
      fallback: true,
      reason: 'no_data',
    },
    ...extra,
  };
}

function buildCoverageAwareMessage(symbol, coverage, hasNextEvent, structurallyUnsupported = false) {
  switch (true) {
    case structurallyUnsupported:
      return 'Earnings are not expected for this listing type.';
    case coverage?.status === 'LOW_QUALITY_TICKER':
      return 'Earnings coverage is currently unavailable for this low-liquidity ticker.';
    case coverage?.status === 'PARTIAL_EARNINGS':
      return hasNextEvent
        ? `Upcoming earnings are scheduled for ${symbol}, but historical quarters are still backfilling.`
        : `Historical earnings for ${symbol} are only partially available right now.`;
    case coverage?.status === 'NO_EARNINGS':
      return `No recent earnings history has been published for ${symbol}.`;
    default:
      return hasNextEvent
        ? `Upcoming earnings are scheduled for ${symbol}, but recent history is still unavailable.`
        : 'No recent earnings data available.';
  }
}

async function fmpEarningsFallback(from, to) {
  try {
    const rows = await fmpFetch('/earnings-calendar', { from, to }).catch(() => []);
    return rows.map((r) => ({
      symbol: String(r.symbol || '').toUpperCase(),
      company_name: r.company || r.name || r.symbol,
      report_date: r.date,
      time: r.time || 'TBD',
      eps_estimate: r.epsEstimated != null ? Number(r.epsEstimated) : null,
      eps_actual: r.eps != null ? Number(r.eps) : null,
      revenue_estimate: r.revenueEstimated != null ? Number(r.revenueEstimated) : r.revenueEstimate != null ? Number(r.revenueEstimate) : null,
      revenue_actual: r.revenueActual != null ? Number(r.revenueActual) : r.revenue != null ? Number(r.revenue) : null,
      expected_move_percent: null,
      market_cap: null,
      sector: null,
      score: null,
      class: 'C',
      updated_at: new Date().toISOString(),
      source: 'fmp',
    })).filter((r) => r.symbol);
  } catch (_err) {
    return [];
  }
}

async function withRetry(label, fn, retries = 2, delayMs = 500) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.error('[EARNINGS DATA SOURCE FAIL]', {
        source: label,
        attempt: attempt + 1,
        max_attempts: retries + 1,
        message: err?.message,
        stack: err?.stack,
      });
      if (attempt < retries) {
        await sleep(delayMs);
      }
    }
  }
  throw lastErr;
}

async function safePoolQuery(label, query, params = []) {
  try {
    return await pool.query(query, params);
  } catch (err) {
    console.error('[EARNINGS SQL FAIL]', {
      source: label,
      message: err?.message,
      stack: err?.stack,
    });
    throw err;
  }
}

async function getSchemaMap(tableNames) {
  const result = await safePoolQuery(
    'schema.columns',
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])`,
    [tableNames],
  );

  const map = new Map();
  for (const row of result.rows) {
    if (!map.has(row.table_name)) {
      map.set(row.table_name, new Set());
    }
    map.get(row.table_name).add(row.column_name);
  }
  return map;
}

function hasColumn(schemaMap, tableName, columnName) {
  return schemaMap.get(tableName)?.has(columnName) || false;
}

function selectColumn(schemaMap, tableName, alias, columnName, fallbackSql = 'NULL') {
  if (hasColumn(schemaMap, tableName, columnName)) {
    return `${alias}.${columnName}`;
  }
  return fallbackSql;
}

async function ensureRequiredSchema() {
  const requiredTables = Object.keys(EARNINGS_REQUIRED_COLUMNS);
  const schemaMap = await getSchemaMap(requiredTables);

  for (const tableName of requiredTables) {
    const cols = EARNINGS_REQUIRED_COLUMNS[tableName];
    for (const col of cols) {
      if (!hasColumn(schemaMap, tableName, col)) {
        console.error('[EARNINGS SQL FAIL]', {
          source: 'schema.required',
          table: tableName,
          column: col,
          message: 'Required table/column missing',
        });
        return false;
      }
    }
  }

  return true;
}

function toUtcDateOnly(dateInput) {
  const date = new Date(dateInput);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function limitRows(rows, limit) {
  return Array.isArray(rows) ? rows.slice(0, limit) : [];
}

function toUtcMidnight(dateInput) {
  const d = new Date(dateInput);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function computeTradingWeekWindow(nowInput = new Date()) {
  const today = toUtcDateOnly(nowInput);
  const day = today.getUTCDay();
  let monday;

  if (day === 6) {
    monday = addUtcDays(today, 2);
  } else if (day === 0) {
    monday = addUtcDays(today, 1);
  } else {
    monday = addUtcDays(today, -(day - 1));
  }

  const friday = addUtcDays(monday, 4);
  return {
    today: isoDate(today),
    from: isoDate(monday),
    to: isoDate(friday),
  };
}

/**
 * Batch-fetch FMP /stable/quote for up to 200 symbols at a time.
 * Returns a Map keyed by uppercase symbol.
 */
/**
 * Compute beatsInLast4 for a list of symbols using historical earnings_events data.
 * Returns a Map<symbol, beatsInLast4_count>.
 */
async function fetchBeatsInLast4(symbols, beforeDate) {
  if (!symbols.length) return new Map();
  try {
    const result = await pool.query(
      `SELECT symbol, COUNT(*)::int FILTER (WHERE eps_actual > eps_estimate) AS beats
       FROM (
         SELECT symbol, eps_actual, eps_estimate,
                ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY report_date DESC) AS rn
         FROM earnings_events
         WHERE symbol = ANY($1)
           AND report_date < $2
           AND eps_actual IS NOT NULL
           AND eps_estimate IS NOT NULL
       ) t
       WHERE rn <= 4
       GROUP BY symbol`,
      [symbols, beforeDate],
    );
    const map = new Map();
    for (const row of result.rows) map.set(row.symbol, row.beats);
    return map;
  } catch {
    return new Map();
  }
}

router.get('/api/earnings', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
    const rawSymbol = String(req.query.symbol || '').trim().toUpperCase();
    const tradingWeek = computeTradingWeekWindow(new Date());

    async function buildCalendarFallbackResponse(reason) {
      const snapshotPayload = await getCachedEarningsCalendarPayload({
        from: tradingWeek.from,
        to: tradingWeek.to,
        limit,
      }).catch(() => null);

      if (snapshotPayload?.success && Array.isArray(snapshotPayload.data) && snapshotPayload.data.length > 0) {
        return {
          success: true,
          status: 'fallback',
          source: snapshotPayload.source || 'earnings_calendar_snapshot',
          count: Math.min(snapshotPayload.data.length, limit),
          data: snapshotPayload.data.slice(0, limit),
          message: 'Returning earnings calendar snapshot fallback.',
          meta: {
            fallback: true,
            reason,
          },
        };
      }

      const fmpRows = await fmpEarningsFallback(tradingWeek.from, tradingWeek.to);
      if (fmpRows.length > 0) {
        return {
          success: true,
          status: 'fallback',
          source: 'fmp_direct',
          count: Math.min(fmpRows.length, limit),
          data: fmpRows.slice(0, limit),
          message: 'Returning live calendar fallback.',
          meta: {
            fallback: true,
            reason,
          },
        };
      }

      return {
        ...emptyHistoryPayload(),
        message: 'No historical earnings data is available.',
        meta: {
          fallback: true,
          reason,
        },
      };
    }

    if (rawSymbol) {
      const dbRow = await readUpcomingDbEvent(rawSymbol).catch(() => null);
      if (dbRow && isFreshTimestamp(dbRow.updated_at)) {
        return res.json(buildSymbolEnvelope(rawSymbol, dbRow, 'db'));
      }

      const fmpRow = await fetchNextEventForSymbol(rawSymbol).catch(() => null);
      if (fmpRow) {
        return res.json(buildSymbolEnvelope(rawSymbol, fmpRow, 'fmp'));
      }

      if (dbRow) {
        return res.json(buildSymbolEnvelope(rawSymbol, dbRow, 'fallback'));
      }

      return res.json(buildSymbolEnvelope(rawSymbol, null, 'fallback'));
    }

    const cacheKey = `${rawSymbol || 'ALL'}:${limit}`;
    const cachedResponse = getFreshCacheEntry(earningsHistoryCache, cacheKey, EARNINGS_HISTORY_TTL_MS);

    if (cachedResponse) {
      return res.json(cachedResponse);
    }

    const hasRequiredSchema = await ensureRequiredSchema().catch(() => false);

    if (!hasRequiredSchema) {
      const response = await buildCalendarFallbackResponse('no_data');

      earningsHistoryCache.set(cacheKey, {
        data: response,
        timestamp: Date.now(),
      });

      return res.json(response);
    }

    const schemaMap = await getSchemaMap(['earnings_history', 'ticker_universe']);
    const reportTimeExpr = hasColumn(schemaMap, 'earnings_history', 'report_time')
      ? "COALESCE(NULLIF(e.report_time, ''), 'TBD')"
      : "'TBD'";
    const epsActualExpr = selectColumn(schemaMap, 'earnings_history', 'e', 'eps_actual');
    const epsEstimateExpr = selectColumn(schemaMap, 'earnings_history', 'e', 'eps_estimate');
    const expectedMoveExpr = selectColumn(schemaMap, 'earnings_history', 'e', 'expected_move_percent');
    const actualMoveExpr = selectColumn(schemaMap, 'earnings_history', 'e', 'actual_move_percent');
    const postMoveExpr = selectColumn(schemaMap, 'earnings_history', 'e', 'post_move_percent');

    const params = [];
    const where = [
      `(${epsActualExpr} IS NOT NULL OR ${epsEstimateExpr} IS NOT NULL OR ${expectedMoveExpr} IS NOT NULL OR ${actualMoveExpr} IS NOT NULL OR ${postMoveExpr} IS NOT NULL)`,
    ];

    if (rawSymbol) {
      params.push(rawSymbol);
      where.push(`UPPER(e.symbol) = $${params.length}`);
    }

    params.push(limit);

    const result = await queryWithTimeout(
      `SELECT
         e.symbol,
         tu.company_name,
         tu.sector,
         e.report_date::text AS report_date,
         ${reportTimeExpr} AS report_time,
         ${epsEstimateExpr} AS eps_estimate,
         ${epsActualExpr} AS eps_actual,
         ${selectColumn(schemaMap, 'earnings_history', 'e', 'eps_surprise_pct')} AS surprise_percent,
         ${expectedMoveExpr} AS expected_move_percent,
         ${actualMoveExpr} AS actual_move_percent,
         ${selectColumn(schemaMap, 'earnings_history', 'e', 'pre_move_percent')} AS pre_move_percent,
         ${postMoveExpr} AS post_move_percent,
         ${selectColumn(schemaMap, 'earnings_history', 'e', 'true_reaction_window')} AS true_reaction_window,
         CASE
           WHEN ${epsActualExpr} IS NOT NULL AND ${epsEstimateExpr} IS NOT NULL THEN ${epsActualExpr} > ${epsEstimateExpr}
           ELSE NULL
         END AS beat
       FROM earnings_history e
       LEFT JOIN ticker_universe tu ON UPPER(e.symbol) = UPPER(tu.symbol)
       WHERE ${where.join(' AND ')}
       ORDER BY e.report_date DESC, e.symbol ASC
       LIMIT $${params.length}`,
      params,
      {
        timeoutMs: EARNINGS_LIST_TIMEOUT_MS,
        maxRetries: 0,
        label: 'earnings.history.list',
        poolType: 'read',
      }
    ).catch(async () => ({ rows: null, fallback: await buildCalendarFallbackResponse('query_timeout') }));

    if (result.rows === null && result.fallback) {
      earningsHistoryCache.set(cacheKey, {
        data: result.fallback,
        timestamp: Date.now(),
      });
      return res.json(result.fallback);
    }

    if (result.rows.length === 0) {
      return res.json({
        ...emptyHistoryPayload(),
        message: rawSymbol
          ? `No historical earnings data is available for ${rawSymbol}.`
          : 'No historical earnings data is available.',
      });
    }

    const response = {
      success: true,
      status: 'ok',
      source: 'earnings_history',
      count: result.rows.length,
      data: result.rows,
    };

    earningsHistoryCache.set(cacheKey, {
      data: response,
      timestamp: Date.now(),
    });

    return res.json(response);
  } catch (err) {
    return res.status(503).json({
      success: false,
      status: 'unavailable',
      source: 'earnings_history',
      error: 'EARNINGS_HISTORY_FETCH_FAILED',
      message: err.message,
      data: [],
    });
  }
});

router.get('/api/earnings/history/:symbol', async (req, res) => {
  try {
    const symbol = String(req.params.symbol || '').trim().toUpperCase();
    if (!symbol) {
      return res.status(400).json({
        success: false,
        symbol: null,
        next: null,
        history: [],
        error: 'symbol_required',
      });
    }

    const hasRequiredSchema = await ensureRequiredSchema().catch(() => false);
    if (!hasRequiredSchema) {
      return res.json({
        success: true,
        symbol,
        next: null,
        history: [],
        message: 'No recent earnings data available',
        meta: {
          fallback: true,
          reason: 'no_data',
        },
      });
    }

    const schemaMap = await getSchemaMap(['earnings_history', 'earnings_events', 'ticker_universe']);
    const historyReportTimeExpr = hasColumn(schemaMap, 'earnings_history', 'report_time')
      ? "COALESCE(NULLIF(e.report_time, ''), 'TBD')"
      : "'TBD'";
    const eventReportTimeExpr = hasColumn(schemaMap, 'earnings_events', 'report_time')
      ? 'NULLIF(e.report_time, \'\')'
      : 'NULL';
    const eventFallbackTimeExpr = hasColumn(schemaMap, 'earnings_events', 'time')
      ? 'NULLIF(e.time, \'\')'
      : 'NULL';

    const [historyResult, nextResult] = await Promise.all([
      pool.query(
        `SELECT
           e.symbol,
           tu.company_name,
           e.report_date::text AS report_date,
           ${historyReportTimeExpr} AS report_time,
           ${selectColumn(schemaMap, 'earnings_history', 'e', 'eps_estimate')} AS eps_estimate,
           ${selectColumn(schemaMap, 'earnings_history', 'e', 'eps_actual')} AS eps_actual,
           ${selectColumn(schemaMap, 'earnings_history', 'e', 'eps_surprise_pct')} AS surprise_percent,
           ${selectColumn(schemaMap, 'earnings_history', 'e', 'revenue_estimate')} AS revenue_estimate,
           ${selectColumn(schemaMap, 'earnings_history', 'e', 'revenue_actual')} AS revenue_actual,
           ${selectColumn(schemaMap, 'earnings_history', 'e', 'expected_move_percent')} AS expected_move_percent,
           COALESCE(e.updated_at, e.created_at, e.report_date) AS updated_at
         FROM earnings_history e
         LEFT JOIN ticker_universe tu ON UPPER(e.symbol) = UPPER(tu.symbol)
         WHERE UPPER(e.symbol) = $1
         ORDER BY e.report_date DESC
         LIMIT 4`,
        [symbol]
      ).catch(() => ({ rows: [] })),
      pool.query(
        `SELECT
           e.symbol,
           COALESCE(${selectColumn(schemaMap, 'earnings_events', 'e', 'company_name')}, ${selectColumn(schemaMap, 'earnings_events', 'e', 'company')}, tu.company_name) AS company_name,
           e.report_date::text AS report_date,
           COALESCE(${eventReportTimeExpr}, ${eventFallbackTimeExpr}, 'TBD') AS report_time,
           ${selectColumn(schemaMap, 'earnings_events', 'e', 'eps_estimate')} AS eps_estimate,
           COALESCE(${selectColumn(schemaMap, 'earnings_events', 'e', 'revenue_estimate')}, ${selectColumn(schemaMap, 'earnings_events', 'e', 'rev_estimate')}) AS revenue_estimate,
           COALESCE(e.updated_at, e.created_at, e.report_date) AS updated_at
         FROM earnings_events e
         LEFT JOIN ticker_universe tu ON UPPER(e.symbol) = UPPER(tu.symbol)
         WHERE UPPER(e.symbol) = $1
           AND e.report_date::date >= CURRENT_DATE
         ORDER BY e.report_date ASC
         LIMIT 1`,
        [symbol]
      ).catch(() => ({ rows: [] })),
    ]);

    const history = historyResult.rows || [];
    const next = nextResult.rows?.[0] || null;
    const coverage = await withTimeout(getCoverageExplanation(symbol).catch(() => null), 500, null);
    const coverageContext = await withTimeout(getCoverageContext(symbol).catch(() => null), 500, null);
    const structurallyUnsupported = hasStructuralEarningsGap(coverageContext || {});
    const noHistory = history.length === 0;
    const message = noHistory ? buildCoverageAwareMessage(symbol, coverage, Boolean(next), structurallyUnsupported) : null;

    return res.json({
      success: true,
      symbol,
      next,
      history,
      message,
      meta: noHistory
        ? {
            fallback: true,
            reason: structurallyUnsupported
              ? 'structurally_unsupported'
              : coverage?.status === 'LOW_QUALITY_TICKER'
                ? 'low_quality_ticker'
                : 'no_data',
            unsupported: structurallyUnsupported || ['STRUCTURALLY_UNSUPPORTED', 'LOW_QUALITY_TICKER'].includes(String(coverage?.status || '')),
            coverage_status: coverage?.status || null,
            coverage_detail: coverage?.detail || null,
            coverage_explanation: coverage?.explanation || null,
            instrument_type_unsupported: structurallyUnsupported,
          }
        : {
            fallback: false,
            unsupported: structurallyUnsupported,
            coverage_status: coverage?.status || null,
            coverage_detail: coverage?.detail || null,
            coverage_explanation: coverage?.explanation || null,
            instrument_type_unsupported: structurallyUnsupported,
          },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      symbol: String(req.params.symbol || '').trim().toUpperCase() || null,
      next: null,
      history: [],
      error: error.message || 'earnings_history_failed',
      message: 'No recent earnings data available',
      meta: {
        fallback: true,
        reason: 'no_data',
      },
    });
  }
});

router.get('/api/earnings/calendar', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 400, 600));
    const classFilter = String(req.query.class || '').trim().toUpperCase();
    const tradingWeek = computeTradingWeekWindow(new Date());
    const fromParam = String(req.query.from || '').trim();
    const toParam = String(req.query.to || '').trim();
    const from = fromParam || tradingWeek.from;
    const to = toParam || tradingWeek.to;

    console.log('EARNINGS REQUEST', {
      path: '/api/earnings/calendar',
      query: req.query,
      from,
      to,
      limit,
      class_filter: classFilter || null,
    });

    const snapshotPayload = await getCachedEarningsCalendarPayload({
      from,
      to,
      limit,
      class: classFilter,
    }).catch(() => null);

    if (snapshotPayload && snapshotPayload.source !== 'snapshot_stale') {
      return res.status(200).json(snapshotPayload);
    }

    let hasRequiredSchema = false;
    try {
      hasRequiredSchema = await ensureRequiredSchema();
    } catch (_schemaErr) {
      hasRequiredSchema = false;
    }
    if (!hasRequiredSchema) {
      console.warn('[EARNINGS] schema unavailable — using FMP fallback');
      const fmpRows = await fmpEarningsFallback(from, to);
      if (fmpRows.length > 0) {
        const limitedRows = limitRows(fmpRows, limit);
        return res.status(200).json({
          success: true,
          data: limitedRows,
          count: limitedRows.length,
          source: 'fmp_direct',
          rows: limitedRows,
          meta: {
            fallback: true,
            reason: 'no_data',
          },
        });
      }
      return res.status(200).json({
        ...fallbackCalendarPayload({ message: 'schema_unavailable' }),
        success: true,
      });
    }

    const joinTables = ['earnings_events', 'decision_view', 'market_metrics', 'market_quotes'];
    let schemaMap;
    try {
      schemaMap = await getSchemaMap(joinTables);
    } catch (err) {
      console.error('[EARNINGS SQL FAIL]', {
        source: 'schema.join_map',
        message: err?.message,
        stack: err?.stack,
      });
      const fmpRows = await fmpEarningsFallback(from, to);
      if (fmpRows.length > 0) {
        const limitedRows = limitRows(fmpRows, limit);
        return res.status(200).json({
          success: true,
          data: limitedRows,
          count: limitedRows.length,
          source: 'fmp_direct',
          rows: limitedRows,
          meta: {
            fallback: true,
            reason: 'no_data',
          },
        });
      }
      return res.status(200).json({
        ...fallbackCalendarPayload({ message: 'schema_lookup_failed' }),
        success: true,
      });
    }

    const hasDecisionView = hasColumn(schemaMap, 'decision_view', 'symbol');
    const hasMarketMetrics = hasColumn(schemaMap, 'market_metrics', 'symbol');
    const hasMarketQuotes = hasColumn(schemaMap, 'market_quotes', 'symbol');

    const reportTimeExpr = hasColumn(schemaMap, 'earnings_events', 'report_time')
      ? "NULLIF(e.report_time, '')"
      : 'NULL';
    const fallbackTimeExpr = hasColumn(schemaMap, 'earnings_events', 'time')
      ? "NULLIF(e.time, '')"
      : 'NULL';

    const dbSql = `WITH base AS (
      SELECT
        e.symbol,
        COALESCE(${selectColumn(schemaMap, 'earnings_events', 'e', 'company')}, ${selectColumn(schemaMap, 'earnings_events', 'e', 'company_name')}, tu.company_name) AS company,
        e.report_date::text AS report_date,
        COALESCE(${reportTimeExpr}, ${fallbackTimeExpr}, 'UNKNOWN') AS report_time,
        ${selectColumn(schemaMap, 'earnings_events', 'e', 'eps_estimate')} AS eps_estimate,
        ${selectColumn(schemaMap, 'earnings_events', 'e', 'eps_actual')} AS eps_actual,
        ${selectColumn(schemaMap, 'earnings_events', 'e', 'eps_surprise_pct')} AS eps_surprise_pct,
        COALESCE(${selectColumn(schemaMap, 'earnings_events', 'e', 'revenue_estimate')}, ${selectColumn(schemaMap, 'earnings_events', 'e', 'rev_estimate')}) AS revenue_estimate,
        COALESCE(${selectColumn(schemaMap, 'earnings_events', 'e', 'revenue_actual')}, ${selectColumn(schemaMap, 'earnings_events', 'e', 'rev_actual')}) AS revenue_actual,
        COALESCE(${selectColumn(schemaMap, 'earnings_events', 'e', 'sector')}, ${hasMarketQuotes && hasColumn(schemaMap, 'market_quotes', 'sector') ? 'q.sector' : 'NULL'}, tu.sector) AS sector,
        ${selectColumn(schemaMap, 'earnings_events', 'e', 'score')} AS earnings_score,
        ${selectColumn(schemaMap, 'earnings_events', 'e', 'expected_move_percent')} AS expected_move_from_earnings,
        COALESCE(${hasMarketMetrics ? 'm.price' : 'NULL'}, ${hasMarketQuotes ? 'q.price' : 'NULL'}) AS price,
        ${hasMarketQuotes ? 'q.market_cap' : 'NULL'} AS market_cap,
        COALESCE(${hasMarketMetrics ? 'm.volume' : 'NULL'}, ${hasMarketQuotes ? 'q.volume' : 'NULL'}) AS volume,
        ${hasMarketMetrics && hasColumn(schemaMap, 'market_metrics', 'relative_volume') ? 'm.relative_volume' : 'NULL'} AS relative_volume,
        ${hasMarketMetrics && hasColumn(schemaMap, 'market_metrics', 'atr') ? 'm.atr' : 'NULL'} AS atr,
        ${hasDecisionView && hasColumn(schemaMap, 'decision_view', 'final_score') ? 'd.final_score' : 'NULL'} AS final_score,
        ${hasDecisionView ? "(to_jsonb(d)->>'execution_plan')" : 'NULL'} AS decision_execution_plan,
        ${hasDecisionView ? "(to_jsonb(d)->>'trade_class')" : 'NULL'} AS decision_trade_class,
        COALESCE(e.updated_at, e.created_at, NOW()) AS updated_at,
        COALESCE(e.source, 'db') AS source
      FROM earnings_events e
      LEFT JOIN ticker_universe tu ON UPPER(e.symbol) = UPPER(tu.symbol)
      ${hasDecisionView ? 'LEFT JOIN decision_view d ON UPPER(e.symbol) = UPPER(d.symbol)' : ''}
      ${hasMarketMetrics ? 'LEFT JOIN market_metrics m ON UPPER(e.symbol) = UPPER(m.symbol)' : ''}
      ${hasMarketQuotes ? 'LEFT JOIN market_quotes q ON UPPER(e.symbol) = UPPER(q.symbol)' : ''}
      WHERE e.report_date::date BETWEEN $1::date AND $2::date
    )
    SELECT
      symbol,
      company,
      report_date,
      report_time,
      eps_estimate,
      eps_actual,
      eps_surprise_pct,
      revenue_estimate,
      revenue_actual,
      sector,
      price,
      market_cap,
      volume,
      relative_volume AS rvol,
      atr,
      final_score,
      decision_execution_plan,
      decision_trade_class,
      updated_at,
      source,
      COALESCE(
        expected_move_from_earnings,
        CASE
          WHEN atr IS NOT NULL AND price IS NOT NULL AND price > 0 THEN atr / price
          ELSE NULL
        END
      ) AS expected_move
    FROM base
    ORDER BY report_date ASC, symbol ASC
    LIMIT $3`;

    let dbRows = [];
    try {
      const dbResult = await safePoolQuery('calendar.main_query', dbSql, [from, to, limit]);
      dbRows = dbResult.rows;
    } catch {
      const fmpRows = await fmpEarningsFallback(from, to);
      if (fmpRows.length > 0) {
        const limitedRows = limitRows(fmpRows, limit);
        return res.status(200).json({ success: true, data: limitedRows, count: limitedRows.length, source: 'fmp_direct', rows: limitedRows });
      }
      return res.status(200).json({
        ...fallbackCalendarPayload({ message: 'db_query_failed' }),
        success: true,
      });
    }

    const dbRowsAreFresh = dbRows.some((row) => isFreshTimestamp(row.updated_at));
    const fmpRows = !dbRows.length || !dbRowsAreFresh ? await fmpEarningsFallback(from, to) : [];
    const limitedFmpRows = limitRows(fmpRows, limit);
    const responseSource = dbRows.length && dbRowsAreFresh ? 'db' : fmpRows.length ? 'fmp' : dbRows.length ? 'fallback' : 'fallback';
    const responseRows = responseSource === 'db' ? dbRows : responseSource === 'fmp' ? limitedFmpRows : dbRows;

    let enriched = responseRows.map((row) => {

      const base = {
        symbol: row.symbol,
        company_name: row.company || null,
        report_date: row.report_date,
        time: row.report_time || 'UNKNOWN',
        price: row.price ?? null,
        market_cap: row.market_cap ?? null,
        volume: row.volume ?? null,
        rvol: row.rvol ?? null,
        atr: row.atr,
        expected_move: row.expected_move,
        expected_move_percent: row.expected_move,
        final_score: row.final_score,
        score: row.final_score ?? row.earnings_score ?? null,
        eps_estimate: row.eps_estimate,
        eps_actual: row.eps_actual,
        revenue_estimate: row.revenue_estimate,
        revenue_actual: row.revenue_actual,
        surprise: row.eps_surprise_pct,
        sector: row.sector,
        updated_at: row.updated_at || null,
        source: normalizeEventSource(row.source, responseSource),
      };

      const classification = classifyEarningsTrade({
        price: base.price,
        rvol: base.rvol,
        expected_move_percent: base.expected_move,
        atr: base.atr,
        market_cap: base.market_cap,
      });
      const tradeClass = row.decision_trade_class || classification.classification;
      const executionPlan = row.decision_execution_plan || buildExecutionPlan(base, tradeClass);
      const bias = deriveBias(base);
      const truth = evaluateTradeTruth({
        catalystType: row.catalyst_type || 'earnings',
        rvol: base.rvol || 0,
        structureScore: row.structure_score || 0,
      });

      const epsSurprise = Number(base.surprise || 0);
      const revEstimate = Number(base.revenue_estimate || 0);
      const revActual = Number(base.revenue_actual || 0);
      const revSurprise = revEstimate > 0 ? ((revActual - revEstimate) / revEstimate) * 100 : 0;
      const expectedMovePct = Number(base.expected_move || 0);
      const rvol = Number(base.rvol || 0);
      const score = Math.max(
        0,
        Math.min(
          100,
          Math.abs(epsSurprise) * 2 + Math.abs(revSurprise) * 1.5 + Math.abs(expectedMovePct) * 4 + rvol * 12,
        ),
      );

      const enrichedBase = {
        ...base,
        event_date: row.report_date,
        trade_class: tradeClass,
        tradeability: truth.valid ? 'TRADEABLE' : 'NOT_TRADEABLE',
        tradeability_reason: truth.reason || null,
        setup: classification.setup || null,
        trade_confidence: classification.confidence || null,
        confidence: Number(score.toFixed(2)),
        score: Number(score.toFixed(2)),
        trade_reason: classification.reason,
        execution_plan: executionPlan,
        bias,
        why_moving: `Earnings setup with expected move ${Number(expectedMovePct || 0).toFixed(2)}% and RVOL ${Number(rvol || 0).toFixed(2)}`,
        how_to_trade: `Trade post-release direction using ${classification.setup || 'event-driven'} structure with strict risk control.`,
        strategy: 'EARNINGS_VOLATILITY',
        time_group: String(base.time || 'UNKNOWN').toUpperCase(),
        week_group: row.report_date,
      };

      const finalTrade = buildFinalTradeObject(enrichedBase, 'earnings_calendar');
      if (!finalTrade) {
        return enrichedBase;
      }
      const validation = validateTrade(finalTrade);
      if (!validation.valid) {
        console.error('[earnings/calendar] invalid trade dropped to base row', {
          symbol: enrichedBase.symbol,
          errors: validation.errors,
        });
        return enrichedBase;
      }

      return {
        ...enrichedBase,
        ...finalTrade,
      };
    });

    if (classFilter) {
      enriched = enriched.filter((row) => row.trade_class === classFilter);
    }

    console.log('EARNINGS RESPONSE', {
      from,
      to,
      count: enriched.length,
      rows_with_price: enriched.filter((row) => row.price != null).length,
      rows_with_rvol: enriched.filter((row) => row.rvol != null).length,
      rows_with_expected_move: enriched.filter((row) => row.expected_move != null).length,
      class_filter: classFilter || null,
      external_status: responseSource,
      external_source: responseSource,
    });

    return res.status(200).json({
      success: true,
      mode: 'requested_window',
      window_start: from,
      window_end: to,
      count: enriched.length,
      status: summarizeCalendarStatus(enriched),
      source: responseSource,
      data: enriched,
      rows: enriched,
      message: enriched.length ? '' : 'No earnings data available',
    });
  } catch (err) {
    console.error('[EARNINGS ERROR]', {
      message: err?.message,
      stack: err?.stack,
    });

    return res.status(200).json({
      ...fallbackCalendarPayload({
        message: 'internal_error',
      }),
      success: true,
    });
  }
});

router.get('/api/earnings/health', async (req, res) => {
  let db = 'ok';
  let external = 'ok';

  try {
    const market = require('../services/marketDataService');
    await safePoolQuery('health.db_probe', 'SELECT 1 FROM earnings_events LIMIT 1');
  } catch {
    db = 'fail';
  }

  try {
    await withRetry('health.fmp_probe', () => market.getQuotes(['SPY']), 2, 500);
  } catch {
    external = 'fail';
  }

  return res.status(200).json({ db, external });
});

router.get('/api/earnings-research/:ticker', async (req, res) => {
  return res.status(410).json({
    success: false,
    error: 'EARNINGS_ROUTE_DISABLED',
    message: 'Route disabled. Use /api/earnings/calendar only.',
  });
});

module.exports = router;
