require('dotenv').config({ path: '/Users/jamesharris/Server/server/.env' });

const fs = require('fs');
const pool = require('../db/pool');

const OUTPUT_PATH = '/Users/jamesharris/Server/logs/full_system_audit.json';
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:3001';

const INVENTORY_TABLES = [
  'signals',
  'trade_setups',
  'signal_outcomes',
  'trade_outcomes',
  'market_metrics',
  'news_articles',
  'earnings_events',
  'stocks_in_play',
];

function qid(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pct(numerator, denominator) {
  if (!denominator || denominator <= 0) return null;
  return Number(((numerator / denominator) * 100).toFixed(4));
}

function flattenObject(value, prefix = '', out = {}) {
  if (value === null || value === undefined) {
    if (prefix) out[prefix] = value;
    return out;
  }
  if (Array.isArray(value)) {
    if (prefix) out[prefix] = value;
    return out;
  }
  if (typeof value !== 'object') {
    if (prefix) out[prefix] = value;
    return out;
  }

  const entries = Object.entries(value);
  if (entries.length === 0 && prefix) {
    out[prefix] = value;
    return out;
  }

  for (const [key, child] of entries) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flattenObject(child, next, out);
    } else {
      out[next] = child;
    }
  }
  return out;
}

function unique(values) {
  return Array.from(new Set(values));
}

function getHeaders() {
  const headers = { Accept: 'application/json' };
  if (process.env.PROXY_API_KEY) headers['x-api-key'] = process.env.PROXY_API_KEY;
  return headers;
}

async function fetchJson(path) {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: getHeaders(),
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { url, status: response.status, ok: response.ok, json };
}

function resolveFieldMapping(field, mappings) {
  if (mappings[field]) return mappings[field];

  for (const key of Object.keys(mappings)) {
    if (!key.includes('*')) continue;
    const regex = new RegExp(`^${key.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]+')}$`);
    if (regex.test(field)) return mappings[key];
  }

  return null;
}

async function tableExists(pool, tableName) {
  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema='public' AND table_name=$1
     ) AS exists`,
    [tableName]
  );
  return Boolean(result.rows?.[0]?.exists);
}

async function getTableColumns(pool, tableName) {
  const result = await pool.query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1
     ORDER BY ordinal_position`,
    [tableName]
  );
  return result.rows || [];
}

async function getTableCount(pool, tableName) {
  const result = await pool.query(`SELECT COUNT(*)::bigint AS c FROM ${qid(tableName)}`);
  return Number(result.rows?.[0]?.c || 0);
}

async function getColumnNullStats(pool, tableName, columnName) {
  const sql = `SELECT COUNT(*)::bigint AS total,
                      COUNT(*) FILTER (WHERE ${qid(columnName)} IS NULL)::bigint AS nulls
               FROM ${qid(tableName)}`;
  const result = await pool.query(sql);
  const total = Number(result.rows?.[0]?.total || 0);
  const nulls = Number(result.rows?.[0]?.nulls || 0);
  return { total, nulls, null_pct: pct(nulls, total) };
}

async function buildSchemaInventory(pool, report) {
  const inventory = {};
  for (const tableName of INVENTORY_TABLES) {
    const exists = await tableExists(pool, tableName);
    if (!exists) {
      inventory[tableName] = {
        exists: false,
        row_count: 0,
        columns: [],
      };
      report.critical_errors.push(`Missing table: ${tableName}`);
      continue;
    }

    const columns = await getTableColumns(pool, tableName);
    const rowCount = await getTableCount(pool, tableName);
    const colStats = [];

    for (const col of columns) {
      const stats = await getColumnNullStats(pool, tableName, col.column_name);
      colStats.push({
        column: col.column_name,
        data_type: col.data_type,
        null_pct: stats.null_pct,
        null_count: stats.nulls,
      });
    }

    inventory[tableName] = {
      exists: true,
      row_count: rowCount,
      columns: colStats,
    };
  }
  return inventory;
}

function pickSampleRows(endpointKey, payload) {
  if (!payload || typeof payload !== 'object') return [];
  switch (endpointKey) {
    case '/api/screener':
      return Array.isArray(payload.rows) ? payload.rows.slice(0, 5) : [];
    case '/api/market/quotes':
      return Array.isArray(payload.data) ? payload.data.slice(0, 5) : [];
    case '/api/market/overview':
      return [payload];
    case '/api/signals':
      return Array.isArray(payload.data) ? payload.data.slice(0, 5) : [];
    case '/api/intelligence/decision/:symbol':
      return payload.decision ? [payload.decision] : [];
    case '/api/intelligence/top-opportunities':
      return Array.isArray(payload.results) ? payload.results.slice(0, 5) : [];
    case '/api/earnings/calendar':
      return Array.isArray(payload.data) ? payload.data.slice(0, 5) : [];
    default:
      return [];
  }
}

function getFieldMappings() {
  return {
    '/api/screener': {
      symbol: { source: 'market_metrics.symbol' },
      price: { source: 'market_metrics.price' },
      change_percent: { source: 'market_metrics.change_percent' },
      relative_volume: { source: 'market_metrics.relative_volume' },
      volume: { source: 'market_metrics.volume' },
    },
    '/api/market/quotes': {
      symbol: { source: 'market_quotes.symbol' },
      price: { computed: 'COALESCE(market_quotes.price, daily_ohlc.close)', inputs: ['market_quotes.price', 'daily_ohlc.close'] },
      change_percent: { source: 'market_quotes.change_percent' },
      volume: { source: 'market_quotes.volume' },
      relative_volume: { computed: 'market_metrics.relative_volume OR market_quotes.volume / market_metrics.avg_volume_30d', inputs: ['market_metrics.relative_volume', 'market_quotes.volume', 'market_metrics.avg_volume_30d'] },
      atr: { source: 'market_metrics.atr' },
      rsi: { source: 'market_metrics.rsi' },
      market_cap: { source: 'market_quotes.market_cap' },
      sector: { source: 'market_quotes.sector' },
      updated_at: { source: 'market_quotes.updated_at' },
      source: { computed: 'constant authorititative_db', inputs: [] },
    },
    '/api/market/overview': {
      'indices.*.symbol': { source: 'market_metrics.symbol' },
      'indices.*.price': { computed: 'market_metrics.price fallback market_quotes.price', inputs: ['market_metrics.price', 'market_quotes.price'] },
      'indices.*.change_percent': { computed: 'market_metrics.change_percent fallback market_quotes.change_percent', inputs: ['market_metrics.change_percent', 'market_quotes.change_percent'] },
      'indices.*.volume': { computed: 'market_metrics.volume fallback market_quotes.volume', inputs: ['market_metrics.volume', 'market_quotes.volume'] },
      'volatility.VIX.symbol': { source: 'market_metrics.symbol' },
      'volatility.VIX.price': { computed: 'market_metrics.price fallback market_quotes.price', inputs: ['market_metrics.price', 'market_quotes.price'] },
      'volatility.VIX.change_percent': { computed: 'market_metrics.change_percent fallback market_quotes.change_percent', inputs: ['market_metrics.change_percent', 'market_quotes.change_percent'] },
      'breadth.advancers': { computed: 'COUNT market_metrics where change_percent > 0', inputs: ['market_metrics.change_percent'] },
      'breadth.decliners': { computed: 'COUNT market_metrics where change_percent < 0', inputs: ['market_metrics.change_percent'] },
      'breadth.up_volume': { computed: 'SUM market_metrics.volume where change_percent > 0', inputs: ['market_metrics.volume', 'market_metrics.change_percent'] },
      'breadth.down_volume': { computed: 'SUM market_metrics.volume where change_percent < 0', inputs: ['market_metrics.volume', 'market_metrics.change_percent'] },
    },
    '/api/signals': {
      id: { source: 'signals.id' },
      symbol: { source: 'signals.symbol' },
      signal_type: { source: 'signals.signal_type' },
      score: { source: 'signals.score' },
      confidence: { source: 'signals.confidence' },
      catalyst_ids: { source: 'signals.catalyst_ids' },
      created_at: { source: 'signals.created_at' },
    },
    '/api/intelligence/decision/:symbol': {
      symbol: { computed: 'normalized request symbol', inputs: [] },
      'why_moving.catalyst': { computed: 'trade_catalysts.headline fallback news_articles.headline', inputs: ['trade_catalysts.headline', 'news_articles.headline'] },
      'why_moving.catalyst_type': { computed: 'trade_catalysts.catalyst_type fallback news_articles.catalyst_type', inputs: ['trade_catalysts.catalyst_type', 'news_articles.catalyst_type'] },
      'why_moving.narrative': { computed: 'derived narrative from catalyst + type', inputs: ['trade_catalysts.headline', 'news_articles.headline', 'trade_catalysts.catalyst_type', 'news_articles.catalyst_type'] },
      'why_moving.confidence': { computed: 'derived from sentiment+recency+expected_move', inputs: ['trade_catalysts.sentiment', 'news_articles.sentiment', 'trade_outcomes.expected_move_percent'] },
      'tradeability.rvol': { source: 'market_metrics.relative_volume' },
      'tradeability.range_pct': { source: 'market_metrics.atr_percent' },
      'tradeability.liquidity_score': { computed: 'market_metrics.liquidity_surge fallback volume strength and opportunity_stream.score', inputs: ['market_metrics.liquidity_surge', 'market_metrics.volume', 'market_metrics.avg_volume_30d', 'opportunity_stream.score'] },
      'tradeability.tradeability_score': { computed: 'weighted composite', inputs: ['market_metrics.relative_volume', 'market_metrics.atr_percent', 'market_metrics.liquidity_surge', 'opportunity_stream.score'] },
      'execution_plan.strategy': { source: 'trade_setups.setup_type' },
      'execution_plan.entry_type': { computed: 'inferred from strategy', inputs: ['trade_setups.setup_type', 'trade_setups.setup'] },
      'execution_plan.risk_level': { computed: 'inferred from win_probability and tradeability_score', inputs: ['signal_outcomes.pnl_pct', 'trade_outcomes.pnl_pct', 'market_metrics.relative_volume'] },
      'execution_plan.expected_move': { source: 'trade_outcomes.expected_move_percent' },
      'execution_plan.win_probability': { computed: 'AVG signal_outcomes pnl/outcome', inputs: ['signal_outcomes.pnl_pct', 'signal_outcomes.outcome'] },
      'execution_plan.historical_win_rate': { computed: 'AVG trade_outcomes pnl/outcome', inputs: ['trade_outcomes.pnl_pct', 'trade_outcomes.outcome'] },
      'execution_plan.avg_pnl_pct': { computed: 'AVG trade_outcomes pnl_pct', inputs: ['trade_outcomes.pnl_pct'] },
      'execution_plan.avg_drawdown_pct': { computed: 'AVG trade_outcomes.max_drawdown_pct', inputs: ['trade_outcomes.max_drawdown_pct'] },
      'execution_plan.setup_candidates': { source: 'trade_setups.setup_type' },
      data_quality: { computed: 'engine quality flag', inputs: ['trade_setups.setup_type', 'signal_outcomes.pnl_pct', 'trade_outcomes.pnl_pct', 'signals.signal_type'] },
      decision_score: { computed: 'weighted score from why/tradeability/execution', inputs: ['market_metrics.relative_volume', 'signal_outcomes.pnl_pct', 'trade_outcomes.pnl_pct', 'trade_catalysts.sentiment', 'news_articles.sentiment'] },
    },
    '/api/intelligence/top-opportunities': {
      symbol: { source: 'decision_view.symbol' },
      final_score: { source: 'decision_view.final_score' },
      decision_score: { source: 'decision_view.decision_score' },
      boost_score: { source: 'decision_view.boost_score' },
      tqi_score: { source: 'decision_view.tqi_score' },
      strategy: { computed: 'derived strategy from detectStrategy / decision', inputs: ['decision_view.strategy', 'decision_view.earnings_signal', 'decision_view.gap_percent', 'decision_view.relative_volume'] },
      relative_volume: { source: 'decision_view.relative_volume' },
      catalyst_type: { computed: 'derived catalyst type', inputs: ['decision_view.news_score', 'decision_view.earnings_signal', 'decision_view.gap_percent'] },
      why_moving: { computed: 'derived narrative', inputs: ['decision_view.gap_percent', 'decision_view.news_score', 'decision_view.relative_volume'] },
      why_tradeable: { computed: 'derived narrative', inputs: ['decision_view.tqi_score', 'decision_view.quality_score', 'decision_view.trend_alignment'] },
      execution_plan: { computed: 'engine plan builder', inputs: ['decision_view.gap_percent', 'decision_view.earnings_signal'] },
      trade_quality: { computed: 'engine quality score', inputs: ['decision_view.tqi_score', 'decision_view.final_score'] },
      trade_confidence: { computed: 'normalized confidence', inputs: ['decision_view.decision_score', 'decision_view.tqi_score', 'decision_view.quality_score'] },
      data_quality: { computed: 'decision engine output', inputs: ['trade_setups.setup_type', 'signal_outcomes.pnl_pct', 'trade_outcomes.pnl_pct'] },
      earnings_flag: { computed: 'decision_view.earnings_signal or earnings_events proximity', inputs: ['decision_view.earnings_signal', 'earnings_events.report_date'] },
      news_count: { computed: 'context enrichment', inputs: ['news_articles.symbol'] },
      session_phase: { source: 'decision_view.session_phase' },
      regime: { computed: 'system_state.market_regime', inputs: ['system_state.state_value'] },
      explanation: { computed: 'derived explanation', inputs: ['decision_view.tqi_score', 'decision_view.strategy_win_rate', 'decision_view.session_phase'] },
    },
    '/api/earnings/calendar': {
      symbol: { source: 'earnings_events.symbol' },
      report_date: { source: 'earnings_events.report_date' },
      time: { computed: 'COALESCE earnings_events.report_time/time', inputs: ['earnings_events.report_time', 'earnings_events.time'] },
      price: { computed: 'COALESCE market_metrics.price, market_quotes.price, external quote', inputs: ['market_metrics.price', 'market_quotes.price'] },
      market_cap: { source: 'market_quotes.market_cap' },
      volume: { computed: 'COALESCE market_metrics.volume, market_quotes.volume, external quote', inputs: ['market_metrics.volume', 'market_quotes.volume'] },
      rvol: { source: 'market_metrics.relative_volume' },
      atr: { source: 'market_metrics.atr' },
      expected_move: { computed: 'earnings_events.expected_move_percent fallback atr/price', inputs: ['earnings_events.expected_move_percent', 'market_metrics.atr', 'market_metrics.price'] },
      expected_move_percent: { computed: 'same as expected_move', inputs: ['earnings_events.expected_move_percent', 'market_metrics.atr', 'market_metrics.price'] },
      final_score: { source: 'decision_view.final_score' },
      score: { computed: 'final_score fallback earnings_events.score', inputs: ['decision_view.final_score', 'earnings_events.score'] },
      eps_estimate: { source: 'earnings_events.eps_estimate' },
      eps_actual: { source: 'earnings_events.eps_actual' },
      revenue_estimate: { source: 'earnings_events.rev_estimate' },
      revenue_actual: { source: 'earnings_events.rev_actual' },
      surprise: { source: 'earnings_events.eps_surprise_pct' },
      sector: { source: 'earnings_events.sector' },
      trade_class: { computed: 'decision_view.trade_class fallback classifyEarningsTrade', inputs: ['decision_view.earnings_signal', 'market_metrics.relative_volume', 'market_quotes.market_cap'] },
      setup: { computed: 'classifyEarningsTrade setup', inputs: ['market_metrics.relative_volume', 'market_metrics.atr', 'market_quotes.market_cap'] },
      trade_confidence: { computed: 'classifyEarningsTrade confidence', inputs: ['market_metrics.relative_volume', 'market_metrics.atr', 'market_quotes.market_cap'] },
      trade_reason: { computed: 'classifyEarningsTrade reason', inputs: ['market_metrics.relative_volume', 'market_metrics.atr', 'market_quotes.market_cap'] },
      execution_plan: { computed: 'decision_view.execution_plan fallback buildExecutionPlan', inputs: ['decision_view.strategy', 'earnings_events.expected_move_percent'] },
      bias: { computed: 'deriveBias', inputs: ['earnings_events.eps_surprise_pct', 'earnings_events.rev_surprise_pct', 'market_metrics.change_percent'] },
    },
  };
}

async function getColumnHealth(pool, sourceRef, cache) {
  if (!sourceRef || !sourceRef.includes('.')) return null;
  const [table, column] = sourceRef.split('.');
  const key = `${table}.${column}`;
  if (cache[key]) return cache[key];

  const tableExistsResult = await pool.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name=$1
     ) AS exists`,
    [table]
  );
  const tableExistsFlag = Boolean(tableExistsResult.rows?.[0]?.exists);
  if (!tableExistsFlag) {
    cache[key] = { exists: false, table_exists: false, column_exists: false };
    return cache[key];
  }

  const colExistsResult = await pool.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name=$2
     ) AS exists`,
    [table, column]
  );

  const columnExists = Boolean(colExistsResult.rows?.[0]?.exists);
  if (!columnExists) {
    cache[key] = { exists: false, table_exists: true, column_exists: false };
    return cache[key];
  }

  const stats = await getColumnNullStats(pool, table, column);
  cache[key] = {
    exists: true,
    table_exists: true,
    column_exists: true,
    row_count: stats.total,
    null_pct: stats.null_pct,
    non_null_count: stats.total - stats.nulls,
  };
  return cache[key];
}

async function phasePipelineTrace(pool) {
  const q = await pool.query(
    `WITH
      s AS (
        SELECT id, UPPER(symbol) AS symbol
        FROM signals
      ),
      st AS (
        SELECT signal_id, UPPER(symbol) AS symbol
        FROM trade_setups
        WHERE signal_id IS NOT NULL
      ),
      so AS (
        SELECT signal_id, UPPER(symbol) AS symbol
        FROM signal_outcomes
        WHERE signal_id IS NOT NULL
      ),
      to1 AS (
        SELECT signal_id, UPPER(symbol) AS symbol
        FROM trade_outcomes
        WHERE signal_id IS NOT NULL
      )
     SELECT
       (SELECT COUNT(*)::int FROM s) AS signals_rows,
       (SELECT COUNT(*)::int FROM st) AS trade_setups_rows,
       (SELECT COUNT(*)::int FROM so) AS signal_outcomes_rows,
       (SELECT COUNT(*)::int FROM to1) AS trade_outcomes_rows,
       (SELECT COUNT(DISTINCT s.symbol)::int FROM s JOIN st ON st.signal_id = s.id) AS symbols_signals_to_setups,
       (SELECT COUNT(DISTINCT s.symbol)::int FROM s JOIN so ON so.signal_id = s.id) AS symbols_signals_to_signal_outcomes,
       (SELECT COUNT(DISTINCT s.symbol)::int FROM s JOIN to1 ON to1.signal_id = s.id) AS symbols_signals_to_trade_outcomes,
       (SELECT COUNT(DISTINCT s.symbol)::int FROM s JOIN st ON st.signal_id = s.id JOIN so ON so.signal_id = s.id JOIN to1 ON to1.signal_id = s.id) AS symbols_full_chain`
  );

  const row = q.rows?.[0] || {};
  return {
    ...row,
    pass_threshold_gt_50_symbols: Number(row.symbols_full_chain || 0) > 50,
  };
}

async function phaseDecisionEngineTruth(pool, report) {
  const symbolsResult = await pool.query(
    `SELECT symbol
     FROM (
       SELECT DISTINCT UPPER(symbol) AS symbol
       FROM signals
       WHERE symbol IS NOT NULL
     ) s
     ORDER BY RANDOM()
     LIMIT 10`
  );

  const symbols = (symbolsResult.rows || []).map((r) => String(r.symbol || '').toUpperCase()).filter(Boolean);
  const out = [];

  for (const symbol of symbols) {
    const endpoint = await fetchJson(`/api/intelligence/decision/${encodeURIComponent(symbol)}`);
    const decision = endpoint.json?.decision || {};

    const latestMM = await pool.query(
      `SELECT relative_volume, atr_percent, volume, avg_volume_30d, liquidity_surge
       FROM market_metrics
       WHERE UPPER(symbol) = $1
       ORDER BY COALESCE(updated_at, last_updated::timestamptz, NOW()) DESC
       LIMIT 1`,
      [symbol]
    );

    const latestSetup = await pool.query(
      `SELECT setup, setup_type, score
       FROM trade_setups
       WHERE UPPER(symbol) = $1
       ORDER BY COALESCE(updated_at, created_at, detected_at, NOW()) DESC
       LIMIT 1`,
      [symbol]
    );

    const latestSignalOutcome = await pool.query(
      `SELECT pnl_pct, outcome, evaluated_at
       FROM signal_outcomes
       WHERE UPPER(symbol) = $1
       ORDER BY COALESCE(evaluated_at, created_at, NOW()) DESC
       LIMIT 1`,
      [symbol]
    );

    const latestTradeOutcome = await pool.query(
      `SELECT pnl_pct, outcome, max_drawdown_pct, expected_move_percent
       FROM trade_outcomes
       WHERE UPPER(symbol) = $1
       ORDER BY COALESCE(evaluated_at, created_at, entry_time, NOW()) DESC
       LIMIT 1`,
      [symbol]
    );

    const latestCatalyst = await pool.query(
      `SELECT headline, catalyst_type, sentiment
       FROM trade_catalysts
       WHERE UPPER(symbol) = $1
       ORDER BY COALESCE(published_at, created_at, NOW()) DESC
       LIMIT 1`,
      [symbol]
    ).catch(() => ({ rows: [] }));

    const latestNews = await pool.query(
      `SELECT headline, catalyst_type, sentiment
       FROM news_articles
       WHERE UPPER(symbol) = $1
       ORDER BY COALESCE(published_at, created_at, NOW()) DESC
       LIMIT 1`,
      [symbol]
    ).catch(() => ({ rows: [] }));

    const dataInputs = {
      market_metrics: latestMM.rows?.[0] || null,
      trade_setups: latestSetup.rows?.[0] || null,
      signal_outcomes: latestSignalOutcome.rows?.[0] || null,
      trade_outcomes: latestTradeOutcome.rows?.[0] || null,
      trade_catalysts: latestCatalyst.rows?.[0] || null,
      news_articles: latestNews.rows?.[0] || null,
    };

    const nullFields = [];
    for (const [table, row] of Object.entries(dataInputs)) {
      if (!row) {
        nullFields.push(`${table}:no_row`);
        continue;
      }
      for (const [k, v] of Object.entries(row)) {
        if (v === null || v === undefined) nullFields.push(`${table}.${k}`);
      }
    }

    const hasExecutionPlan = decision.execution_plan != null;
    const hasDecisionScore = decision.decision_score != null;

    if (!hasExecutionPlan || !hasDecisionScore) {
      report.data_quality_issues.push(`Decision endpoint sparse for ${symbol}: execution_plan=${hasExecutionPlan}, decision_score=${hasDecisionScore}`);
    }

    out.push({
      symbol,
      endpoint_status: endpoint.status,
      execution_plan_present: hasExecutionPlan,
      decision_score_present: hasDecisionScore,
      data_quality_flag: decision.data_quality ?? null,
      null_input_fields: nullFields,
      input_rows_present: {
        market_metrics: Boolean(dataInputs.market_metrics),
        trade_setups: Boolean(dataInputs.trade_setups),
        signal_outcomes: Boolean(dataInputs.signal_outcomes),
        trade_outcomes: Boolean(dataInputs.trade_outcomes),
        trade_catalysts: Boolean(dataInputs.trade_catalysts),
        news_articles: Boolean(dataInputs.news_articles),
      },
    });
  }

  return out;
}

function uiMappings() {
  return {
    PreMarketCommand: {
      file_candidates: [
        'trading-os/src/components/terminal/dashboard-view.tsx',
        'trading-os/src/components/terminal/trading-terminal-view.tsx',
      ],
      displayed_fields: ['symbol', 'strategy', 'expected_move_percent', 'entry', 'stop_loss', 'take_profit'],
      endpoint: '/api/intelligence/top-opportunity',
      source: 'market_metrics + trade_setups + trade_catalysts + market_quotes (computed confidence)',
    },
    DecisionCard: {
      file_candidates: ['trading-os/src/components/terminal/research-view.tsx'],
      displayed_fields: ['bias', 'expectedMoveLabel', 'catalystType', 'probability', 'confidence'],
      endpoint: '/api/intelligence/markets + /api/news + /api/earnings/calendar (client-computed decision)',
      source: 'client-side buildStockDecision derived from overview/news/earnings',
    },
    TopOpportunities: {
      file_candidates: [
        'trading-os/src/components/terminal/trading-terminal-view.tsx',
        'trading-os/src/components/terminal/dashboard-view.tsx',
      ],
      displayed_fields: ['symbol', 'strategy', 'confidence_context_percent', 'expected_move_percent', 'entry', 'stop_loss', 'take_profit', 'rvol'],
      endpoint: '/api/intelligence/top-opportunity',
      source: 'trade_setups + market_metrics + trade_catalysts + market_quotes',
    },
    EarningsPage: {
      file_candidates: ['trading-os/src/components/terminal/earnings-view.tsx'],
      displayed_fields: ['symbol', 'event_date', 'time', 'market_cap', 'volume', 'expected_move', 'score', 'tradeability'],
      endpoint: '/api/earnings/calendar',
      source: 'earnings_events + decision_view + market_metrics + market_quotes + computed classification',
    },
  };
}

async function phaseUiTruth(pool, endpointContracts, report) {
  const ui = uiMappings();

  const topOppPayload = await fetchJson('/api/intelligence/top-opportunity');
  const topOppRows = Array.isArray(topOppPayload.json?.data) ? topOppPayload.json.data : [];
  const topOppFields = unique(topOppRows.slice(0, 5).flatMap((row) => Object.keys(flattenObject(row))));

  const earningsFields = endpointContracts['/api/earnings/calendar']?.fields || [];

  const out = {};

  for (const [surface, config] of Object.entries(ui)) {
    const surfaceOut = {
      files: config.file_candidates,
      displayed_fields: config.displayed_fields,
      endpoint: config.endpoint,
      source: config.source,
      backed_fields: [],
      unbacked_fields: [],
    };

    let backingFieldSet = [];
    if (surface === 'EarningsPage') {
      backingFieldSet = earningsFields;
    } else if (surface === 'TopOpportunities' || surface === 'PreMarketCommand') {
      backingFieldSet = topOppFields;
    } else if (surface === 'DecisionCard') {
      backingFieldSet = ['price', 'change_percent', 'volume', 'headline', 'source', 'expected_move', 'actual_move', 'probability', 'confidence'];
    }

    for (const f of config.displayed_fields) {
      const exists = backingFieldSet.some((bf) => bf === f || bf.endsWith(`.${f}`) || bf.includes(f));
      if (exists) {
        surfaceOut.backed_fields.push(f);
      } else {
        surfaceOut.unbacked_fields.push(f);
        report.field_mismatches.push(`${surface}: UI field '${f}' has no direct endpoint field match`);
      }
    }

    if (surface === 'PreMarketCommand') {
      const hasExplicitComponent = false;
      if (!hasExplicitComponent) {
        report.critical_errors.push('PreMarketCommand component not found by explicit name; potential UI surface drift');
      }
    }

    out[surface] = surfaceOut;
  }

  return out;
}

async function phaseDataTruthTest(endpointContracts, report) {
  const contract = endpointContracts['/api/intelligence/top-opportunities'];
  const rows = contract?.sample_rows || [];
  const sample10 = rows.slice(0, 10);
  const findings = [];

  for (const row of sample10) {
    const symbol = String(row.symbol || '').toUpperCase();
    const change = asNumber(row.change_percent);
    const rvol = asNumber(row.relative_volume);
    const hasCatalyst = Boolean(
      (asNumber(row.news_score) || 0) > 0
      || Boolean(row.earnings_flag)
      || (String(row.catalyst_type || '').toUpperCase() !== 'OTHER' && String(row.catalyst_type || '').trim() !== '')
    );

    const issues = [];
    if (!(Number.isFinite(change) && Math.abs(change) > 0)) issues.push('not_actively_moving');
    if (!(Number.isFinite(rvol) && rvol > 0)) issues.push('no_relative_volume');
    if (!hasCatalyst) issues.push('missing_catalyst');

    if (issues.length) {
      findings.push({ symbol, issues });
      report.data_quality_issues.push(`Top opportunity ${symbol} flagged: ${issues.join(', ')}`);
    }
  }

  return {
    tested: sample10.length,
    issues: findings,
  };
}

async function main() {
  const report = {
    timestamp: new Date().toISOString(),
    schema_health: {},
    endpoint_contracts: {},
    field_mismatches: [],
    pipeline_status: {},
    decision_engine_truth: {},
    ui_truth: {},
    data_quality_issues: [],
    critical_errors: [],
    verdict: 'PASS',
    metadata: {
      api_base: API_BASE,
      audited_endpoints: [
        '/api/screener',
        '/api/market/quotes',
        '/api/market/overview',
        '/api/signals',
        '/api/intelligence/decision/:symbol',
        '/api/intelligence/top-opportunities',
        '/api/earnings/calendar',
      ],
    },
  };

  try {
    // Phase 1
    report.schema_health = await buildSchemaInventory(pool, report);

    // Prepare symbol for decision endpoint
    const symbolResult = await pool.query(
      `SELECT UPPER(symbol) AS symbol
       FROM signals
       WHERE symbol IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`
    );
    const decisionSymbol = String(symbolResult.rows?.[0]?.symbol || 'AAPL').toUpperCase();

    // Phase 2
    const endpoints = [
      { key: '/api/screener', path: '/api/screener' },
      { key: '/api/market/quotes', path: '/api/market/quotes?symbols=SPY,QQQ,MSFT,AAPL,NVDA' },
      { key: '/api/market/overview', path: '/api/market/overview' },
      { key: '/api/signals', path: '/api/signals?limit=5' },
      { key: '/api/intelligence/decision/:symbol', path: `/api/intelligence/decision/${encodeURIComponent(decisionSymbol)}` },
      { key: '/api/intelligence/top-opportunities', path: '/api/intelligence/top-opportunities?limit=10' },
      { key: '/api/earnings/calendar', path: '/api/earnings/calendar?limit=5' },
    ];

    const fieldMappings = getFieldMappings();
    const columnHealthCache = {};

    for (const ep of endpoints) {
      const payload = await fetchJson(ep.path);
      const sampleRows = pickSampleRows(ep.key, payload.json);
      const flattenedFields = unique(sampleRows.flatMap((row) => Object.keys(flattenObject(row)))).sort();

      const mapping = fieldMappings[ep.key] || {};
      const fieldContract = [];

      for (const field of flattenedFields) {
        const map = resolveFieldMapping(field, mapping);
        if (!map) {
          report.critical_errors.push(`${ep.key}: field '${field}' has no source mapping`);
          fieldContract.push({ field, mapped: false, source: null, computed: null });
          continue;
        }

        let sourceHealth = null;
        if (map.source) {
          sourceHealth = await getColumnHealth(pool, map.source, columnHealthCache);
          if (!sourceHealth.exists) {
            report.critical_errors.push(`${ep.key}: mapped source missing for field '${field}' -> ${map.source}`);
          } else if (sourceHealth.null_pct === 100) {
            report.data_quality_issues.push(`${ep.key}: source always null for field '${field}' -> ${map.source}`);
          }
        }

        if (map.computed && Array.isArray(map.inputs)) {
          for (const input of map.inputs) {
            if (!input.includes('.')) continue;
            const health = await getColumnHealth(pool, input, columnHealthCache);
            if (!health.exists) {
              report.data_quality_issues.push(`${ep.key}: computed field '${field}' depends on missing input ${input}`);
            } else if (health.null_pct === 100) {
              report.data_quality_issues.push(`${ep.key}: computed field '${field}' depends on always-null input ${input}`);
            }
          }
        }

        fieldContract.push({
          field,
          mapped: true,
          source: map.source || null,
          computed: map.computed || null,
          source_health: sourceHealth,
        });
      }

      report.endpoint_contracts[ep.key] = {
        request_path: ep.path,
        status: payload.status,
        sample_rows: sampleRows,
        fields: flattenedFields,
        field_contract: fieldContract,
      };

      if (!payload.ok) {
        report.critical_errors.push(`${ep.key}: non-200 response (${payload.status})`);
      }
    }

    // Phase 3
    // Field validation has been merged into endpoint field_contract/source_health and data_quality_issues.

    // Phase 4
    report.pipeline_status = await phasePipelineTrace(pool);
    if (!report.pipeline_status.pass_threshold_gt_50_symbols) {
      report.critical_errors.push(`PIPELINE BREAK: full chain symbols ${report.pipeline_status.symbols_full_chain} <= 50`);
    }

    // Phase 5
    report.decision_engine_truth = await phaseDecisionEngineTruth(pool, report);

    // Phase 6
    report.ui_truth = await phaseUiTruth(pool, report.endpoint_contracts, report);

    // Phase 7
    report.data_truth_test = await phaseDataTruthTest(report.endpoint_contracts, report);

    // Phase 8
    const schemaGaps = {
      missing_required_columns: [],
      duplicate_semantic_fields: [],
      unused_tables: [],
    };

    const requiredColumns = [
      'signals.id',
      'signals.symbol',
      'trade_setups.signal_id',
      'signal_outcomes.signal_id',
      'trade_outcomes.signal_id',
      'market_metrics.relative_volume',
      'earnings_events.report_date',
    ];

    for (const ref of requiredColumns) {
      const health = await getColumnHealth(pool, ref, columnHealthCache);
      if (!health.exists) {
        schemaGaps.missing_required_columns.push(ref);
      }
    }

    schemaGaps.duplicate_semantic_fields.push({
      group: 'relative_volume',
      variants: ['rvol (UI/backend alias)', 'relative_volume (DB canonical)'],
      note: 'Aliasing exists across UI and API responses.',
    });

    for (const tableName of INVENTORY_TABLES) {
      const tableInfo = report.schema_health[tableName];
      if (tableInfo && tableInfo.exists && Number(tableInfo.row_count || 0) === 0) {
        schemaGaps.unused_tables.push(tableName);
      }
    }

    report.schema_gaps = schemaGaps;

    for (const missing of schemaGaps.missing_required_columns) {
      report.critical_errors.push(`Schema gap: missing required column ${missing}`);
    }

    if (report.critical_errors.length > 0) {
      report.verdict = 'FAIL';
    }

    await fs.promises.writeFile(OUTPUT_PATH, JSON.stringify(report, null, 2));
    console.log('SYSTEM AUDIT COMPLETE');
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch(async (error) => {
  const fallback = {
    timestamp: new Date().toISOString(),
    schema_health: {},
    endpoint_contracts: {},
    field_mismatches: [],
    pipeline_status: {},
    decision_engine_truth: {},
    ui_truth: {},
    data_quality_issues: [error.message],
    critical_errors: [error.message],
    verdict: 'FAIL',
  };
  await fs.promises.writeFile(OUTPUT_PATH, JSON.stringify(fallback, null, 2));
  console.log('SYSTEM AUDIT COMPLETE');
  process.exit(1);
});
