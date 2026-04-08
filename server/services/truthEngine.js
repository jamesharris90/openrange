const { queryWithTimeout } = require('../db/pg');
const { getResearchTerminalPayload } = require('./researchCacheService');
const { generateWhyMovingPayload } = require('../engines/whyMovingEngine');
const { buildEarningsEdge: buildEarningsEdgeEngine } = require('../engines/earningsEdgeEngine');
const { buildEarningsIntelligence, calculateDrift } = require('./earningsIntelligence');
const { buildDecisionNarrative } = require('./gptNarrativeService');

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeBias(value) {
  const bias = String(value || '').trim().toUpperCase();
  if (bias === 'BULLISH' || bias === 'LONG') return 'BULLISH';
  if (bias === 'BEARISH' || bias === 'SHORT') return 'BEARISH';
  return 'NEUTRAL';
}

function normalizeDriver(value) {
  const driver = String(value || '').trim().toUpperCase();
  return driver || 'NO_DRIVER';
}

function normalizeSetup(value) {
  const setup = String(value || '').trim();
  return setup || 'NO_SETUP';
}

function normalizeDate(value) {
  const parsed = Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function daysUntil(value) {
  const iso = normalizeDate(value);
  if (!iso) return null;
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const target = new Date(`${iso}T00:00:00.000Z`);
  const targetUtc = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  return Math.round((targetUtc - todayUtc) / 86400000);
}

function mapRegimeToBias(regimeBias) {
  const value = String(regimeBias || '').trim().toUpperCase();
  if (value.includes('AVOID')) return 'BEARISH';
  if (value.includes('MOMENTUM')) return 'BULLISH';
  return 'NEUTRAL';
}

function summarizeTradePlan(tradePlan) {
  if (!tradePlan || typeof tradePlan !== 'object') {
    return null;
  }

  return {
    entry: String(tradePlan.entry || '').trim() || null,
    stop: String(tradePlan.stop || '').trim() || null,
    target: String(tradePlan.target || '').trim() || null,
    invalidation: String(tradePlan.invalidation || '').trim() || null,
    timeframe: String(tradePlan.timeframe || '').trim() || null,
  };
}

function normalizeEarningsEdge(earningsEdge, earnings) {
  const edgeScore = toNumber(earningsEdge?.edgeScore ?? earningsEdge?.edge_score) || 0;
  const edgeLabel = String(earningsEdge?.edgeLabel || earningsEdge?.edge_label || 'NO_EDGE').trim() || 'NO_EDGE';
  const bias = normalizeBias(earningsEdge?.directionalBias || earningsEdge?.directional_bias);
  const expectedMovePercent = toNumber(earnings?.next?.expected_move_percent ?? earnings?.next?.expectedMove);

  return {
    label: edgeLabel,
    score: edgeScore,
    bias,
    next_date: normalizeDate(earnings?.next?.date),
    report_time: String(earnings?.next?.report_time || '').trim() || null,
    expected_move_percent: expectedMovePercent,
    status: String(earnings?.status || 'none').trim().toLowerCase() || 'none',
    read: String(earnings?.read || earningsEdge?.read || '').trim() || null,
  };
}

function countStructuredSignals(strategySignals) {
  return (Array.isArray(strategySignals?.setups) ? strategySignals.setups : []).filter((row) => row.strategy).length;
}

function evaluateTradeTruth({ catalystType, rvol, structureScore }) {
  if (!catalystType) {
    return { valid: false, reason: 'NO_CATALYST' };
  }

  if (!rvol || rvol < 1.5) {
    return { valid: false, reason: 'LOW_VOLUME' };
  }

  if (!structureScore || structureScore < 2) {
    return { valid: false, reason: 'WEAK_STRUCTURE' };
  }

  return { valid: true };
}

function calculateTradeQualityScore({
  catalystStrength = 0,
  rvol = 0,
  structureScore = 0,
  winRate = 0,
}) {
  return Math.round(
    catalystStrength * 0.3
    + rvol * 0.25
    + structureScore * 0.25
    + winRate * 0.2,
  );
}

async function loadStrategySignals(symbol) {
  const [setupsResult, opportunityResult] = await Promise.all([
    queryWithTimeout(
      `SELECT
         COALESCE(NULLIF(TRIM(setup_type), ''), NULLIF(TRIM(setup), '')) AS strategy,
         score,
         entry_price,
         detected_at,
         updated_at
       FROM trade_setups
       WHERE UPPER(symbol) = $1
       ORDER BY score DESC NULLS LAST, COALESCE(detected_at, updated_at) DESC NULLS LAST
       LIMIT 3`,
      [symbol],
      { timeoutMs: 2500, label: 'truth_engine.trade_setups', maxRetries: 0 }
    ).catch(() => ({ rows: [] })),
    queryWithTimeout(
      `SELECT score, headline, event_type, created_at
       FROM opportunity_stream
       WHERE UPPER(symbol) = $1
       ORDER BY created_at DESC NULLS LAST
       LIMIT 1`,
      [symbol],
      { timeoutMs: 2500, label: 'truth_engine.opportunity_stream', maxRetries: 0 }
    ).catch(() => ({ rows: [] })),
  ]);

  const setups = (setupsResult.rows || []).map((row) => ({
    strategy: String(row.strategy || '').trim() || null,
    score: toNumber(row.score),
    entry_price: toNumber(row.entry_price),
    detected_at: row.detected_at || row.updated_at || null,
  })).filter((row) => row.strategy);

  const stream = opportunityResult.rows?.[0] || null;

  return {
    setups,
    top_setup: setups[0] || null,
    stream_score: toNumber(stream?.score),
    stream_headline: String(stream?.headline || '').trim() || null,
    stream_type: String(stream?.event_type || '').trim() || null,
  };
}

function buildRiskFlags({ whyMoving, earnings, context, strategySignals, price }) {
  const flags = [];
  const tradeability = String(whyMoving?.tradeability || '').trim().toUpperCase();
  const rvol = toNumber(price?.relative_volume) ?? toNumber(price?.rvol);
  const daysToEarnings = daysUntil(earnings?.next?.date);
  const earningsStatus = String(earnings?.status || 'none').trim().toLowerCase();

  if (tradeability === 'LOW') flags.push('LOW_CONVICTION');
  if (rvol !== null && rvol < 1.5) flags.push('LOW_RVOL');
  if (!strategySignals?.top_setup?.strategy) flags.push('NO_STRUCTURED_SETUP');
  if (String(context?.regime || '').trim().toLowerCase() === 'risk_off') flags.push('RISK_OFF_TAPE');
  if (earningsStatus === 'partial') flags.push('EARNINGS_ESTIMATING');
  if (daysToEarnings !== null && daysToEarnings >= 0 && daysToEarnings <= 3) flags.push('EARNINGS_NEAR');
  if (toNumber(price?.price) === null || toNumber(price?.atr) === null) flags.push('MISSING_EXECUTION_DATA');

  return flags;
}

function computeDecisionCore({ symbol, payload, earningsEdge, whyMoving, strategySignals }) {
  const bias = normalizeBias(
    whyMoving?.bias
      || earningsEdge?.bias
      || mapRegimeToBias(payload?.context?.regimeBias)
  );
  const driver = normalizeDriver(whyMoving?.driver);
  const setup = normalizeSetup(strategySignals?.top_setup?.strategy || whyMoving?.setup);
  const setupScore = toNumber(strategySignals?.top_setup?.score) || 0;
  const baseConfidence = toNumber(whyMoving?.confidence_score) || 20;
  const edgeScore = toNumber(earningsEdge?.score) || 0;
  const sectorTailwind = Boolean(payload?.context?.sectorTailwind);
  const riskFlags = buildRiskFlags({
    whyMoving,
    earnings: payload?.earnings,
    context: payload?.context,
    strategySignals,
    price: {
      ...payload?.price,
      relative_volume: payload?.price?.relative_volume ?? payload?.metrics?.relative_volume,
    },
  });

  let confidence = baseConfidence;
  if (setupScore >= 80) confidence += 8;
  else if (setupScore >= 60) confidence += 4;
  if (edgeScore >= 7) confidence += 5;
  else if (edgeScore >= 4) confidence += 2;
  if (sectorTailwind) confidence += 3;
  if (riskFlags.includes('RISK_OFF_TAPE')) confidence -= 8;
  if (riskFlags.includes('EARNINGS_ESTIMATING')) confidence -= 5;
  if (riskFlags.includes('NO_STRUCTURED_SETUP')) confidence -= 15;
  if (riskFlags.includes('LOW_RVOL')) confidence -= 10;
  confidence = clamp(Math.round(confidence), 0, 100);

  const tradeable = driver !== 'NO_DRIVER'
    && bias !== 'NEUTRAL'
    && !riskFlags.includes('NO_STRUCTURED_SETUP')
    && !riskFlags.includes('LOW_CONVICTION')
    && confidence >= 55;

  const status = tradeable ? 'TRADEABLE' : 'AVOID';
  const executionPlan = summarizeTradePlan(whyMoving?.trade_plan);

  return {
    symbol,
    tradeable,
    confidence,
    setup,
    bias,
    driver,
    earnings_edge: earningsEdge,
    risk_flags: riskFlags,
    status,
    action: tradeable ? 'TRADEABLE' : 'AVOID',
    why: String(whyMoving?.summary || '').trim() || 'No clean driver confirmed.',
    how: executionPlan
      ? [executionPlan.entry, executionPlan.stop, executionPlan.target].filter(Boolean).join(' ')
      : String(whyMoving?.what_to_do || '').trim() || 'Wait for a cleaner setup.',
    risk: String(whyMoving?.what_to_avoid || '').trim() || 'Avoid trading without confirmation.',
    execution_plan: executionPlan
      ? {
          strategy: setup,
          entry: executionPlan.entry,
          stop: executionPlan.stop,
          target: executionPlan.target,
          timeframe: executionPlan.timeframe,
          invalidation: executionPlan.invalidation,
        }
      : null,
    source: 'truth_engine',
  };
}

function isDecisionFallbackError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('max client connections reached')
    || message.includes('too many clients')
    || message.includes('remaining connection slots are reserved')
    || message.includes('query timeout')
    || message.includes('timed out')
  );
}

function buildFallbackDecision(symbol, error) {
  const reason = String(error?.message || 'Decision engine temporarily unavailable');

  return {
    symbol,
    tradeable: false,
    confidence: 0,
    setup: 'UNAVAILABLE',
    bias: 'NEUTRAL',
    driver: 'NO_DRIVER',
    earnings_edge: {
      label: 'NO_EDGE',
      score: 0,
      bias: 'NEUTRAL',
      next_date: null,
      report_time: null,
      expected_move_percent: null,
      status: 'none',
      read: null,
    },
    risk_flags: ['DB_DEGRADED'],
    status: 'DEGRADED',
    action: 'WAIT',
    why: 'Decision engine degraded because the database is temporarily unavailable.',
    how: 'Wait for the backend to recover before using this symbol for a live trade decision.',
    risk: 'Do not trade from this fallback response.',
    execution_plan: null,
    source: 'truth_engine_fallback',
    degraded: true,
    narrative: {
      summary: 'Decision engine degraded because the database is temporarily unavailable.',
      what_to_do: 'Wait for the backend to recover before trading this symbol.',
      what_to_avoid: 'Avoid trading from a degraded fallback response.',
    },
    why_moving: {
      driver: 'NO_DRIVER',
      summary: 'Decision engine degraded because the database is temporarily unavailable.',
      tradeability: 'LOW',
      confidence_score: 0,
      bias: 'NEUTRAL',
      what_to_do: 'Wait for the backend to recover before trading this symbol.',
      what_to_avoid: 'Avoid trading from a degraded fallback response.',
      setup: 'UNAVAILABLE',
      action: 'WAIT',
      trade_plan: null,
    },
    strategy_signals: {
      top_setup: null,
      setup_count: 0,
      stream_score: null,
      stream_headline: null,
    },
    error: reason,
  };
}

function buildCompatibilityWhyMoving(decision, whyMoving) {
  return {
    driver: decision.driver,
    summary: decision.why,
    tradeability: decision.tradeable ? 'HIGH' : 'LOW',
    confidence_score: decision.confidence,
    bias: decision.bias,
    what_to_do: decision.narrative?.what_to_do || String(whyMoving?.what_to_do || '').trim() || decision.how,
    what_to_avoid: decision.narrative?.what_to_avoid || String(whyMoving?.what_to_avoid || '').trim() || decision.risk,
    setup: decision.setup,
    action: decision.action,
    trade_plan: decision.execution_plan
      ? {
          entry: decision.execution_plan.entry,
          stop: decision.execution_plan.stop,
          target: decision.execution_plan.target,
        }
      : null,
  };
}

async function buildTruthDecisionFromPayload({
  symbol: symbolInput,
  payload,
  earningsEdge: earningsEdgeInput,
  whyMoving: whyMovingInput,
  includeNarrative = true,
  allowRemoteNarrative = true,
}) {
  const symbol = normalizeSymbol(symbolInput || payload?.profile?.symbol);
  const strategySignals = await loadStrategySignals(symbol);
  const enrichedHistory = Array.isArray(payload?.earnings?.history)
    ? calculateDrift(buildEarningsIntelligence(payload.earnings.history))
    : [];
  const earningsEdge = normalizeEarningsEdge(
    earningsEdgeInput || buildEarningsEdgeEngine(enrichedHistory),
    payload?.earnings,
  );

  const whyMoving = whyMovingInput || await generateWhyMovingPayload({
    symbol,
    profile: payload?.profile,
    price: payload?.price,
    earnings: {
      ...(payload?.earnings || {}),
      history: enrichedHistory,
      edge: earningsEdgeInput || buildEarningsEdgeEngine(enrichedHistory),
    },
    earningsEdge: earningsEdgeInput || buildEarningsEdgeEngine(enrichedHistory),
    context: payload?.context,
  });

  const decision = computeDecisionCore({ symbol, payload, earningsEdge, whyMoving, strategySignals });

  if (includeNarrative) {
    decision.narrative = await buildDecisionNarrative(decision, { allowRemote: allowRemoteNarrative });
  }

  decision.why_moving = buildCompatibilityWhyMoving(decision, whyMoving);
  decision.strategy_signals = {
    top_setup: strategySignals.top_setup,
    setup_count: countStructuredSignals(strategySignals),
    stream_score: strategySignals.stream_score,
    stream_headline: strategySignals.stream_headline,
  };

  return decision;
}

async function buildTruthDecisionForSymbol(symbolInput, options = {}) {
  const symbol = normalizeSymbol(symbolInput);
  let payload;
  try {
    payload = await getResearchTerminalPayload(symbol);
  } catch (error) {
    if (isDecisionFallbackError(error)) {
      return buildFallbackDecision(symbol, error);
    }
    throw error;
  }

  return buildTruthDecisionFromPayload({
    symbol,
    payload,
    includeNarrative: options.includeNarrative !== false,
    allowRemoteNarrative: options.allowRemoteNarrative !== false,
  });
}

module.exports = {
  evaluateTradeTruth,
  calculateTradeQualityScore,
  loadStrategySignals,
  buildCompatibilityWhyMoving,
  buildTruthDecisionFromPayload,
  buildTruthDecisionForSymbol,
};
