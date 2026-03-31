const express = require('express');
const market = require('../services/marketDataService');
const { pool } = require('../db/pg');
const {
  classifyEarningsTrade,
  buildExecutionPlan,
  deriveBias,
} = require('../intelligence/earningsClassifier');
const { evaluateTradeTruth } = require('../services/truthEngine');
const { buildFinalTradeObject } = require('../engines/finalTradeBuilder');
const { validateTrade } = require('../utils/validateTrade');
const router = express.Router();

const EARNINGS_REQUIRED_COLUMNS = {
  earnings_events: ['symbol', 'report_date'],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fallbackCalendarPayload(extra = {}) {
  return {
    success: true,
    data: [],
    count: 0,
    status: 'no_data',
    source: 'earnings_calendar',
    error: 'safe_fallback',
    ...extra,
  };
}

async function fmpEarningsFallback(from, to) {
  const axios = require('axios');
  const key = process.env.FMP_API_KEY;
  if (!key) return [];
  try {
    const resp = await axios.get('https://financialmodelingprep.com/stable/earnings-calendar', {
      params: { from, to, apikey: key },
      timeout: 8000,
    });
    const rows = Array.isArray(resp.data) ? resp.data : [];
    return rows.map((r) => ({
      symbol: String(r.symbol || '').toUpperCase(),
      company_name: r.company || r.name || r.symbol,
      report_date: r.date,
      time: r.time || 'TBD',
      eps_estimate: r.epsEstimated != null ? Number(r.epsEstimated) : null,
      eps_actual: r.eps != null ? Number(r.eps) : null,
      expected_move_percent: null,
      market_cap: null,
      sector: null,
      score: null,
      class: 'C',
      source: 'fmp_direct',
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
    const result = await pool.query(
      `SELECT
         symbol,
         report_date::text AS report_date
       FROM earnings_events
       ORDER BY report_date ASC
       LIMIT 50`
    );

    return res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: 'EARNINGS_MINIMAL_FETCH_FAILED',
      message: err.message,
      data: [],
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
        return res.status(200).json({ success: true, data: fmpRows, count: fmpRows.length, source: 'fmp_direct', rows: fmpRows });
      }
      return res.status(200).json(fallbackCalendarPayload({ message: 'schema_unavailable' }));
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
        return res.status(200).json({ success: true, data: fmpRows, count: fmpRows.length, source: 'fmp_direct', rows: fmpRows });
      }
      return res.status(200).json(fallbackCalendarPayload({ message: 'schema_lookup_failed' }));
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
        ${selectColumn(schemaMap, 'earnings_events', 'e', 'rev_estimate')} AS rev_estimate,
        ${selectColumn(schemaMap, 'earnings_events', 'e', 'rev_actual')} AS rev_actual,
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
        ${hasDecisionView ? "(to_jsonb(d)->>'trade_class')" : 'NULL'} AS decision_trade_class
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
      rev_estimate,
      rev_actual,
      sector,
      price,
      market_cap,
      volume,
      relative_volume AS rvol,
      atr,
      final_score,
      decision_execution_plan,
      decision_trade_class,
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
        return res.status(200).json({ success: true, data: fmpRows, count: fmpRows.length, source: 'fmp_direct', rows: fmpRows });
      }
      return res.status(200).json(fallbackCalendarPayload({ message: 'db_query_failed' }));
    }

    if (dbRows.length === 0) {
      const fmpRows = await fmpEarningsFallback(from, to);
      if (fmpRows.length > 0) {
        return res.status(200).json({ success: true, data: fmpRows, count: fmpRows.length, source: 'fmp_direct', rows: fmpRows });
      }
    }

    let enriched = dbRows.map((row) => {

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
        revenue_estimate: row.rev_estimate,
        revenue_actual: row.rev_actual,
        surprise: row.eps_surprise_pct,
        sector: row.sector,
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
      external_status: 'db_only',
      external_source: 'market_quotes',
    });

    return res.status(200).json({
      success: true,
      mode: 'requested_window',
      window_start: from,
      window_end: to,
      count: enriched.length,
      status: enriched.length ? 'ok' : 'no_data',
      source: 'earnings_calendar',
      data: enriched,
      message: enriched.length ? '' : 'No earnings data available',
    });
  } catch (err) {
    console.error('[EARNINGS ERROR]', {
      message: err?.message,
      stack: err?.stack,
    });

    return res.status(200).json(
      fallbackCalendarPayload({
        message: 'No earnings data available — safe fallback',
      }),
    );
  }
});

router.get('/api/earnings/health', async (req, res) => {
  let db = 'ok';
  let external = 'ok';

  try {
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
