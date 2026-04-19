const express = require('express');
const { pool, queryWithTimeout } = require('../db/pg');
const { getResearchTerminalPayload } = require('../services/researchCacheService');
const { buildEarningsEdge: buildEarningsEdgeEngine } = require('../engines/earningsEdgeEngine');
const { generateWhyMovingPayload } = require('../engines/whyMovingEngine');
const authMiddleware = require('../middleware/auth');
const { getMarketMode, getModeWindow, getModeMinConfidence } = require('../utils/marketMode');
const { bridgeNewsletterEmailToIntelNews } = require('../services/emailIntelBridge');
const { ensureEarlyAccumulationTable } = require('../engines/earlyAccumulationEngine');
const { ensureEarlySignalOutcomesTable } = require('../engines/earlySignalOutcomeEngine');
const { ensureOrderFlowSignalsTable } = require('../engines/orderFlowImbalanceEngine');
const { ensureSectorMomentumTable } = require('../engines/sectorMomentumEngine');
const { runShortSqueezeEngine, listLatestSqueezeSignals } = require('../engines/shortSqueezeEngine');
const { runFlowDetectionEngine, listLatestFlowSignals } = require('../engines/flowDetectionEngine');
const { runMarketNarrativeEngine, getLatestMarketNarrative } = require('../engines/marketNarrativeEngine');
const { buildDecision } = require('../services/intelligenceDecisionEngine');
const { ingestIntelInboxMessage } = require('../services/intelParser');
const { completenessScore } = require('../utils/dataCompleteness');
const { tradeQualityScore } = require('../utils/tradeQuality');
const { selectTopOpportunities, computeLevels } = require('../services/tradeSelectionEngine');
const { getCurrentRegime } = require('../services/marketRegimeEngine');
const { buildNarrative } = require('../utils/intelligenceNarrative');
const { enrichOpportunity } = require('../utils/enrichOpportunity');
const { supabaseClient } = require('../services/supabaseClient');
const { calculateTradeQualityScore, buildTruthDecisionForSymbol } = require('../services/truthEngine');
const { analyzeDecisionFailures } = require('../services/signalDiagnostics');
const { getSessionContext, applySessionGating, applySessionWeighting } = require('../utils/sessionEngine');
const { buildFinalTradeObject } = require('../engines/finalTradeBuilder');
const { validateTrade } = require('../utils/validateTrade');
const { buildEarningsIntelligence, calculateDrift } = require('../services/earningsIntelligence');
const { getLatestOpportunitiesPayload } = require('../v2/services/snapshotService');

const router = express.Router();
const whyMovingCache = new Map();
const WHY_MOVING_CACHE_TTL_MS = 30 * 1000;
const decisionCache = new Map();
const DECISION_CACHE_TTL_MS = 5 * 60 * 1000;
const DECISION_ROUTE_TIMEOUT_MS = 60 * 1000;

const INTEL_KEY = process.env.INTEL_INGEST_KEY;

function requireIntelKey(req, res, next) {
  const provided = req.get('x-intel-key');
  if (!INTEL_KEY) {
    return res.status(503).json({ ok: false, error: 'INTEL_INGEST_KEY not configured on server' });
  }
  if (!provided || provided !== INTEL_KEY) {
    return res.status(401).json({ ok: false, error: 'Invalid or missing x-intel-key' });
  }
  next();
}

function detectSource(sender, subject) {
  if (!sender && !subject) return 'unknown';
  const combined = `${sender || ''} ${subject || ''}`.toLowerCase();
  if (combined.includes('briefing') || combined.includes('morning')) return 'briefing';
  if (combined.includes('alert') || combined.includes('breaking')) return 'alert';
  if (combined.includes('newsletter') || combined.includes('digest')) return 'newsletter';
  if (combined.includes('earnings') || combined.includes('report')) return 'earnings';
  if (combined.includes('analyst') || combined.includes('upgrade') || combined.includes('downgrade')) return 'analyst';
  return 'general';
}

function detectPublisherName(sender, subject) {
  const text = `${sender || ''} ${subject || ''}`.toLowerCase();
  if (text.includes('benzinga')) return 'Benzinga';
  if (text.includes('seeking alpha')) return 'Seeking Alpha';
  if (text.includes('briefing')) return 'Briefing.com';
  if (text.includes('marketwatch')) return 'MarketWatch';
  if (text.includes('bloomberg')) return 'Bloomberg';
  if (text.includes('reuters')) return 'Reuters';
  if (text.includes('cnbc')) return 'CNBC';
  if (text.includes('wsj') || text.includes('wall street journal')) return 'Wall Street Journal';
  if (text.includes('newsletter') || text.includes('digest')) return 'Newsletter';
  if (sender) return String(sender).split('@')[0] || sender;
  return 'Unknown publisher';
}

function logResponseShape(endpoint, rows, criticalFields = []) {
  const list = Array.isArray(rows) ? rows : [];
  const sample = list[0] && typeof list[0] === 'object' ? list[0] : null;
  const missingFields = new Set();

  if (!sample) {
    for (const field of criticalFields) missingFields.add(`${field}:undefined`);
  } else {
    for (const [key, value] of Object.entries(sample)) {
      if (value === undefined) missingFields.add(`${key}:undefined`);
    }
    for (const field of criticalFields) {
      if (!(field in sample)) {
        missingFields.add(`${field}:undefined`);
      } else if (sample[field] == null) {
        missingFields.add(`${field}:null`);
      }
    }
  }

  console.log('[RESPONSE_SHAPE]', {
    endpoint,
    row_count: list.length,
    missing_fields: Array.from(missingFields),
  });
}

function getCachedDecision(symbol) {
  const cached = decisionCache.get(symbol);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    decisionCache.delete(symbol);
    return null;
  }

  return cached.value;
}

function getStaleCachedDecision(symbol) {
  const cached = decisionCache.get(symbol);
  if (!cached) {
    return null;
  }

  return cached.value;
}

function setCachedDecision(symbol, value) {
  decisionCache.set(symbol, {
    value,
    expiresAt: Date.now() + DECISION_CACHE_TTL_MS,
  });
}

async function sendDecisionResponse(symbol, res) {
  console.log('[DECISION ROUTE HIT]', symbol);
  const cached = getCachedDecision(symbol);
  const staleCached = cached || getStaleCachedDecision(symbol);
  let decision = cached;

  if (!decision) {
    try {
      decision = await withTimeout(
        buildTruthDecisionForSymbol(symbol, {
          allowRemoteNarrative: false,
        }),
        DECISION_ROUTE_TIMEOUT_MS,
        `Decision build timed out for ${symbol}`
      );
      if (!decision?.degraded) {
        setCachedDecision(symbol, decision);
      } else if (staleCached && !staleCached.degraded) {
        decision = staleCached;
      }
    } catch (error) {
      if (staleCached && !staleCached.degraded) {
        decision = staleCached;
      } else {
      const fallbackDecision = {
        symbol,
        tradeable: false,
        setup: 'INSUFFICIENT_DATA',
        driver: 'UNKNOWN',
        risk_flags: ['TIMEOUT'],
        action: 'AVOID',
        trade_class: 'UNTRADEABLE',
        degraded: true,
        source: 'route_fallback',
        why_moving: 'Decision unavailable within the response budget.',
        how_to_trade: 'No trade. Re-run after the intelligence engines refresh.',
        data_quality: 'insufficient',
      };

      logResponseShape('/api/intelligence/decision', [fallbackDecision], ['symbol', 'tradeable', 'setup', 'driver', 'risk_flags']);
      return res.json({
        ok: true,
        status: 'degraded',
        source: fallbackDecision.source,
        data: [fallbackDecision],
        decision: fallbackDecision,
        meta: {
          fallback: true,
          reason: 'timeout',
        },
      });
      }
    }
  }

  logResponseShape('/api/intelligence/decision', [decision], ['symbol', 'tradeable', 'setup', 'driver', 'risk_flags']);
  const responseStatus = decision?.degraded ? 'degraded' : 'ok';
  return res.json({
    ok: true,
    status: responseStatus,
    source: decision?.source || 'truth_engine',
    data: [decision],
    decision,
  });
}

function buildOpportunityExplanation({ tqiScore, winRate, regime, sessionPhase, hasEarnings }) {
  const parts = [];
  if (Number.isFinite(Number(tqiScore)) && Number(tqiScore) >= 70) {
    parts.push('High TQI');
  }
  if (Number.isFinite(Number(winRate)) && Number(winRate) >= 0.55) {
    parts.push('Strong historical performance');
  }
  if (hasEarnings) {
    parts.push('Earnings proximity');
  }
  if (typeof regime === 'string' && regime.trim()) {
    parts.push(`Regime: ${regime}`);
  }
  if (typeof sessionPhase === 'string' && sessionPhase.trim()) {
    parts.push(`Session: ${sessionPhase}`);
  }

  if (parts.length === 0) return 'Baseline setup with insufficient elevated catalysts';
  return parts.join(' + ');
}

function detectCatalystType({ hasEarningsSoon, gapPercent, newsScore, relativeVolume }) {
  if (hasEarningsSoon) return 'EARNINGS';
  if (gapPercent >= 5 && newsScore >= 1) return 'NEWS + GAP';
  if (relativeVolume >= 3) return 'VOLUME EXPANSION';
  if (gapPercent >= 3) return 'TECHNICAL GAP';
  return 'OTHER';
}

function detectStrategy({ hasEarningsSoon, gapPercent, relativeVolume }) {
  if (hasEarningsSoon) return 'POST-EARNINGS MOMENTUM';
  if (gapPercent >= 5 && relativeVolume >= 3) return 'MOMENTUM BREAKOUT';
  if (relativeVolume >= 3 && gapPercent < 5) return 'VWAP RECLAIM';
  if (gapPercent >= 3 && gapPercent < 5) return 'ORB (OPEN RANGE BREAK)';
  return 'INTRADAY TREND';
}

function buildExecutionPlan({ strategy, gapPercent }) {
  let entry = 'Trend continuation';
  let stop = 'Recent support';

  if (strategy === 'MOMENTUM BREAKOUT') {
    entry = 'Break of premarket high';
    stop = 'Below premarket consolidation';
  } else if (strategy === 'VWAP RECLAIM') {
    entry = 'Reclaim of VWAP with volume';
    stop = 'Below VWAP';
  } else if (strategy === 'ORB (OPEN RANGE BREAK)') {
    entry = 'Break of 5-min high';
    stop = 'Below opening range';
  } else if (strategy === 'POST-EARNINGS MOMENTUM') {
    entry = 'Continuation after pullback';
    stop = 'Recent support';
  }

  const target = gapPercent >= 5
    ? 'Gap fill extension / next resistance'
    : '2R minimum';

  return { entry, stop, target };
}

function toShortHowToTrade(plan) {
  return `Entry: ${plan.entry}. Stop: ${plan.stop}. Target: ${plan.target}.`;
}

function normalizeTo100(values) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const nums = values.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0));
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (max === min) {
    throw new Error('SCORE COLLAPSE DETECTED');
  }
  return nums.map((v) => Number((((v - min) / (max - min)) * 100).toFixed(4)));
}

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function normalizeStrategyKey(strategy) {
  return String(strategy || 'unknown').trim().toUpperCase();
}

function normalizeConfidenceUnit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const unit = n > 1 ? (n / 100) : n;
  return Math.max(0, Math.min(1, unit));
}

async function runWithConcurrency(items, worker, concurrency = 8) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const maxConcurrency = Math.max(1, Math.min(Number(concurrency) || 1, items.length));
  const out = new Array(items.length);
  let index = 0;

  async function runNext() {
    while (index < items.length) {
      const current = index;
      index += 1;
      out[current] = await worker(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: maxConcurrency }, () => runNext()));
  return out;
}

async function getSnapshotTopOpportunitiesFallback(limit) {
  try {
    const payload = await withTimeout(getLatestOpportunitiesPayload(), 1200, 'top-opportunities snapshot timeout');
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return rows
      .map((row) => ({
        symbol: String(row?.symbol || '').trim().toUpperCase(),
        why: String(row?.why || row?.why_moving || '').trim(),
        how: String(row?.how || row?.how_to_trade || '').trim(),
        confidence: Number(row?.confidence ?? 0),
        expected_move: Number(row?.expected_move ?? row?.expected_move_percent),
      }))
      .filter((row) => row.symbol && row.why && row.how && Number.isFinite(row.expected_move))
      .slice(0, limit);
  } catch (_error) {
    return [];
  }
}

async function getStocksInPlayTopOpportunities(limit) {
  const result = await queryWithTimeout(
    `WITH dedup AS (
       SELECT DISTINCT ON (UPPER(symbol))
              UPPER(symbol) AS symbol,
              score,
              gap_percent,
              COALESCE(relative_volume, rvol) AS relative_volume,
              catalyst,
              updated_at
       FROM stocks_in_play_filtered
       WHERE symbol IS NOT NULL
         AND TRIM(symbol) <> ''
       ORDER BY UPPER(symbol), score DESC NULLS LAST
     )
     SELECT *
     FROM dedup
     ORDER BY score DESC NULLS LAST, ABS(COALESCE(gap_percent, 0)) DESC NULLS LAST
     LIMIT $1`,
    [Math.max(limit, 20)],
    {
      timeoutMs: 1500,
      maxRetries: 0,
      slowQueryMs: 1000,
      label: 'api.intelligence.top_opportunities.stocks_in_play',
    }
  ).catch(() => ({ rows: [] }));

  return (result.rows || []).map((row, index) => {
    const symbol = String(row.symbol || '').trim().toUpperCase();
    const gapPercent = Number(row.gap_percent || 0);
    const relativeVolume = Number(row.relative_volume || 0);
    const catalyst = String(row.catalyst || '').trim();
    const confidence = Number.isFinite(Number(row.score))
      ? Math.max(25, Math.min(99, Number(row.score)))
      : Math.max(25, 80 - index * 2);
    const expectedMove = Number.isFinite(gapPercent) && gapPercent !== 0
      ? Math.abs(gapPercent)
      : Number.isFinite(relativeVolume) && relativeVolume > 0
        ? Number((relativeVolume * 2).toFixed(2))
        : 1;

    return {
      symbol,
      why: catalyst
        ? `${symbol} remains active in stocks in play with ${catalyst}.`
        : `${symbol} remains active in stocks in play with a ${gapPercent.toFixed(2)}% gap and ${relativeVolume.toFixed(2)}x relative volume.`,
      how: relativeVolume >= 3
        ? 'Monitor for continuation through VWAP and intraday highs before entering.'
        : 'Wait for confirmation at key intraday levels before entering.',
      confidence,
      expected_move: expectedMove,
    };
  }).filter((row) => row.symbol && Number.isFinite(row.expected_move));
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  if (!Number.isFinite(Number(timeoutMs)) || Number(timeoutMs) <= 0) {
    return promise;
  }

  const ms = Number(timeoutMs);
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage || `Operation timed out after ${ms}ms`)), ms);
    }),
  ]);
}

function getConfidenceBucket(confidenceUnit) {
  return Math.floor(normalizeConfidenceUnit(confidenceUnit) * 10) * 10;
}

function getFreshCachedValue(cache, key, ttlMs) {
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

function evaluateOutcome(row, move) {
  const atr = Number.isFinite(Number(row?.atr_percent)) ? Number(row.atr_percent) : 2;
  let expectedMove = atr;
  const strategy = normalizeStrategyKey(row?.strategy || row?.setup_type);

  if (strategy.includes('ORB')) expectedMove = atr * 0.8;
  if (strategy.includes('VWAP')) expectedMove = atr;
  if (strategy.includes('D2C')) expectedMove = atr * 1.5;

  if (move > expectedMove) return 'WIN';
  if (move < (-expectedMove * 0.5)) return 'LOSS';
  return 'NEUTRAL';
}

function evaluateOutcomeWithTiming(row, move, nowMs = Date.now()) {
  const createdAtMs = row?.created_at ? new Date(row.created_at).getTime() : null;
  const ageMinutes = Number.isFinite(createdAtMs)
    ? (nowMs - createdAtMs) / 60000
    : Number.POSITIVE_INFINITY;

  if (ageMinutes < 5) return 'TOO_EARLY';
  return evaluateOutcome(row, move);
}

function adjustConfidence(row, calibrationMap) {
  const confidence = normalizeConfidenceUnit(row?.confidence);
  const bucket = getConfidenceBucket(confidence);
  const calibration = calibrationMap?.[bucket];

  if (!calibration) return confidence;

  const ratio = Number(calibration.actual || 0) / (Number(calibration.predicted || 0) || 1);
  return Math.min(confidence * ratio, 1);
}

function buildCalibrationResults(outcomes) {
  const buckets = {};

  (outcomes || []).forEach((o) => {
    const bucket = getConfidenceBucket(o?.confidence);

    if (!buckets[bucket]) {
      buckets[bucket] = {
        total: 0,
        wins: 0,
      };
    }

    buckets[bucket].total += 1;
    if (String(o?.outcome || '').toUpperCase() === 'WIN') {
      buckets[bucket].wins += 1;
    }
  });

  return Object.keys(buckets)
    .map((b) => {
      const bucket = buckets[b];
      const actualWinRate = bucket.total > 0
        ? (bucket.wins / bucket.total) * 100
        : 0;

      return {
        confidence_bucket: Number(b),
        predicted: Number(b),
        actual: Math.round(actualWinRate),
        total: bucket.total,
        wins: bucket.wins,
      };
    })
    .sort((a, b) => Number(a.confidence_bucket || 0) - Number(b.confidence_bucket || 0));
}

function buildCalibrationMap(calibrationResults) {
  const map = {};
  (calibrationResults || []).forEach((r) => {
    const bucket = Number(r?.confidence_bucket);
    if (!Number.isFinite(bucket)) return;
    map[bucket] = {
      predicted: Number(r?.predicted || 0),
      actual: Number(r?.actual || 0),
      total: Number(r?.total || 0),
      wins: Number(r?.wins || 0),
    };
  });
  return map;
}

function buildStrategyRankingResults(outcomes) {
  const grouped = {};

  (outcomes || []).forEach((o) => {
    const strategy = normalizeStrategyKey(o?.strategy || o?.setup_type);
    if (!grouped[strategy]) {
      grouped[strategy] = {
        total: 0,
        wins: 0,
        totalMove: 0,
      };
    }

    grouped[strategy].total += 1;
    if (String(o?.outcome || '').toUpperCase() === 'WIN') grouped[strategy].wins += 1;
    grouped[strategy].totalMove += Number(o?.move_percent || 0);
  });

  return Object.keys(grouped)
    .map((strategy) => {
      const g = grouped[strategy];
      const winRate = g.total > 0 ? (g.wins / g.total) * 100 : 0;
      const avgReturn = g.total > 0 ? (g.totalMove / g.total) : 0;
      const score =
        winRate * 0.6 +
        avgReturn * 0.3 +
        (g.total > 10 ? 10 : 0);

      return {
        strategy,
        win_rate: Math.round(winRate),
        avg_return: Number(avgReturn.toFixed(4)),
        score: Math.round(score),
        total: g.total,
      };
    })
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
}

function buildStrategyScoreMap(strategyRankingResults) {
  const map = {};
  (strategyRankingResults || []).forEach((row) => {
    const key = normalizeStrategyKey(row?.strategy);
    const score = Number(row?.score || 0);
    map[key] = Number((Math.max(0, score) / 100).toFixed(4));
  });
  return map;
}

function buildOutcomeRowsFromOpportunities(opportunities, marketMap, nowMs = Date.now()) {
  return (opportunities || []).map((o) => {
    const symbol = normalizeSymbol(o?.symbol);
    if (!symbol) return null;

    const current = marketMap?.[symbol];
    const entryPrice = Number(o?.entry_price ?? o?.entry);
    const currentPrice = Number(current?.price ?? current?.last ?? current?.close);
    let move = null;

    if (Number.isFinite(entryPrice) && entryPrice > 0 && Number.isFinite(currentPrice)) {
      move = ((currentPrice - entryPrice) / entryPrice) * 100;
    } else {
      const directMove = Number(o?.move_percent ?? o?.result_pct ?? o?.change_percent ?? o?.expected_move_percent);
      if (Number.isFinite(directMove)) {
        move = directMove;
      } else {
        const oppPrice = Number(o?.price ?? o?.last ?? o?.close);
        if (Number.isFinite(entryPrice) && entryPrice > 0 && Number.isFinite(oppPrice)) {
          move = ((oppPrice - entryPrice) / entryPrice) * 100;
        }
      }
    }

    if (!Number.isFinite(move)) return null;
    const outcome = evaluateOutcomeWithTiming(o, move, nowMs);

    return {
      symbol,
      strategy: o?.strategy || o?.setup_type || null,
      entry_price: Number.isFinite(entryPrice) ? entryPrice : null,
      current_price: Number.isFinite(currentPrice) ? currentPrice : (Number.isFinite(Number(o?.price)) ? Number(o.price) : null),
      move_percent: move,
      outcome,
      created_at: o?.created_at || null,
      confidence: normalizeConfidenceUnit(o?.confidence),
      atr_percent: Number.isFinite(Number(o?.atr_percent)) ? Number(o.atr_percent) : 2,
    };
  }).filter(Boolean);
}

async function fetchOpportunitiesAndMarket(limit = 200) {
  if (supabaseClient) {
    const [{ data: signalRows }, { data: marketRows }] = await Promise.all([
      supabaseClient
        .from('opportunities')
        .select('*')
        .limit(limit),
      supabaseClient
        .from('market_quotes')
        .select('*'),
    ]);

    const opportunities = Array.isArray(signalRows) ? signalRows : [];
    const market = Array.isArray(marketRows) ? marketRows : [];
    const marketMap = {};
    market.forEach((m) => {
      const symbol = normalizeSymbol(m?.symbol);
      if (symbol) marketMap[symbol] = m;
    });

    return { opportunities, market, marketMap };
  }

  const [signalsResult, marketResult] = await Promise.all([
    pool.query(
      `SELECT *
       FROM opportunities
       ORDER BY created_at DESC NULLS LAST
       LIMIT $1`,
      [limit]
    ).catch(() => ({ rows: [] })),
    pool.query('SELECT * FROM market_quotes').catch(() => ({ rows: [] })),
  ]);

  const opportunities = Array.isArray(signalsResult.rows) ? signalsResult.rows : [];
  const market = Array.isArray(marketResult.rows) ? marketResult.rows : [];
  const marketMap = {};
  market.forEach((m) => {
    const symbol = normalizeSymbol(m?.symbol);
    if (symbol) marketMap[symbol] = m;
  });

  return { opportunities, market, marketMap };
}

async function fetchHistoricalOutcomes(limit = 200) {
  const fallback = await pool.query(
    `SELECT
       UPPER(symbol) AS symbol,
       COALESCE(strategy, 'unknown') AS strategy,
       result_pct AS move_percent,
       outcome,
       entry_time AS created_at
     FROM trade_outcomes
     WHERE symbol IS NOT NULL
       AND result_pct IS NOT NULL
     ORDER BY ABS(COALESCE(result_pct, 0)) DESC NULLS LAST, entry_time DESC NULLS LAST
     LIMIT $1`,
    [limit]
  ).catch(() => ({ rows: [] }));

  return (fallback.rows || []).map((row) => {
    const movePercent = Number(row?.move_percent) || 0;
    const rawOutcome = String(row?.outcome || '').toUpperCase();
    const computed = evaluateOutcome(row, movePercent);
    const normalizedOutcome = rawOutcome === 'WIN' || rawOutcome === 'LOSS' || rawOutcome === 'NEUTRAL'
      ? rawOutcome
      : computed;

    return {
      symbol: normalizeSymbol(row?.symbol),
      strategy: row?.strategy || 'unknown',
      move_percent: movePercent,
      outcome: normalizedOutcome,
      created_at: row?.created_at || null,
      confidence: 0.5,
      atr_percent: 2,
    };
  });
}

function buildContextMaps(marketRows, metricsRows, newsRows, earningsRows) {
  const marketMap = {};
  (marketRows || []).forEach((m) => {
    const symbol = normalizeSymbol(m?.symbol);
    if (symbol) marketMap[symbol] = m;
  });

  const metricsMap = {};
  (metricsRows || []).forEach((m) => {
    const symbol = normalizeSymbol(m?.symbol);
    if (symbol) metricsMap[symbol] = m;
  });

  const newsMap = {};
  (newsRows || []).forEach((n) => {
    const symbol = normalizeSymbol(n?.symbol || (Array.isArray(n?.symbols) ? n.symbols[0] : null));
    if (!symbol) return;
    if (!newsMap[symbol]) newsMap[symbol] = [];
    newsMap[symbol].push(n);
  });

  const earningsMap = {};
  (earningsRows || []).forEach((e) => {
    const symbol = normalizeSymbol(e?.symbol);
    if (symbol) earningsMap[symbol] = e;
  });

  return { marketMap, metricsMap, newsMap, earningsMap };
}

async function buildOpportunityContext(symbols = []) {
  const upperSymbols = Array.from(new Set((symbols || []).map((s) => normalizeSymbol(s)).filter(Boolean)));

  if (supabaseClient) {
    const [marketData, metricsData, newsData, earningsData] = await Promise.all([
      supabaseClient.from('market_quotes').select('*'),
      supabaseClient.from('market_metrics').select('*'),
      supabaseClient.from('news_articles').select('*'),
      supabaseClient.from('earnings_events').select('*'),
    ]);

    const marketRows = Array.isArray(marketData?.data) ? marketData.data : [];
    const metricsRows = Array.isArray(metricsData?.data) ? metricsData.data : [];
    const newsRows = Array.isArray(newsData?.data) ? newsData.data : [];
    const earningsRows = Array.isArray(earningsData?.data) ? earningsData.data : [];

    return buildContextMaps(
      upperSymbols.length ? marketRows.filter((r) => upperSymbols.includes(normalizeSymbol(r?.symbol))) : marketRows,
      upperSymbols.length ? metricsRows.filter((r) => upperSymbols.includes(normalizeSymbol(r?.symbol))) : metricsRows,
      upperSymbols.length
        ? newsRows.filter((r) => upperSymbols.includes(normalizeSymbol(r?.symbol || (Array.isArray(r?.symbols) ? r.symbols[0] : null))))
        : newsRows,
      upperSymbols.length ? earningsRows.filter((r) => upperSymbols.includes(normalizeSymbol(r?.symbol))) : earningsRows
    );
  }

  const [marketRes, metricsRes, newsRes, earningsRes] = await Promise.all([
    pool.query(
      upperSymbols.length
        ? `SELECT * FROM market_quotes WHERE UPPER(symbol) = ANY($1::text[])`
        : `SELECT * FROM market_quotes`,
      upperSymbols.length ? [upperSymbols] : []
    ).catch(() => ({ rows: [] })),
    pool.query(
      upperSymbols.length
        ? `SELECT * FROM market_metrics WHERE UPPER(symbol) = ANY($1::text[])`
        : `SELECT * FROM market_metrics`,
      upperSymbols.length ? [upperSymbols] : []
    ).catch(() => ({ rows: [] })),
    pool.query(
      upperSymbols.length
        ? `SELECT * FROM news_articles WHERE UPPER(symbol) = ANY($1::text[])`
        : `SELECT * FROM news_articles`,
      upperSymbols.length ? [upperSymbols] : []
    ).catch(() => ({ rows: [] })),
    pool.query(
      upperSymbols.length
        ? `SELECT * FROM earnings_events WHERE UPPER(symbol) = ANY($1::text[])`
        : `SELECT * FROM earnings_events`,
      upperSymbols.length ? [upperSymbols] : []
    ).catch(() => ({ rows: [] })),
  ]);

  return buildContextMaps(marketRes.rows, metricsRes.rows, newsRes.rows, earningsRes.rows);
}

async function persistIntelligenceEmail({ sender, subject, received_at, raw_text, raw_html }) {
  const source_tag = detectSource(sender, subject);
  const source_name = detectPublisherName(sender, subject);
  const receivedTs = received_at ? new Date(received_at) : new Date();

  const { rows } = await pool.query(
    `INSERT INTO intelligence_emails
       (sender, subject, received_at, raw_text, raw_html, source_tag)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, received_at, source_tag`,
    [sender, subject, receivedTs, raw_text, raw_html, source_tag]
  );

  const row = rows[0];

  await bridgeNewsletterEmailToIntelNews({
    sender,
    subject,
    received_at: row?.received_at,
    raw_text,
    source_tag: row?.source_tag,
    source_name,
  });

  return {
    id: row.id,
    source_tag: row.source_tag,
    source_name,
    received_at: row.received_at,
  };
}

// GET /api/intelligence/ping — health check (requires key)
router.get('/api/intelligence/ping', requireIntelKey, (req, res) => {
  res.json({ ok: true, service: 'intelligence-ingest', ts: new Date().toISOString() });
});

// POST /api/intelligence/email-ingest — store inbound email intel
router.post('/api/intelligence/email-ingest', async (req, res) => {
  if (!process.env.INTEL_INGEST_KEY) {
    console.error("INTEL_INGEST_KEY missing from environment");
    return res.status(500).json({ error: "INTEL_INGEST_KEY not configured on server" });
  }

  const incomingKey = req.headers["x-intel-key"];

  if (!incomingKey) {
    return res.status(401).json({ error: "Missing x-intel-key header" });
  }

  if (incomingKey !== process.env.INTEL_INGEST_KEY) {
    return res.status(401).json({ error: "Unauthorized - invalid ingest key" });
  }

  try {
    const {
      sender = null,
      subject = null,
      received_at = null,
      raw_text = null,
      raw_html = null,
    } = req.body || {};

    if (!raw_text && !raw_html) {
      return res.status(400).json({ ok: false, error: 'raw_text or raw_html is required' });
    }

    const row = await persistIntelligenceEmail({ sender, subject, received_at, raw_text, raw_html });

    console.log(JSON.stringify({
      event: 'INTEL_EMAIL_INGESTED',
      id: row.id,
      source_tag: row.source_tag,
      received_at: row.received_at,
      sender,
      subject,
    }));

    res.json({ ok: true, id: row.id, source_tag: row.source_tag, source_name: row.source_name, received_at: row.received_at });
  } catch (err) {
    console.error('[intelligence] email-ingest error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/intelligence/resend-webhook — ingest Resend inbound payloads
router.post('/api/intelligence/resend-webhook', requireIntelKey, async (req, res) => {
  try {
    const sender = req.body?.from || req.body?.sender || null;
    const subject = req.body?.subject || null;
    const raw_text = req.body?.text || req.body?.raw_text || null;
    const raw_html = req.body?.html || req.body?.raw_html || null;
    const received_at = req.body?.received_at || req.body?.created_at || new Date().toISOString();

    if (!raw_text && !raw_html) {
      return res.status(400).json({ ok: false, error: 'text/html payload is required' });
    }

    const stored = await persistIntelligenceEmail({ sender, subject, received_at, raw_text, raw_html });
    return res.json({ ok: true, channel: 'resend', ...stored });
  } catch (error) {
    console.error('[intelligence] resend-webhook error:', error.message);
    return res.status(500).json({ ok: false, error: error.message || 'Failed to ingest resend payload' });
  }
});

// POST /api/intel-inbox — DB-first inbox ingestion (raw -> parsed -> catalysts)
router.post('/api/intel-inbox', requireIntelKey, async (req, res) => {
  try {
    const {
      sender = null,
      subject = null,
      body = null,
      symbol = null,
      timestamp = null,
      source = 'intel_inbox',
    } = req.body || {};

    const result = await ingestIntelInboxMessage({
      sender,
      subject,
      body,
      symbol,
      timestamp,
      source,
      raw: req.body || {},
    });

    return res.json({ ok: true, ...result });
  } catch (error) {
    const status = /required/i.test(error?.message || '') ? 400 : 500;
    return res.status(status).json({ ok: false, error: error.message || 'intel inbox ingestion failed' });
  }
});

// GET /api/intelligence/list — last 50 entries, JWT protected
router.get('/api/intelligence/list', authMiddleware, async (req, res) => {
  const rawLimit = Number.parseInt(String(req.query.limit || ''), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;

  try {
    const { rows } = await pool.query(`
      SELECT
        id,
        subject,
        sender          AS "from",
        source_tag,
        received_at,
        LEFT(raw_text, 300) AS summary,
        NULL::numeric   AS sentiment_score,
        raw_text,
        processed
      FROM intelligence_emails
      ORDER BY received_at DESC
      LIMIT $1
    `, [limit]);
    res.json({ ok: true, items: rows });
  } catch (err) {
    console.error('[intelligence] list error:', {
      method: req.method,
      path: req.originalUrl,
      requestId: req.requestId,
      error: err?.message,
      stack: err?.stack,
    });
    res.status(500).json({
      ok: false,
      error: 'INTELLIGENCE_LIST_FAILED',
      message: 'Failed to load intelligence list',
      requestId: req.requestId,
      detail: err?.message || 'Unknown error',
    });
  }
});

// GET /api/intelligence/catalysts — latest catalysts by impact
router.get('/api/intelligence/catalysts', async (req, res) => {
  const rawLimit = Number.parseInt(String(req.query.limit || ''), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;

  try {
    const { rows } = await pool.query(
      `SELECT
         symbol,
         catalyst_type,
         headline,
         source,
         sentiment,
         impact_score,
         published_at
       FROM news_catalysts
       ORDER BY impact_score DESC NULLS LAST, published_at DESC NULLS LAST
       LIMIT $1`,
      [limit]
    );
    return res.json({ ok: true, items: rows });
  } catch (err) {
    console.error('[intelligence] catalysts error:', err.message);
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load catalysts' });
  }
});

// GET /api/intelligence/early-accumulation — latest experimental pressure signals
router.get('/api/intelligence/early-accumulation', async (req, res) => {
  try {
    await ensureEarlyAccumulationTable();
    await ensureEarlySignalOutcomesTable();

    const { rows } = await pool.query(
      `SELECT
         s.id,
         s.symbol,
         s.price,
         s.volume,
         s.avg_volume_30d,
         s.relative_volume,
         s.float_rotation,
         s.liquidity_surge,
         s.accumulation_score,
         s.pressure_level,
         s.sector,
         s.detected_at,
         o.max_move_percent
       FROM early_accumulation_signals s
       LEFT JOIN early_signal_outcomes o ON o.signal_id = s.id
       ORDER BY s.accumulation_score DESC NULLS LAST, s.detected_at DESC NULLS LAST
       LIMIT 20`
    );
    return res.json({ ok: true, items: rows });
  } catch (err) {
    console.error('[intelligence] early-accumulation error:', err.message);
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load early accumulation signals' });
  }
});

// GET /api/intelligence/order-flow — latest order-flow imbalance detections
router.get('/api/intelligence/order-flow', async (req, res) => {
  try {
    await ensureOrderFlowSignalsTable();

    const { rows } = await pool.query(
      `SELECT
         id,
         symbol,
         price,
         relative_volume,
         float_rotation,
         liquidity_surge,
         pressure_score,
         pressure_level,
         detected_at
       FROM order_flow_signals
       ORDER BY detected_at DESC NULLS LAST
       LIMIT 50`
    );

    return res.json({ ok: true, items: rows });
  } catch (err) {
    console.error('[intelligence] order-flow error:', err.message);
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load order-flow signals' });
  }
});

// GET /api/intelligence/sector-momentum — latest sector momentum table
router.get('/api/intelligence/sector-momentum', async (req, res) => {
  try {
    await ensureSectorMomentumTable();

    const { rows } = await pool.query(
      `SELECT
         sector,
         momentum_score,
         avg_gap,
         avg_rvol,
         top_symbol,
         updated_at
       FROM sector_momentum
       ORDER BY momentum_score DESC NULLS LAST
       LIMIT 30`
    );

    return res.json({ ok: true, items: rows });
  } catch (err) {
    console.error('[intelligence] sector-momentum error:', err.message);
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load sector momentum' });
  }
});

router.get('/api/intelligence/squeezes', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
    let items = await listLatestSqueezeSignals(limit);
    if (!items.length) {
      await runShortSqueezeEngine();
      items = await listLatestSqueezeSignals(limit);
    }
    return res.json({ ok: true, items: items || [] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load squeeze signals', items: [] });
  }
});

router.get('/api/intelligence/flow', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
    let items = await listLatestFlowSignals(limit);
    if (!items.length) {
      await runFlowDetectionEngine();
      items = await listLatestFlowSignals(limit);
    }
    return res.json({ ok: true, items: items || [] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load flow signals', items: [] });
  }
});

router.get('/api/stocks/in-play', async (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
  try {
    const { rows } = await pool.query(
      `SELECT id, symbol, gap_percent, rvol, catalyst, score, detected_at
       FROM stocks_in_play
       ORDER BY detected_at DESC NULLS LAST
       LIMIT $1`,
      [limit]
    );
    if (rows && rows.length > 0) {
      return res.json({ ok: true, items: rows });
    }
  } catch (_err) {
    // fall through to FMP fallback
  }

  // FMP fallback — biggest gainers with elevated volume
  try {
    const axios = require('axios');
    const fmpKey = process.env.FMP_API_KEY;
    const resp = await axios.get(`https://financialmodelingprep.com/stable/biggest-gainers?apikey=${fmpKey}`, { timeout: 6000 });
    const fmpItems = (Array.isArray(resp.data) ? resp.data : []).slice(0, limit).map((r) => ({
      symbol: String(r.symbol || '').toUpperCase(),
      gap_percent: Number(r.changesPercentage || r.changePercentage || 0),
      rvol: r.avgVolume > 0 ? Math.round((Number(r.volume) / Number(r.avgVolume)) * 10) / 10 : null,
      catalyst: 'GAP_UP',
      score: null,
      detected_at: new Date().toISOString(),
      price: Number(r.price) || 0,
      volume: Number(r.volume) || 0,
      source: 'fmp_direct',
    })).filter((r) => r.symbol);
    return res.json({ ok: true, items: fmpItems, source: 'fmp_direct' });
  } catch (fmpErr) {
    return res.status(500).json({ ok: false, error: fmpErr.message || 'No data', items: [] });
  }
});

router.get('/api/intelligence/market-narrative', async (_req, res) => {
  try {
    let latest = await getLatestMarketNarrative();
    if (!latest) {
      await runMarketNarrativeEngine();
      latest = await getLatestMarketNarrative();
    }

    return res.json({
      ok: true,
      narrative: latest?.narrative || '',
      regime: latest?.regime || 'Neutral',
      created_at: latest?.created_at || null,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      narrative: '',
      regime: 'Neutral',
      created_at: null,
      error: err.message || 'Failed to load market narrative',
    });
  }
});

router.get('/api/intelligence/top5', async (_req, res) => {
  try {
    let data = [];

    if (supabaseClient) {
      const { data: supabaseRows } = await supabaseClient
        .from('opportunities')
        .select('*')
        .limit(50);
      data = Array.isArray(supabaseRows) ? supabaseRows : [];
    } else {
      const fallback = await pool.query(
        `SELECT *
         FROM opportunities
         LIMIT 50`
      ).catch(() => ({ rows: [] }));
      data = Array.isArray(fallback.rows) ? fallback.rows : [];
    }

    const results = data
      .map((r) => ({
        ...r,
        trade_quality: Number.isFinite(Number(r?.trade_quality)) ? Number(r.trade_quality) : 0,
      }))
      .sort((a, b) => Number(b.trade_quality || 0) - Number(a.trade_quality || 0))
      .slice(0, 5);

    console.log('TOP 5 TQI TRADES:', results.map((r) => ({
      symbol: r.symbol,
      tqi: r.trade_quality,
    })));

    return res.json({
      count: results.length,
      results,
    });
  } catch (err) {
    console.error('TOP5 ERROR:', err);
    return res.status(500).json({ error: 'Top 5 fetch failed' });
  }
});

router.get('/api/intelligence/priority', async (_req, res) => {
  // Phase 6: After-hours freeze
  const { isMarketOpen, getSessionLabel } = require('../utils/marketHours');
  if (!isMarketOpen()) {
    try {
      const { queryWithTimeout: qt } = require('../db/pg');
      const { rows: snapRows } = await qt(
        `SELECT * FROM signal_snapshots ORDER BY created_at DESC LIMIT 10`,
        [],
        { timeoutMs: 5000, label: 'priority.snapshot_frozen' }
      );
      if (snapRows.length > 0) {
        return res.json({
          market_open: false,
          session: getSessionLabel(),
          market_message: 'Market closed — showing last evaluated opportunities.',
          snapshot_at: snapRows[0].created_at,
          results: snapRows,
        });
      }
    } catch { /* fall through */ }
  }

  try {
    let data = [];

    if (supabaseClient) {
      const { data: supabaseRows } = await supabaseClient
        .from('opportunities')
        .select('*')
        .limit(100);
      data = Array.isArray(supabaseRows) ? supabaseRows : [];
    } else {
      const fallback = await pool.query(
        `SELECT *
         FROM opportunities
         ORDER BY created_at DESC NULLS LAST
         LIMIT 100`
      ).catch(() => ({ rows: [] }));
      data = Array.isArray(fallback.rows) ? fallback.rows : [];
    }

    const now = Date.now();
    const calibrationSeed = await fetchOpportunitiesAndMarket(200);
    const calibrationOutcomes = buildOutcomeRowsFromOpportunities(
      calibrationSeed.opportunities,
      calibrationSeed.marketMap,
      now
    ).filter((row) => row.outcome !== 'TOO_EARLY');
    const calibrationMap = buildCalibrationMap(buildCalibrationResults(calibrationOutcomes));
    const strategyScoreMap = buildStrategyScoreMap(buildStrategyRankingResults(calibrationOutcomes));

    const symbols = Array.from(new Set((data || [])
      .map((r) => String(r?.symbol || '').trim().toUpperCase())
      .filter(Boolean)));
    const context = await buildOpportunityContext(symbols);

    const results = (data || []).map((r) => {
      const symbol = String(r?.symbol || '').trim().toUpperCase();
      const createdAtMs = r?.created_at ? new Date(r.created_at).getTime() : null;
      const recencyMinutes = Number.isFinite(createdAtMs)
        ? (now - createdAtMs) / 60000
        : 999;

      const recencyScore = recencyMinutes < 5
        ? 100
        : recencyMinutes < 15
          ? 80
          : recencyMinutes < 60
            ? 50
            : 20;

      const enriched = enrichOpportunity({ ...r, symbol }, context);
      const relativeVolume = Number.isFinite(Number(enriched?.relative_volume)) ? Number(enriched.relative_volume) : 0;
      const rvolScore = relativeVolume > 0
        ? Math.min(relativeVolume * 20, 100)
        : 0;

      const catalystScore = Number.isFinite(Number(enriched?.catalyst_strength))
        ? Number(enriched.catalyst_strength)
        : Number.isFinite(Number(r?.catalyst_score))
          ? Number(r.catalyst_score)
          : Number.isFinite(Number(r?.news_score))
            ? Number(r.news_score) * 10
            : 20;

      const tradeQualityRaw = Number(r?.trade_quality);
      const tradeQuality = Number.isFinite(tradeQualityRaw)
        ? (tradeQualityRaw <= 1 ? tradeQualityRaw * 100 : tradeQualityRaw)
        : 0;
      const confidenceRaw = Number(r?.confidence);
      const confidence = Number.isFinite(confidenceRaw)
        ? (confidenceRaw <= 1 ? confidenceRaw * 100 : confidenceRaw)
        : 0;
      const confidenceUnit = normalizeConfidenceUnit(r?.confidence);
      const adjustedConfidence = adjustConfidence({ confidence: confidenceUnit }, calibrationMap);
      const strategyFactor = strategyScoreMap[normalizeStrategyKey(enriched?.strategy || r?.strategy || r?.setup_type)] || 1;

      const priorityScoreBase =
        tradeQuality * 0.4 +
        confidence * 0.2 +
        rvolScore * 0.2 +
        catalystScore * 0.1 +
        recencyScore * 0.1;
      const priorityScore =
        priorityScoreBase *
        (adjustedConfidence || 1) *
        strategyFactor;

      const narrative = buildNarrative(enriched);

      console.log('ENRICHMENT SAMPLE:', enriched.symbol, {
        rvol: enriched.relative_volume,
        catalyst: enriched.catalyst_type,
        strength: enriched.catalyst_strength,
      });

      // Build structured execution_plan if not already an object
      let execPlan = enriched?.execution_plan;
      if (!execPlan || typeof execPlan !== 'object' || !execPlan.entry) {
        try {
          const { computeExecutionPlan } = require('../engines/executionEngine');
          const ep = computeExecutionPlan({
            price:          Number(enriched?.current_price ?? enriched?.price ?? r?.price ?? 0),
            atr:            Number(enriched?.atr ?? 0),
            volume:         Number(enriched?.volume ?? r?.volume ?? 0),
            relativeVolume: Number(enriched?.relative_volume ?? 0),
            changePercent:  Number(enriched?.change_percent ?? r?.change_percent ?? 0),
            gapPercent:     Number(enriched?.gap_percent ?? 0),
            confidence:     confidence,
            strategy:       enriched?.strategy ?? r?.strategy ?? r?.setup_type ?? null,
            catalyst:       enriched?.catalyst ?? r?.headline ?? r?.catalyst ?? null,
          });
          execPlan = { entry: ep.entry_price, stop: ep.stop_loss, target: ep.target_price };
          // Carry full plan fields onto the result
          enriched._execFull = ep;
        } catch { execPlan = narrative.execution_plan; }
      }

      return {
        ...enriched,
        priority_score:        Math.round(priorityScore),
        adjusted_confidence:   Number(adjustedConfidence.toFixed(4)),
        strategy_multiplier:   Number(strategyFactor.toFixed(4)),
        why_moving:            enriched?.why_moving    || enriched?._execFull?.why_moving    || narrative.why_moving,
        why_tradeable:         enriched?.why_tradeable || enriched?._execFull?.why_tradeable || narrative.why_tradeable,
        how_to_trade:          enriched?.how_to_trade  || enriched?._execFull?.how_to_trade  || null,
        execution_plan:        execPlan,
        trade_quality_score:   enriched?.trade_quality_score ?? enriched?._execFull?.trade_quality_score ?? null,
        position_size:         enriched?.position_size       ?? enriched?._execFull?.position_size       ?? null,
        risk_reward:           enriched?.risk_reward         ?? enriched?._execFull?.risk_reward         ?? null,
        execution_ready:       enriched?.execution_ready     ?? enriched?._execFull?.execution_ready     ?? null,
      };
    });

    const top3 = results
      .sort((a, b) => Number(b.priority_score || 0) - Number(a.priority_score || 0))
      .slice(0, 3);

    console.log('PRIORITY TRADES:', top3.map((t) => ({
      symbol: t.symbol,
      priority: t.priority_score,
    })));

    return res.json({
      count: top3.length,
      results: top3,
    });
  } catch (err) {
    console.error('PRIORITY ERROR:', err);
    return res.status(500).json({ error: 'Priority engine failed' });
  }
});

router.get('/api/intelligence/missed', async (_req, res) => {
  try {
    let past = [];
    let current = [];

    if (supabaseClient) {
      const [{ data: pastRows }, { data: currentRows }] = await Promise.all([
        supabaseClient.from('opportunities').select('*').limit(50),
        supabaseClient.from('market_quotes').select('*'),
      ]);
      past = Array.isArray(pastRows) ? pastRows : [];
      current = Array.isArray(currentRows) ? currentRows : [];
    } else {
      const [pastResult, currentResult] = await Promise.all([
        pool.query(
          `SELECT *
           FROM opportunities
           ORDER BY created_at DESC NULLS LAST
           LIMIT 50`
        ).catch(() => ({ rows: [] })),
        pool.query(`SELECT * FROM market_quotes`).catch(() => ({ rows: [] })),
      ]);
      past = Array.isArray(pastResult.rows) ? pastResult.rows : [];
      current = Array.isArray(currentResult.rows) ? currentResult.rows : [];
    }

    const currentMap = {};
    (current || []).forEach((c) => {
      const symbol = String(c?.symbol || '').toUpperCase();
      if (!symbol) return;
      currentMap[symbol] = c;
    });

    const rankedMoves = (past || [])
      .map((p) => {
        const symbol = String(p?.symbol || '').toUpperCase();
        if (!symbol) return null;
        const nowRow = currentMap[symbol];

        const entryPrice = Number(p?.entry_price ?? p?.entry);
        const currentPrice = Number(nowRow?.price ?? nowRow?.last ?? nowRow?.close);

        if (!nowRow || !Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(currentPrice)) {
          return null;
        }

        const move = ((currentPrice - entryPrice) / entryPrice) * 100;

        return {
          symbol,
          move_since_signal: move,
          original_entry: entryPrice,
          current_price: currentPrice,
          timestamp: p?.created_at || null,
        };
      })
      .filter((m) => m)
      .sort((a, b) => Number(b.move_since_signal || 0) - Number(a.move_since_signal || 0));

    const overThreshold = rankedMoves.filter((m) => Number(m.move_since_signal) > 5);
    const fallbackMovers = rankedMoves
      .filter((m) => Math.abs(Number(m.move_since_signal || 0)) > 0)
      .sort((a, b) => Math.abs(Number(b.move_since_signal || 0)) - Math.abs(Number(a.move_since_signal || 0)));
    const missed = (overThreshold.length > 0 ? overThreshold : fallbackMovers)
      .map((m) => ({
        ...m,
        direction: Number(m.move_since_signal || 0) >= 0 ? 'up' : 'down',
      }))
      .slice(0, 5);

    console.log('MISSED TRADES:', missed.length);

    return res.json(missed);
  } catch (err) {
    console.error('MISSED ERROR:', err);
    return res.status(500).json({ error: 'Missed trades failed' });
  }
});

router.get('/api/intelligence/outcomes', async (_req, res) => {
  try {
    const now = Date.now();
    const { opportunities, marketMap } = await fetchOpportunitiesAndMarket(200);
    let results = buildOutcomeRowsFromOpportunities(opportunities, marketMap, now);

    if (results.length === 0 || !results.some((row) => row.outcome === 'WIN' || row.outcome === 'LOSS')) {
      const fallbackRows = await fetchHistoricalOutcomes(200);

      if (results.length === 0) {
        results = fallbackRows;
      } else {
        const merged = [...results, ...fallbackRows];
        const deduped = [];
        const seen = new Set();
        for (const row of merged) {
          const key = `${row.symbol}|${row.created_at || ''}|${row.strategy || ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(row);
        }
        results = deduped;
      }

      console.log('OUTCOME ENGINE:', results.length);
      return res.json(results.slice(0, 20));
    }

    console.log('OUTCOME ENGINE:', results.length);
    return res.json(results.slice(0, 20));
  } catch (err) {
    console.error('OUTCOME ERROR:', err);
    return res.status(500).json({ error: 'Outcome engine failed' });
  }
});

router.get('/api/intelligence/calibration', async (_req, res) => {
  try {
    const now = Date.now();
    const { opportunities, marketMap } = await fetchOpportunitiesAndMarket(200);
    let outcomes = buildOutcomeRowsFromOpportunities(opportunities, marketMap, now)
      .filter((row) => row.outcome !== 'TOO_EARLY');

    if (outcomes.length === 0) {
      outcomes = await fetchHistoricalOutcomes(200);
    }

    const results = buildCalibrationResults(outcomes).map((bucket) => ({
      confidence_bucket: bucket.confidence_bucket,
      predicted: bucket.predicted,
      actual: bucket.actual,
    }));

    console.log('CALIBRATION:', results);
    return res.json(results);
  } catch (err) {
    console.error('CALIBRATION ERROR:', err);
    return res.status(500).json({ error: 'Calibration failed' });
  }
});

router.get('/api/intelligence/strategy-ranking', async (_req, res) => {
  try {
    const now = Date.now();
    const { opportunities, marketMap } = await fetchOpportunitiesAndMarket(200);
    let outcomes = buildOutcomeRowsFromOpportunities(opportunities, marketMap, now)
      .filter((row) => row.outcome !== 'TOO_EARLY');

    if (outcomes.length === 0) {
      outcomes = await fetchHistoricalOutcomes(200);
    }

    const results = buildStrategyRankingResults(outcomes).map((row) => ({
      strategy: row.strategy,
      win_rate: row.win_rate,
      avg_return: row.avg_return,
      score: row.score,
    }));

    console.log('STRATEGY RANKING:', results);
    return res.json(results);
  } catch (err) {
    console.error('RANKING ERROR:', err);
    return res.status(500).json({ error: 'Ranking failed' });
  }
});

router.get('/api/intelligence/strategy-performance', async (_req, res) => {
  try {
    let outcomes = [];

    if (supabaseClient) {
      const [{ data: oppRows }, { data: marketRows }] = await Promise.all([
        supabaseClient
          .from('opportunities')
          .select('*')
          .limit(200),
        supabaseClient
          .from('market_quotes')
          .select('*'),
      ]);
      const opps = Array.isArray(oppRows) ? oppRows : [];
      const marketMap = {};
      (Array.isArray(marketRows) ? marketRows : []).forEach((m) => {
        const symbol = normalizeSymbol(m?.symbol);
        if (symbol) marketMap[symbol] = m;
      });

      outcomes = opps.map((o) => {
        const symbol = normalizeSymbol(o?.symbol);
        const current = marketMap[symbol];
        const entryPrice = Number(o?.entry_price ?? o?.entry);
        const currentPrice = Number(current?.price ?? current?.last ?? current?.close);
        let outcome = String(o?.outcome || '').toUpperCase();

        if (!['WIN', 'LOSS', 'NEUTRAL'].includes(outcome) && Number.isFinite(entryPrice) && entryPrice > 0 && Number.isFinite(currentPrice)) {
          const move = ((currentPrice - entryPrice) / entryPrice) * 100;
          if (move > 2) outcome = 'WIN';
          else if (move < -1) outcome = 'LOSS';
          else outcome = 'NEUTRAL';
        }

        return {
          strategy: o?.strategy || o?.setup_type || 'unknown',
          outcome,
        };
      });
    } else {
      const result = await pool.query(
        `SELECT strategy, outcome
         FROM strategy_performance
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 200`
      ).catch(() => ({ rows: [] }));

      if (Array.isArray(result.rows) && result.rows.length > 0) {
        outcomes = result.rows.map((row) => ({
          strategy: row?.strategy || 'unknown',
          outcome: String(row?.outcome || '').toUpperCase(),
        }));
      } else {
        const [oppResult, marketResult] = await Promise.all([
          pool.query(
            `SELECT *
             FROM opportunities
             ORDER BY created_at DESC NULLS LAST
             LIMIT 200`
          ).catch(() => ({ rows: [] })),
          pool.query('SELECT * FROM market_quotes').catch(() => ({ rows: [] })),
        ]);

        const marketMap = {};
        (marketResult.rows || []).forEach((m) => {
          const symbol = normalizeSymbol(m?.symbol);
          if (symbol) marketMap[symbol] = m;
        });

        outcomes = (oppResult.rows || []).map((o) => {
          const symbol = normalizeSymbol(o?.symbol);
          const current = marketMap[symbol];
          const entryPrice = Number(o?.entry_price ?? o?.entry);
          const currentPrice = Number(current?.price ?? current?.last ?? current?.close);
          let outcome = String(o?.outcome || '').toUpperCase();

          if (!['WIN', 'LOSS', 'NEUTRAL'].includes(outcome) && Number.isFinite(entryPrice) && entryPrice > 0 && Number.isFinite(currentPrice)) {
            const move = ((currentPrice - entryPrice) / entryPrice) * 100;
            if (move > 2) outcome = 'WIN';
            else if (move < -1) outcome = 'LOSS';
            else outcome = 'NEUTRAL';
          }

          return {
            strategy: o?.strategy || o?.setup_type || 'unknown',
            outcome,
          };
        });
      }
    }

    const grouped = {};
    (outcomes || []).forEach((o) => {
      const strategy = String(o?.strategy || 'unknown');
      if (!grouped[strategy]) {
        grouped[strategy] = {
          total: 0,
          wins: 0,
          losses: 0,
        };
      }

      grouped[strategy].total += 1;
      if (o?.outcome === 'WIN') grouped[strategy].wins += 1;
      if (o?.outcome === 'LOSS') grouped[strategy].losses += 1;
    });

    const results = Object.keys(grouped).map((strategy) => {
      const g = grouped[strategy];
      const winRate = g.total > 0 ? (g.wins / g.total) * 100 : 0;
      return {
        strategy,
        total: g.total,
        win_rate: Math.round(winRate),
        wins: g.wins,
        losses: g.losses,
      };
    }).sort((a, b) => Number(b.win_rate || 0) - Number(a.win_rate || 0));

    console.log('STRATEGY PERFORMANCE:', results);
    return res.json(results);
  } catch (err) {
    console.error('STRATEGY ERROR:', err);
    return res.status(500).json({ error: 'Strategy performance failed' });
  }
});

router.get('/api/intelligence/replay', async (_req, res) => {
  try {
    let data = [];

    if (supabaseClient) {
      const { data: oppRows } = await supabaseClient
        .from('opportunities')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      data = Array.isArray(oppRows) ? oppRows : [];
    } else {
      const result = await pool.query(
        `SELECT *
         FROM opportunities
         ORDER BY created_at DESC NULLS LAST
         LIMIT 20`
      ).catch(() => ({ rows: [] }));
      data = Array.isArray(result.rows) ? result.rows : [];
    }

    const replay = (data || []).map((d) => ({
      symbol: normalizeSymbol(d?.symbol),
      strategy: d?.strategy || d?.setup_type || null,
      narrative: d?.why_moving || null,
      confidence: d?.confidence ?? null,
      trade_quality: d?.trade_quality ?? null,
      created_at: d?.created_at || null,
    }));

    console.log('REPLAY ENGINE:', replay.length);
    return res.json(replay);
  } catch (err) {
    console.error('REPLAY ERROR:', err);
    return res.status(500).json({ error: 'Replay failed' });
  }
});

router.get('/api/intelligence/top-opportunities', async (req, res) => {
  const rawMode = String(req.query.mode || 'live').trim().toLowerCase();
  const mode = ['live', 'recent', 'research'].includes(rawMode) ? rawMode : 'live';
  const rawLimit = Number.parseInt(String(req.query.limit || ''), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.max(rawLimit, 10)
    : 20;
  const hardResultLimit = mode === 'research'
    ? 50
    : Math.min(limit, 50);
  const strict = req.query.strict === 'true';
  const sessionContext = getSessionContext();

  function isFreshWithinMinutes(timestampValue, minutes) {
    const ts = new Date(timestampValue).getTime();
    if (!Number.isFinite(ts)) return false;
    return ts >= (Date.now() - minutes * 60 * 1000);
  }

  function normalizeRow(row = {}) {
    return {
      ...row,
      symbol: String(row.symbol || '').trim().toUpperCase(),
      why: String(row.why || row.why_moving || '').trim(),
      how: String(row.how || row.how_to_trade || '').trim(),
      confidence: Number(row.confidence ?? row.score ?? 0),
      expected_move: Number(row.expected_move ?? row.expected_move_percent),
      source: String(row.source || '').trim().toLowerCase(),
      updated_at: row.updated_at || null,
    };
  }

  function isValidRow(row = {}, selectedMode = 'live') {
    const isFresh = selectedMode === 'live'
      ? isFreshWithinMinutes(row.updated_at, 15)
      : selectedMode === 'recent'
        ? isFreshWithinMinutes(row.updated_at, 24 * 60)
        : true;

    return Boolean(row.symbol)
      && Number.isFinite(Number(row.expected_move))
      && row.source === 'real'
      && isFresh;
  }

  function toContractRow(row = {}) {
    const expectedMoveValue = row.expected_move ?? row.expected_move_percent;
    const mapped = {
      symbol: String(row.symbol || '').trim().toUpperCase(),
      why: String(row.why || row.why_moving || '').trim(),
      how: String(row.how || row.how_to_trade || '').trim(),
      confidence: Number(row.confidence),
      expected_move: Number(expectedMoveValue),
    };

    const valid = Boolean(mapped.symbol)
      && Boolean(mapped.why)
      && Boolean(mapped.how)
      && Number.isFinite(mapped.expected_move);

    return valid ? mapped : null;
  }

  try {
    const minLimit = mode === 'research'
      ? 500
      : Math.max(hardResultLimit * 5, 100);
    let modeWhereClause = `source = 'real'`;
    if (mode === 'live') {
      modeWhereClause = `source = 'real' AND updated_at >= NOW() - INTERVAL '15 minutes'`;
    } else if (mode === 'recent') {
      modeWhereClause = `source = 'real' AND updated_at >= NOW() - INTERVAL '24 hours'`;
    }

    const queryTimeoutMs = mode === 'live' ? 1800 : 2500;

    let rawRows = [];
    try {
      const quickResult = await queryWithTimeout(
        `SELECT *
         FROM opportunity_stream
         WHERE ${modeWhereClause}
         ORDER BY confidence DESC NULLS LAST
         LIMIT $1`,
        [minLimit],
        {
          timeoutMs: queryTimeoutMs,
          maxRetries: 0,
          slowQueryMs: 1000,
          label: 'api.intelligence.top_opportunities.real_query',
        }
      );
      rawRows = quickResult.rows || [];
    } catch (_dbErr) {
      console.warn('[top-opportunities] DB query failed, using FMP fallback directly:', _dbErr.message);
      rawRows = [];
    }
    console.log('DEBUG RAW ROW COUNT:', rawRows.length);
    console.log('DEBUG SAMPLE ROW:', rawRows[0]);

    const normalizedRows = rawRows.map((baseRow) => {
      const normalized = normalizeRow(baseRow);
      return {
        ...normalized,
        why: normalized.why || `${normalized.symbol} remains active in the live opportunity stream.`,
        how: normalized.how || 'Wait for confirmation at key intraday levels before entering.',
      };
    });

    const validRows = normalizedRows.filter((row) => isValidRow(row, mode));
    const quickContractRows = validRows.map(toContractRow).filter(Boolean);
    const cleaned = quickContractRows;
    console.log('DEBUG CLEANED COUNT:', cleaned.length);
    const quickFinalRows = quickContractRows.slice(0, hardResultLimit);

    const modePass = mode === 'live'
      ? quickFinalRows.length > 5
      : quickFinalRows.length > 0;

    if (modePass) {
      return res.json({
        success: true,
        source: 'real',
        mode,
        count: quickFinalRows.length,
        data: quickFinalRows,
      });
    }

    const stocksInPlayRows = await getStocksInPlayTopOpportunities(hardResultLimit);
    if (stocksInPlayRows.length > 0) {
      logResponseShape('/api/intelligence/top-opportunities', stocksInPlayRows, ['symbol', 'why', 'how', 'confidence', 'expected_move']);
      return res.json({
        success: true,
        source: 'real',
        mode,
        count: stocksInPlayRows.length,
        data: stocksInPlayRows.slice(0, hardResultLimit),
      });
    }

    const { rows } = await pool.query(
      `SELECT UPPER(symbol) AS symbol
       FROM decision_view
       WHERE symbol IS NOT NULL
         AND TRIM(symbol) <> ''
       ORDER BY final_score DESC NULLS LAST
       LIMIT $1`,
      [Math.max(hardResultLimit, 10)]
    );

    const symbols = (rows || []).map((row) => String(row.symbol || '').trim().toUpperCase()).filter(Boolean);

    if (!symbols.length) {
      return res.json({
        success: false,
        error: 'NO_REAL_DATA',
      });
    }

    const metricChangeResult = await pool.query(
      `SELECT UPPER(symbol) AS symbol,
              COALESCE(
                (to_jsonb(market_metrics)->>'change_percent')::numeric,
                (to_jsonb(market_metrics)->>'daily_change_percent')::numeric,
                (to_jsonb(market_metrics)->>'price_change_percent')::numeric,
                (to_jsonb(market_metrics)->>'percent_change')::numeric,
                (to_jsonb(market_metrics)->>'changePct')::numeric,
                0
              ) AS change_percent
       FROM market_metrics
       WHERE symbol = ANY($1::text[])
         AND symbol IS NOT NULL`,
      [symbols]
    ).catch(() => ({ rows: [] }));
    const metricChangeMap = new Map((metricChangeResult.rows || []).map((row) => [String(row.symbol || '').toUpperCase(), Number(row.change_percent || 0)]));

    let trustRows = [];
    try {
      const colsResult = await pool.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema='public' AND table_name='decision_view'`
      );
      const colSet = new Set((colsResult.rows || []).map((r) => String(r.column_name || '')));
      const sipExpr = colSet.has('sip_score') ? 'COALESCE(sip_score, 0)::numeric AS sip_score' : '0::numeric AS sip_score';
      const qualityExpr = colSet.has('quality_score') ? 'COALESCE(quality_score, 0)::numeric AS quality_score' : '0::numeric AS quality_score';
      const rvolExpr = colSet.has('relative_volume') ? 'COALESCE(relative_volume, 0)::numeric AS relative_volume' : '0::numeric AS relative_volume';
      const volumeExpr = colSet.has('volume') ? 'COALESCE(volume, 0)::numeric AS volume' : '0::numeric AS volume';
      const avgVolExpr = colSet.has('avg_volume_30d') ? 'COALESCE(avg_volume_30d, 0)::numeric AS avg_volume_30d' : '0::numeric AS avg_volume_30d';
      const gapExpr = colSet.has('gap_percent') ? 'COALESCE(gap_percent, 0)::numeric AS gap_percent' : '0::numeric AS gap_percent';
      const changeExpr = colSet.has('change_percent') ? 'COALESCE(change_percent, 0)::numeric AS change_percent' : '0::numeric AS change_percent';
      const newsExpr = colSet.has('news_score') ? 'COALESCE(news_score, 0)::numeric AS news_score' : '0::numeric AS news_score';
      const trendExpr = colSet.has('trend_alignment') ? 'COALESCE(trend_alignment, false) AS trend_alignment' : 'false AS trend_alignment';
      const vwapExpr = colSet.has('vwap') ? 'vwap::numeric AS vwap' : 'NULL::numeric AS vwap';

      const trustResult = await pool.query(
        `SELECT
           UPPER(symbol) AS symbol,
           strategy,
           strategy_win_rate,
           symbol_win_rate,
           tqi_score,
           session_phase,
           session_weight,
           decision_score,
           final_score,
           boost_score,
           earnings_signal,
           ${sipExpr},
           ${qualityExpr},
           ${rvolExpr},
           ${volumeExpr},
           ${avgVolExpr},
           ${gapExpr},
           ${changeExpr},
           ${newsExpr},
           ${trendExpr},
           ${vwapExpr}
         FROM decision_view
         WHERE UPPER(symbol) = ANY($1::text[])`,
        [symbols]
      );
      trustRows = trustResult.rows || [];
    } catch (error) {
      console.warn('[intelligence] decision_view unavailable:', error.message);
    }

    const trustBySymbol = new Map(
      trustRows.map((row) => [String(row.symbol || '').toUpperCase(), row])
    );

    const earningsSoonRows = await pool.query(
      `SELECT DISTINCT UPPER(symbol) AS symbol
       FROM earnings_events
       WHERE symbol = ANY($1::text[])
         AND report_date::date BETWEEN CURRENT_DATE AND (CURRENT_DATE + 1)`,
      [symbols]
    ).catch(() => ({ rows: [] }));
    const earningsMap = Object.create(null);
    for (const row of earningsSoonRows.rows || []) {
      const symbol = String(row.symbol || '').toUpperCase();
      if (symbol) earningsMap[symbol] = true;
    }
    const earningsSoonSet = new Set(Object.keys(earningsMap));
    let context = {};
    try {
      context = await withTimeout(buildOpportunityContext(symbols), 500, 'top-opportunities context timeout');
    } catch {
      context = {};
    }

    let calibrationMap = {};
    let strategyScoreMap = {};
    try {
      const calibrationSeed = await withTimeout(fetchOpportunitiesAndMarket(200), 700, 'top-opportunities calibration timeout');
      const calibrationOutcomes = buildOutcomeRowsFromOpportunities(
        calibrationSeed.opportunities,
        calibrationSeed.marketMap,
        Date.now()
      ).filter((row) => row.outcome !== 'TOO_EARLY');
      calibrationMap = buildCalibrationMap(buildCalibrationResults(calibrationOutcomes));
      strategyScoreMap = buildStrategyScoreMap(buildStrategyRankingResults(calibrationOutcomes));
    } catch {
      calibrationMap = {};
      strategyScoreMap = {};
    }

    let regime = 'normal';
    try {
      const regimeResult = await pool.query(
        `SELECT COALESCE(state_value->>'regime', 'normal') AS regime
         FROM system_state
         WHERE state_key = 'market_regime'
         LIMIT 1`
      );
      regime = String(regimeResult.rows?.[0]?.regime || 'normal');
    } catch (error) {
      console.warn('[intelligence] system_state unavailable for regime lookup:', error.message);
    }

    const decisionTasks = symbols.map(async (symbol) => {
      const trust = trustBySymbol.get(symbol) || {};
      try {
        const decision = {};
        const finalScore = Number.isFinite(Number(trust.final_score))
          ? Number(trust.final_score)
          : null;
        const rawDecisionScore = Number.isFinite(Number(trust.decision_score))
          ? Number(trust.decision_score)
          : (Number.isFinite(Number(decision?.decision_score)) ? Number(decision.decision_score) : null);
        const decisionScore = finalScore ?? rawDecisionScore;
        const strategyWinRate = Number.isFinite(Number(trust.strategy_win_rate)) ? Number(trust.strategy_win_rate) : null;
        const tqiScore = Number.isFinite(Number(trust.tqi_score)) ? Number(trust.tqi_score) : null;
        const sessionPhase = trust.session_phase || decision?.session_phase || null;
        const hasEarnings = Number(trust.earnings_signal || 0) > 0;
        const hasEarningsSoon = hasEarnings || earningsSoonSet.has(symbol);
        const gapPercent = Number.isFinite(Number(trust.gap_percent)) ? Number(trust.gap_percent) : 0;
        const changePercent = Number.isFinite(Number(trust.change_percent))
          ? Number(trust.change_percent)
          : (Number.isFinite(Number(metricChangeMap.get(symbol))) ? Number(metricChangeMap.get(symbol)) : 0);
        const newsScore = Number.isFinite(Number(trust.news_score)) ? Number(trust.news_score) : 0;
        const sipScore = Number.isFinite(Number(trust.sip_score)) ? Number(trust.sip_score) : 0;
        const qualityScore = Number.isFinite(Number(trust.quality_score)) ? Number(trust.quality_score) : 0;
        const trendAlignment = Boolean(trust.trend_alignment);
        const enriched = enrichOpportunity({
          symbol,
          ...decision,
          ...trust,
          gap_percent: gapPercent,
          change_percent: changePercent,
          news_score: newsScore,
          earnings_flag: Boolean(symbol && earningsMap[symbol]),
        }, context);
        const relativeVolume = Number.isFinite(Number(enriched.relative_volume)) ? Number(enriched.relative_volume) : null;
        const narrative = buildNarrative(enriched);

        console.log('ENRICHMENT SAMPLE:', enriched.symbol, {
          rvol: enriched.relative_volume,
          catalyst: enriched.catalyst_type,
          strength: enriched.catalyst_strength,
        });

        const catalystType = enriched.catalyst_type || detectCatalystType({
          hasEarningsSoon,
          gapPercent,
          newsScore,
          relativeVolume,
        });
        const strategyDerived = detectStrategy({
          hasEarningsSoon,
          gapPercent,
          relativeVolume,
        });
        const executionPlan = buildExecutionPlan({ strategy: strategyDerived, gapPercent });

        const confidenceRaw =
          (Number.isFinite(Number(decisionScore)) ? Number(decisionScore) : 0) * 0.6
          + sipScore * 0.3
          + qualityScore * 0.3;

        const whyMoving = `${narrative.why_moving}. ${catalystType}: gap ${gapPercent.toFixed(2)}%, RVOL ${Number(relativeVolume || 0).toFixed(2)}, news score ${newsScore.toFixed(2)}.`;
        const whyTradeable = `${narrative.why_tradeable}. SIP ${sipScore.toFixed(2)} + quality ${qualityScore.toFixed(2)} with ${trendAlignment ? 'trend alignment' : 'developing structure'}.`;
        const howToTrade = `${narrative.execution_plan}. ${toShortHowToTrade(executionPlan)}`;

        return {
          symbol,
          final_score: decisionScore,
          decision_score: rawDecisionScore,
          score_primary: decisionScore,
          raw_decision_score: decision?.decision_score ?? null,
          boost_score: Number.isFinite(Number(trust.boost_score)) ? Number(trust.boost_score) : null,
          tqi_score: tqiScore,
          catalyst_type: catalystType,
          catalyst_strength: Number.isFinite(Number(enriched.catalyst_strength)) ? Number(enriched.catalyst_strength) : null,
          change_percent: Number.isFinite(changePercent) ? Number(changePercent) : 0,
          strategy: strategyDerived,
          relative_volume: relativeVolume,
          trade_confidence_raw: Number(confidenceRaw.toFixed(4)),
          earnings_flag: Boolean(enriched.earnings_flag),
          news_count: Number(enriched.news_count || 0),
          why_moving: whyMoving,
          why_tradeable: whyTradeable,
          how_to_trade: howToTrade,
          win_rate: strategyWinRate,
          regime,
          session_phase: sessionPhase,
          explanation: buildOpportunityExplanation({
            tqiScore,
            winRate: strategyWinRate,
            regime,
            sessionPhase,
            hasEarnings,
          }),
          execution_plan: executionPlan,
          truth_valid: decision?.truth_valid ?? false,
          truth_reason: decision?.truth_reason ?? null,
          execution_valid: decision?.execution_valid ?? false,
          setup_quality: decision?.setup_quality ?? 'LOW',
          trade_class: decision?.trade_class ?? 'UNTRADEABLE',
          action: decision?.action ?? 'AVOID',
          tradeable: false,
          reason_block: null,
          mode: sessionContext.mode,
          session: sessionContext.session,
          session_weight: Number(sessionContext.scoreWeight || 1),
          position_size: decision?.position_size ?? null,
          risk_per_share: decision?.risk_per_share ?? null,
          max_risk: decision?.max_risk ?? 10,
          data_quality: decision?.data_quality ?? 'insufficient',
        };
      } catch (error) {
        const fallbackPlan = buildExecutionPlan({ strategy: 'INTRADAY TREND', gapPercent: 0 });
        const fallbackChange = Number.isFinite(Number(trust.change_percent))
          ? Number(trust.change_percent)
          : (Number.isFinite(Number(metricChangeMap.get(symbol))) ? Number(metricChangeMap.get(symbol)) : 0);
        return {
          symbol,
          final_score: null,
          decision_score: null,
          score_primary: null,
          raw_decision_score: null,
          boost_score: null,
          tqi_score: Number.isFinite(Number(trust.tqi_score)) ? Number(trust.tqi_score) : null,
          change_percent: Number.isFinite(fallbackChange) ? Number(fallbackChange) : 0,
          strategy: 'INTRADAY TREND',
          catalyst_type: 'OTHER',
          trade_confidence_raw: 0,
          why_moving: 'OTHER: gap 0.00%, RVOL 0.00, news score 0.00.',
          why_tradeable: 'SIP 0.00 + quality 0.00 with developing structure.',
          how_to_trade: toShortHowToTrade(fallbackPlan),
          win_rate: Number.isFinite(Number(trust.strategy_win_rate)) ? Number(trust.strategy_win_rate) : null,
          regime,
          session_phase: trust.session_phase || null,
          explanation: buildOpportunityExplanation({
            tqiScore: trust.tqi_score,
            winRate: trust.strategy_win_rate,
            regime,
            sessionPhase: trust.session_phase,
            hasEarnings: Number(trust.earnings_signal || 0) > 0,
          }),
          execution_plan: fallbackPlan,
          truth_valid: false,
          truth_reason: 'ENGINE_ERROR',
          execution_valid: false,
          setup_quality: 'LOW',
          trade_class: 'UNTRADEABLE',
          action: 'AVOID',
          tradeable: false,
          reason_block: 'ENGINE_ERROR',
          mode: sessionContext.mode,
          session: sessionContext.session,
          session_weight: Number(sessionContext.scoreWeight || 1),
          position_size: null,
          risk_per_share: null,
          max_risk: 10,
          data_quality: 'insufficient',
          error: error.message,
        };
      }
    });

    const settled = await Promise.allSettled(decisionTasks);

    const decisions = settled
      .filter((item) => item.status === 'fulfilled')
      .map((item) => item.value)
      .filter(Boolean);

    const scoreInputs = decisions.map((row) => {
      if (Number.isFinite(Number(row.final_score))) return Number(row.final_score);
      if (Number.isFinite(Number(row.decision_score))) return Number(row.decision_score);
      if (Number.isFinite(Number(row.score_primary))) return Number(row.score_primary);
      return 0;
    });

    const scoreMin = scoreInputs.length ? Math.min(...scoreInputs) : 0;
    const scoreMax = scoreInputs.length ? Math.max(...scoreInputs) : 0;
    if (scoreInputs.length > 0 && scoreMax === scoreMin) {
      throw new Error('SCORE COLLAPSE DETECTED');
    }

    const normalizedFinalScores = scoreInputs.length > 0
      ? scoreInputs.map((rawScore) => Number((((rawScore - scoreMin) / (scoreMax - scoreMin)) * 100).toFixed(4)))
      : [];

    const normalizedConfidence = normalizeTo100(decisions.map((row) => row.trade_confidence_raw || 0));
    const completenessFields = [
      'symbol',
      'strategy',
      'why_moving',
      'why_tradeable',
      'how_to_trade',
      'execution_plan.entry',
      'execution_plan.stop',
      'execution_plan.target',
      'trade_confidence',
      'data_quality',
    ];

    for (let i = 0; i < decisions.length; i += 1) {
      decisions[i].trade_confidence = Number(normalizedConfidence[i] || 0);
      decisions[i].final_score = Number.isFinite(Number(normalizedFinalScores[i])) ? Number(normalizedFinalScores[i]) : null;
      decisions[i].completeness = completenessScore(decisions[i], completenessFields);
      decisions[i].confidence = Number.isFinite(decisions[i].trade_confidence)
        ? Number((Math.max(0, Math.min(100, decisions[i].trade_confidence)) / 100).toFixed(4))
        : null;
      decisions[i].adjusted_confidence = Number(adjustConfidence(decisions[i], calibrationMap).toFixed(4));
      decisions[i].confidence_context_percent = Number.isFinite(Number(decisions[i].adjusted_confidence))
        ? Number((Number(decisions[i].adjusted_confidence) * 100).toFixed(2))
        : null;
      decisions[i].trade_quality = tradeQualityScore(decisions[i]);
      decisions[i].rvol = Number.isFinite(Number(decisions[i].rvol))
        ? Number(decisions[i].rvol)
        : (Number.isFinite(Number(decisions[i].relative_volume)) ? Number(decisions[i].relative_volume) : 0);
      decisions[i].trade_quality_score = calculateTradeQualityScore({
        catalystStrength: Number(decisions[i].catalyst_strength || 0),
        rvol: Number(decisions[i].rvol || 0),
        structureScore: Number(decisions[i].structure_score || 0),
        winRate: Number(decisions[i].win_rate || 0),
      });
      const learningWeight =
        (Number(decisions[i].trade_quality || 0) * 0.5) +
        (Number(decisions[i].confidence || 0) * 0.3) +
        (Number(decisions[i].catalyst_strength || 0) * 0.2);
      decisions[i].learning_weight = Number(learningWeight.toFixed(4));
      const strategyFactor = strategyScoreMap[normalizeStrategyKey(decisions[i].strategy)] || 1;
      const basePriority = Number(decisions[i].trade_quality || 0) * 0.6 + Number(decisions[i].trade_confidence || 0) * 0.4;
      decisions[i].priority_score = Number((
        basePriority *
        (decisions[i].adjusted_confidence || 1) *
        strategyFactor
      ).toFixed(4));

      const weightedPriority = applySessionWeighting(decisions[i].priority_score, sessionContext);
      if (Number.isFinite(weightedPriority)) {
        decisions[i].priority_score = weightedPriority;
      }

      const weightedQuality = applySessionWeighting(decisions[i].trade_quality_score, sessionContext);
      if (Number.isFinite(weightedQuality)) {
        decisions[i].trade_quality_score_weighted = weightedQuality;
      }

      const baseTradeable =
        String(decisions[i].action || '').toUpperCase() !== 'AVOID' &&
        String(decisions[i].trade_class || '').toUpperCase() !== 'UNTRADEABLE' &&
        String(decisions[i].data_quality || '').toLowerCase() !== 'insufficient';

      const gatedRow = applySessionGating(
        {
          ...decisions[i],
          tradeable: baseTradeable,
        },
        sessionContext
      );

      decisions[i].session = gatedRow.session;
      decisions[i].mode = gatedRow.mode;
      decisions[i].session_weight = gatedRow.session_weight;
      decisions[i].tradeable = gatedRow.tradeable;
      decisions[i].reason_block = gatedRow.reason_block;
      decisions[i].action = gatedRow.action;
      decisions[i].trade_class = gatedRow.trade_class;

      console.log('LEARNING SIGNAL:', {
        symbol: decisions[i].symbol,
        strategy: decisions[i].strategy,
        quality: decisions[i].trade_quality,
        learning_weight: decisions[i].learning_weight,
      });
      delete decisions[i].trade_confidence_raw;
    }

    const uniqueScores = new Set(
      decisions
        .map((row) => Number(row.final_score))
        .filter((value) => Number.isFinite(value))
    );
    if (uniqueScores.size < 5) {
      console.error('LOW SCORE VARIANCE WARNING');
    }

    decisions.forEach((row) => {
      const missingRvol = row.relative_volume == null;
      const missingChange = row.change_percent == null;
      const missingCatalyst = row.catalyst_type == null;
      if (missingRvol && missingChange && missingCatalyst) {
        console.error('INVALID INPUT DATA — SCORING UNRELIABLE', {
          symbol: row.symbol,
        });
      }
    });

    const nonNullScores = decisions.filter((row) => Number.isFinite(row.final_score)).length;
    const nullRate = decisions.length === 0 ? 1 : ((decisions.length - nonNullScores) / decisions.length);
    if (nullRate > 0.7) {
      console.warn('[INTELLIGENCE_GUARD] high decision null rate', {
        endpoint: '/api/intelligence/top-opportunities',
        total: decisions.length,
        non_null_scores: nonNullScores,
        null_rate: Number((nullRate * 100).toFixed(2)),
      });
    }

    const sorted = decisions.sort((a, b) => {
      const aq = Number.isFinite(Number(a.trade_quality_score)) ? Number(a.trade_quality_score) : -Infinity;
      const bq = Number.isFinite(Number(b.trade_quality_score)) ? Number(b.trade_quality_score) : -Infinity;
      if (bq !== aq) return bq - aq;
      const av = Number.isFinite(a.final_score) ? a.final_score : -Infinity;
      const bv = Number.isFinite(b.final_score) ? b.final_score : -Infinity;
      return bv - av;
    });

    let results = sorted;

    if (strict) {
      results = results.filter((row) => {
        const qualityPass = Number(row.trade_quality || 0) >= 70;
        const dataQualityPass = String(row.data_quality || '').toLowerCase() !== 'insufficient';
        return qualityPass && dataQualityPass;
      });
    }

    results = results.slice(0, hardResultLimit)
      .map((row) => {
        const built = buildFinalTradeObject(row, 'intelligence_top_opportunities');
        if (!built) {
          console.error('[intelligence] final trade build failed', { symbol: row?.symbol || null });
          return null;
        }
        const check = validateTrade(built);
        if (!check.valid) {
          console.error('[intelligence] invalid top opportunity dropped', { symbol: built.symbol, errors: check.errors });
          return null;
        }
        return {
          ...row,
          ...built,
          confidence: built.confidence,
          trade_confidence: built.trade_confidence,
          expected_move_percent: built.expected_move_percent,
          why_moving: built.why_moving,
          how_to_trade: built.how_to_trade,
          execution_plan: built.execution_plan,
          trade_class: built.trade_class,
          updated_at: built.updated_at,
        };
      })
      .filter(Boolean);

    if (strict) {
      console.log('[STRICT_MODE_VALIDATION]', {
        endpoint: '/api/intelligence/top-opportunities',
        total_before: sorted.length,
        total_after: results.length,
        rejected: sorted.length - results.length,
        threshold_trade_quality: 70,
      });
    }

    console.log('TQI SUMMARY:', {
      total: sorted.length,
      strictCount: results.length,
      topScore: sorted.length > 0
        ? Math.max(...sorted.map((r) => Number(r.trade_quality || 0)))
        : 0,
    });

    const top5 = [...results]
      .sort((a, b) => (Number(b.trade_quality || 0) - Number(a.trade_quality || 0)))
      .slice(0, 5);

    console.log('TOP 5 TQI TRADES:', top5.map((t) => ({
      symbol: t.symbol,
      tqi: t.trade_quality,
      strategy: t.strategy,
    })));

    const validatedTop = results.slice(0, 10);
    const criticalMissing = validatedTop.filter((row) => {
      return !row.strategy || !row.why_moving || !row.execution_plan || !row.execution_plan.entry || !row.execution_plan.stop || !row.execution_plan.target;
    }).length;
    const executionLayerPass = validatedTop.length >= 10 && criticalMissing === 0;
    const candidateRows = results.filter((row) => row?.symbol);

    const enrichedRows = await Promise.all(candidateRows.map(async (row) => {
      const hasWhy = Boolean(String(row?.why || row?.why_moving || '').trim());
      const hasHow = Boolean(String(row?.how || row?.how_to_trade || '').trim());
      if (hasWhy && hasHow) return row;

      const setupResult = await pool.query(
        `SELECT setup
         FROM trade_setups
         WHERE symbol = $1
         ORDER BY COALESCE(updated_at, detected_at, created_at) DESC
         LIMIT 1`,
        [row.symbol]
      ).catch(() => ({ rows: [] }));

      const setup = setupResult.rows?.[0]?.setup;
      const setupObj = setup && typeof setup === 'object' ? setup : null;

      return {
        ...row,
        why: row.why || setupObj?.why || setupObj?.why_moving || null,
        how: row.how || setupObj?.how || setupObj?.how_to_trade || null,
      };
    }));

    const contractRows = enrichedRows
      .map((row) => toContractRow(row))
      .filter(Boolean);

    const finalRows = contractRows.slice(0, hardResultLimit);

    if (!finalRows.length) {
      return res.json({
        success: false,
        error: 'NO_REAL_DATA',
        mode,
        meta: {
          fallback: false,
          reason: 'no_real_data',
        },
      });
    }

    console.log('[TOP-OPPORTUNITIES SOURCE CHECK]', {
      rows: finalRows.length,
      internal_rows: candidateRows.length,
      response_source: 'real',
    });

    logResponseShape('/api/intelligence/top-opportunities', finalRows, ['symbol', 'why', 'how', 'confidence', 'expected_move']);

    return res.json({
      success: true,
      source: 'real',
      mode,
      count: finalRows.length,
      data: finalRows,
    });
  } catch (error) {
    console.error('[intelligence] top-opportunities error:', error.message);
    return res.json({
      success: false,
      error: 'NO_REAL_DATA',
      mode,
      meta: {
        fallback: false,
        reason: 'no_real_data',
      },
    });
  }
});

router.get('/api/intelligence/watchlist', async (req, res) => {
  const rawLimit = Number.parseInt(String(req.query.limit || ''), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 30) : 30;
  const symbolUniverseCap = 30;
  const nowNy = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const nyDay = nowNy.getDay();
  const nyHour = nowNy.getHours();
  const isWeekend = nyDay === 0 || nyDay === 6;
  const isMarketOpen = !isWeekend && nyHour >= 9 && nyHour < 16;

  try {
    const sourceRowsResult = await pool.query(
      `WITH dedup AS (
         SELECT DISTINCT ON (UPPER(symbol))
                UPPER(symbol) AS symbol,
                score,
                gap_percent,
                rvol,
                catalyst,
                price,
                relative_volume
         FROM stocks_in_play_filtered
         WHERE symbol IS NOT NULL
           AND TRIM(symbol) <> ''
         ORDER BY UPPER(symbol), score DESC NULLS LAST
       )
       SELECT *
       FROM dedup
       ORDER BY score DESC NULLS LAST
       LIMIT $1`,
      [symbolUniverseCap]
    );

    const sourceRows = (sourceRowsResult.rows || []);
    const symbols = sourceRows
      .map((row) => String(row.symbol || '').trim().toUpperCase())
      .filter(Boolean);

    // Off-session path: return fast, real watch candidates without expensive decision recomputation.
    if (!isMarketOpen && sourceRows.length > 0) {
      let fastWatchlist = sourceRows
        .slice(0, limit)
        .map((row, idx) => ({
          symbol: String(row.symbol || '').trim().toUpperCase(),
          watchlist_candidate: true,
          watch_priority: Number.isFinite(Number(row.score)) ? Number(row.score) : Math.max(0, 100 - idx),
          watch_reason: row.catalyst ? 'NEWS_PENDING' : (Math.abs(Number(row.gap_percent || 0)) >= 3 ? 'LARGE_MOVE' : 'HIGH_VOLATILITY'),
          score: row.score == null ? null : Number(row.score),
          gap_percent: row.gap_percent == null ? null : Number(row.gap_percent),
          relative_volume: row.relative_volume == null ? (row.rvol == null ? null : Number(row.rvol)) : Number(row.relative_volume),
          price: row.price == null ? null : Number(row.price),
          source: 'stocks_in_play_filtered',
        }))
        .filter((item) => item.symbol);

      if (fastWatchlist.length < 10) {
        const supplement = await pool.query(
          `SELECT UPPER(symbol) AS symbol,
                  COALESCE(
                    (to_jsonb(market_metrics)->>'change_percent')::numeric,
                    (to_jsonb(market_metrics)->>'daily_change_percent')::numeric,
                    (to_jsonb(market_metrics)->>'price_change_percent')::numeric,
                    (to_jsonb(market_metrics)->>'percent_change')::numeric,
                    (to_jsonb(market_metrics)->>'changePct')::numeric,
                    0
                  ) AS change_percent,
                  COALESCE(
                    (to_jsonb(market_metrics)->>'price')::numeric,
                    (to_jsonb(market_metrics)->>'last')::numeric,
                    (to_jsonb(market_metrics)->>'close')::numeric,
                    NULL
                  ) AS price
           FROM market_metrics
           WHERE symbol IS NOT NULL
             AND TRIM(symbol) <> ''
           ORDER BY ABS(COALESCE(
             (to_jsonb(market_metrics)->>'change_percent')::numeric,
             (to_jsonb(market_metrics)->>'daily_change_percent')::numeric,
             (to_jsonb(market_metrics)->>'price_change_percent')::numeric,
             (to_jsonb(market_metrics)->>'percent_change')::numeric,
             (to_jsonb(market_metrics)->>'changePct')::numeric,
             0
           )) DESC NULLS LAST
           LIMIT 30`
        );

        const existing = new Set(fastWatchlist.map((item) => item.symbol));
        for (const [idx, row] of (supplement.rows || []).entries()) {
          const symbol = String(row.symbol || '').trim().toUpperCase();
          if (!symbol || existing.has(symbol)) continue;
          fastWatchlist.push({
            symbol,
            watchlist_candidate: true,
            watch_priority: Math.max(0, 60 - idx),
            watch_reason: 'LARGE_MOVE',
            score: null,
            gap_percent: null,
            relative_volume: null,
            price: row.price == null ? null : Number(row.price),
            change_percent: Number(row.change_percent || 0),
            source: 'market_metrics_fallback',
          });
          existing.add(symbol);
          if (fastWatchlist.length >= Math.min(limit, 30)) break;
        }
      }

      return res.json({
        status: 'ok',
        data: fastWatchlist.slice(0, limit),
        count: Math.min(fastWatchlist.length, limit),
        source: 'intelligence_watchlist_engine',
      });
    }

    // Keep additive fallback source when filtered view is empty in market hours.
    let decisionSymbols = symbols;
    if (decisionSymbols.length === 0) {
      const fallbackSymbols = await pool.query(
        `SELECT UPPER(symbol) AS symbol
         FROM decision_view
         WHERE symbol IS NOT NULL
           AND TRIM(symbol) <> ''
         ORDER BY final_score DESC NULLS LAST
         LIMIT $1`,
        [symbolUniverseCap]
      );
      decisionSymbols = (fallbackSymbols.rows || [])
        .map((row) => String(row.symbol || '').trim().toUpperCase())
        .filter(Boolean);
    }

    const settled = await Promise.allSettled(
      decisionSymbols.slice(0, Math.min(symbolUniverseCap, 20)).map((symbol) => withTimeout(
        (async () => {
          try {
            return await buildDecision(symbol);
          } catch {
            // keep additive and resilient; a single symbol failure should not break watchlist.
            return null;
          }
        })(),
        150,
        `buildDecision timeout for ${symbol}`
      ))
    );

    const decisions = settled
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value)
      .filter(Boolean);

    let watchlist = decisions
      .filter((d) => d?.watchlist_candidate === true)
      .sort((a, b) => Number(b?.watch_priority || 0) - Number(a?.watch_priority || 0))
      .slice(0, limit);

    // Non-empty guarantee sourced from real market metrics if decision builds produce none.
    if (watchlist.length === 0) {
      const fallback = await pool.query(
        `SELECT UPPER(symbol) AS symbol,
                COALESCE(
                  (to_jsonb(market_metrics)->>'change_percent')::numeric,
                  (to_jsonb(market_metrics)->>'daily_change_percent')::numeric,
                  (to_jsonb(market_metrics)->>'price_change_percent')::numeric,
                  (to_jsonb(market_metrics)->>'percent_change')::numeric,
                  (to_jsonb(market_metrics)->>'changePct')::numeric,
                  0
                ) AS change_percent,
                COALESCE(
                  (to_jsonb(market_metrics)->>'price')::numeric,
                  (to_jsonb(market_metrics)->>'last')::numeric,
                  (to_jsonb(market_metrics)->>'close')::numeric,
                  NULL
                ) AS price
         FROM market_metrics
         WHERE symbol IS NOT NULL
           AND TRIM(symbol) <> ''
         ORDER BY ABS(COALESCE(
           (to_jsonb(market_metrics)->>'change_percent')::numeric,
           (to_jsonb(market_metrics)->>'daily_change_percent')::numeric,
           (to_jsonb(market_metrics)->>'price_change_percent')::numeric,
           (to_jsonb(market_metrics)->>'percent_change')::numeric,
           (to_jsonb(market_metrics)->>'changePct')::numeric,
           0
         )) DESC NULLS LAST
         LIMIT 10`
      );

      watchlist = (fallback.rows || []).map((row, idx) => ({
        symbol: String(row.symbol || '').trim().toUpperCase(),
        watchlist_candidate: true,
        watch_priority: Math.max(0, 100 - idx),
        watch_reason: 'LARGE_MOVE',
        change_percent: Number(row.change_percent || 0),
        price: row.price == null ? null : Number(row.price),
        source: 'market_metrics_fallback',
      })).filter((item) => item.symbol).slice(0, Math.min(limit, 10));
    }

    return res.json({
      status: 'ok',
      data: watchlist,
      count: watchlist.length,
      source: 'intelligence_watchlist_engine',
    });
  } catch (error) {
    console.error('[intelligence] watchlist error:', error.message);
    return res.status(500).json({
      status: 'error',
      source: 'intelligence_watchlist_engine',
      data: [],
      error: error.message || 'Failed to build watchlist',
    });
  }
});

router.get('/api/intelligence/diagnostics', async (req, res) => {
  const rawLimit = Number.parseInt(String(req.query.limit || ''), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50;

  try {
    const symbolResult = await pool.query(
      `SELECT UPPER(symbol) AS symbol
       FROM decision_view
       WHERE symbol IS NOT NULL
         AND TRIM(symbol) <> ''
       ORDER BY final_score DESC NULLS LAST
       LIMIT $1`,
      [limit]
    );

    const symbols = (symbolResult.rows || [])
      .map((row) => String(row.symbol || '').trim().toUpperCase())
      .filter(Boolean);

    const decisions = [];
    for (const symbol of symbols) {
      try {
        const decision = await buildDecision(symbol);
        decisions.push(decision);
      } catch (error) {
        decisions.push({
          symbol,
          trade_class: 'UNTRADEABLE',
          truth_valid: false,
          execution_valid: false,
          truth_reason: 'ENGINE_ERROR',
          execution_reason: 'ENGINE_ERROR',
          trade_quality_score: 0,
          setup: 'WATCHLIST_ONLY',
        });
      }
    }

    const stats = analyzeDecisionFailures(decisions);
    const sampleFailures = decisions
      .filter((d) => d?.trade_class !== 'A' && d?.trade_class !== 'B')
      .slice(0, 5)
      .map((d) => ({
        symbol: d?.symbol || null,
        trade_class: d?.trade_class || 'UNTRADEABLE',
        truth_reason: d?.truth_reason || null,
        execution_reason: d?.execution_reason || null,
        trade_quality_score: Number.isFinite(Number(d?.trade_quality_score)) ? Number(d.trade_quality_score) : null,
      }));

    return res.json({
      status: 'ok',
      data: stats,
      sample_failures: sampleFailures,
    });
  } catch (error) {
    console.error('[intelligence] diagnostics error:', error.message);
    return res.status(500).json({
      status: 'error',
      source: 'intelligence_diagnostics',
      data: null,
      error: error.message || 'Failed to build diagnostics',
    });
  }
});

router.get('/api/intelligence/decision', async (req, res) => {
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  if (!symbol) {
    return res.json({
      ok: true,
      status: 'fallback',
      source: 'route',
      data: [],
      decision: null,
      message: 'Provide a symbol via /api/intelligence/decision/:symbol or ?symbol=AAPL',
    });
  }

  try {
    return await sendDecisionResponse(symbol, res);
  } catch (error) {
    console.error('[intelligence] decision error:', error.message);
    return res.status(500).json({
      ok: false,
      status: 'error',
      source: 'truth_engine',
      data: [],
      error: error.message || 'Failed to build intelligence decision',
    });
  }
});

router.get('/api/intelligence/decision/:symbol', async (req, res) => {
  const symbol = String(req.params.symbol || '').trim().toUpperCase();
  console.log('Decision request:', symbol);
  if (!symbol) {
    return res.json({
      ok: true,
      status: 'fallback',
      source: 'route',
      data: [],
      decision: null,
      message: 'symbol is required',
    });
  }

  try {
    return await sendDecisionResponse(symbol, res);
  } catch (error) {
    console.error('[intelligence] decision error:', error.message);
    return res.status(500).json({
      ok: false,
      status: 'error',
      source: 'truth_engine',
      data: [],
      error: error.message || 'Failed to build intelligence decision',
    });
  }
});

router.get('/api/intelligence/why-moving/:symbol', async (req, res) => {
  const symbol = String(req.params.symbol || '').trim().toUpperCase();
  if (!symbol) {
    return res.status(400).json({ ok: false, error: 'symbol is required' });
  }

  try {
    const cachedWhyMoving = getFreshCachedValue(whyMovingCache, symbol, WHY_MOVING_CACHE_TTL_MS);
    if (cachedWhyMoving) {
      return res.json(cachedWhyMoving);
    }

    const decision = await buildTruthDecisionForSymbol(symbol);
    const whyMoving = decision.why_moving;

    const response = {
      ok: true,
      status: 'ok',
      source: 'truth_engine',
      symbol,
      decision,
      why_moving: whyMoving,
      data: whyMoving,
    };

    whyMovingCache.set(symbol, {
      data: response,
      timestamp: Date.now(),
    });

    return res.json(response);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      status: 'error',
      source: 'truth_engine',
      error: error.message || 'Failed to build why-moving payload',
      data: null,
    });
  }
});

// GET /api/intelligence/top-focus — top 3-5 high-probability, regime-aligned trades
//
// Query params:
//   limit  — max results (1–10, default 5)
//   mode   — "focus" (default) | "all" (disables hard filters, returns all scored signals)
router.get('/api/intelligence/top-focus', async (req, res) => {
  try {
    const limit   = Math.max(1, Math.min(10, parseInt(req.query.limit, 10) || 5));
    const modeAll = req.query.mode === 'all';

    // Time-aware mode detection
    const marketCtx  = getMarketMode();
    const windowStr  = getModeWindow(marketCtx.mode);
    const minConf    = getModeMinConfidence(marketCtx.mode);

    // In LIVE mode: require mcp_narrative_engine source for freshest signals
    // In RECENT/PREP mode: broaden to all ranked sources so weekends/after-hours always return data
    const sourceFilter = marketCtx.mode === 'LIVE'
      ? `AND source = 'mcp_narrative_engine'`
      : `AND source IN ('mcp_narrative_engine', 'opportunity_ranker', 'real')`;

    console.log(`[top-focus] mode=${marketCtx.mode} window=${windowStr} minConf=${minConf} sources=${marketCtx.mode === 'LIVE' ? 'mcp_only' : 'all'}`);

    const { rows } = await queryWithTimeout(`
      WITH latest AS (
        SELECT DISTINCT ON (symbol)
          symbol, why, consequence, plan, confidence, outlook,
          performance_note, regime_context, trade_score, regime_alignment,
          updated_at, source
        FROM opportunity_stream
        WHERE updated_at > NOW() - INTERVAL '${windowStr}'
          AND COALESCE(confidence, 0) >= ${minConf}
          ${sourceFilter}
        ORDER BY symbol, updated_at DESC
      )
      SELECT
        l.*,
        COALESCE(m.price, 0)             AS price,
        COALESCE(m.change_percent, 0)    AS change_percent,
        COALESCE(m.relative_volume, 0)   AS relative_volume,
        COALESCE(q.market_cap, 0)        AS market_cap,
        COALESCE(m.avg_volume_30d, 0)    AS avg_volume_30d,
        m.vwap                           AS intraday_high,
        m.previous_close                 AS intraday_low
      FROM latest l
      LEFT JOIN market_metrics m  ON m.symbol = l.symbol
      LEFT JOIN market_quotes   q ON q.symbol = l.symbol
    `, [], { timeoutMs: 20000, label: 'top_focus.fetch', maxRetries: 0 });

    console.log(`[top-focus] fetched ${rows.length} candidates`);

    const result = selectTopOpportunities(rows, modeAll ? rows.length : limit);

    const signals = result.top.map((sig, idx) => {
      const levels = computeLevels(sig);
      return {
        rank:              idx + 1,
        symbol:            sig.symbol,
        trade_score:       sig.trade_score,
        regime_alignment:  sig.regime_alignment,
        confidence:        Number(sig.confidence  || 0),
        price:             Number(sig.price        || 0),
        change_percent:    Number(sig.change_percent || 0),
        relative_volume:   Number(sig.relative_volume || 0),
        why:               sig.why         || null,
        consequence:       sig.consequence || null,
        plan:              sig.plan        || null,
        performance_note:  sig.performance_note || null,
        regime_context:    sig.regime_context   || null,
        outlook:           sig.outlook          || null,
        direction:         levels.direction,
        entry:             levels.entry,
        stop:              levels.stop,
        target:            levels.target,
        updated_at:        sig.updated_at,
        data_window:       windowStr,
      };
    });

    res.json({
      focus_mode:    !modeAll,
      market_mode:   marketCtx.mode,
      market_reason: marketCtx.reason,
      regime: result.regime
        ? {
          trend:      result.regime.trend,
          volatility: result.regime.volatility,
          liquidity:  result.regime.liquidity,
          session:    result.regime.session_type,
        }
        : null,
      signals,
      meta: {
        total_evaluated: result.total_scored + result.total_filtered,
        total_passed:    result.total_scored,
        total_filtered:  result.total_filtered,
        limit,
        mode:            modeAll ? 'all' : 'focus',
        data_window:     windowStr,
        market_mode:     marketCtx.mode,
      },
    });
  } catch (err) {
    console.error('[top-focus] error:', err.message, err.stack);
    res.json({ signals: [], market_mode: 'UNKNOWN', meta: { error: err.message } });
  }
});

// PATCH /api/intelligence/:id/reviewed — mark as processed, JWT protected
router.patch('/api/intelligence/:id/reviewed', authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) return res.status(400).json({ ok: false, error: 'Invalid id' });
  try {
    const { rowCount } = await pool.query(
      `UPDATE intelligence_emails SET processed = TRUE WHERE id = $1`,
      [id]
    );
    if (rowCount === 0) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[intelligence] reviewed error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
