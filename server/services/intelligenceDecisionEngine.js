const { buildDecision: buildCoreDecision } = require('../engines/intelligenceDecisionEngine');
const { queryWithTimeout } = require('../db/pg');
const { deriveSetup, buildExecutionPlan } = require('./executionEngine');
const { calculateExpectedMove } = require('./marketMetrics');
const { classifyTrade, calculatePositionSize } = require('./playbookEngine');
const { detectCatalyst } = require('./catalystEngine');
const { evaluateTradeTruth } = require('./truthEngine');
const { evaluateWatchlistCandidate } = require('./prepEngine');
const { getSessionContext, applySessionGating, applySessionWeighting } = require('../utils/sessionEngine');

async function fetchPrepInputs(symbol) {
  const settled = await Promise.allSettled([
    queryWithTimeout(
      `SELECT
         COALESCE((to_jsonb(n)->>'id'), '') AS id,
         COALESCE((to_jsonb(n)->>'headline'), (to_jsonb(n)->>'title')) AS headline,
         COALESCE((to_jsonb(n)->>'source'), (to_jsonb(n)->>'provider'), 'news') AS source,
         (to_jsonb(n)->>'provider') AS provider,
         (to_jsonb(n)->>'url') AS url,
         COALESCE(
           (to_jsonb(n)->>'published_at')::timestamptz,
           (to_jsonb(n)->>'created_at')::timestamptz
         ) AS published_at
       FROM news_articles n
       WHERE UPPER(COALESCE((to_jsonb(n)->>'symbol'), '')) = $1
         AND COALESCE(
           (to_jsonb(n)->>'published_at')::timestamptz,
           (to_jsonb(n)->>'created_at')::timestamptz
         ) >= NOW() - INTERVAL '6 hours'
       ORDER BY COALESCE(
         (to_jsonb(n)->>'published_at')::timestamptz,
         (to_jsonb(n)->>'created_at')::timestamptz
       ) DESC NULLS LAST
       LIMIT 10`,
      [symbol],
      { timeoutMs: 3000, label: 'prep_inputs.news', maxRetries: 0 }
    ),
    queryWithTimeout(
      `SELECT
         (to_jsonb(e)->>'report_date')::date AS report_date,
         (to_jsonb(e)->>'report_time') AS report_time,
         (to_jsonb(e)->>'expected_move_percent')::numeric AS expected_move_percent,
         (to_jsonb(e)->>'score')::numeric AS score
       FROM earnings_events e
       WHERE UPPER(COALESCE((to_jsonb(e)->>'symbol'), '')) = $1
         AND (to_jsonb(e)->>'report_date')::date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '3 days'
       ORDER BY (to_jsonb(e)->>'report_date')::date ASC, (to_jsonb(e)->>'updated_at')::timestamptz DESC NULLS LAST
       LIMIT 1`,
      [symbol],
      { timeoutMs: 3000, label: 'prep_inputs.earnings', maxRetries: 0 }
    ),
    queryWithTimeout(
      `SELECT
         COALESCE(
           CASE WHEN (to_jsonb(m)->>'change_percent') ~ '^-?\\d+(\\.\\d+)?$' THEN (to_jsonb(m)->>'change_percent')::numeric ELSE NULL END,
           CASE WHEN (to_jsonb(m)->>'daily_change_percent') ~ '^-?\\d+(\\.\\d+)?$' THEN (to_jsonb(m)->>'daily_change_percent')::numeric ELSE NULL END,
           CASE WHEN (to_jsonb(m)->>'price_change_percent') ~ '^-?\\d+(\\.\\d+)?$' THEN (to_jsonb(m)->>'price_change_percent')::numeric ELSE NULL END,
           CASE WHEN (to_jsonb(m)->>'percent_change') ~ '^-?\\d+(\\.\\d+)?$' THEN (to_jsonb(m)->>'percent_change')::numeric ELSE NULL END,
           CASE WHEN (to_jsonb(m)->>'changePct') ~ '^-?\\d+(\\.\\d+)?$' THEN (to_jsonb(m)->>'changePct')::numeric ELSE NULL END
         ) AS daily_change_percent
       FROM market_metrics m
       WHERE UPPER(symbol) = $1
       ORDER BY COALESCE(updated_at, last_updated, created_at) DESC NULLS LAST
       LIMIT 1`,
      [symbol],
      { timeoutMs: 3000, label: 'prep_inputs.metrics', maxRetries: 0 }
    ),
    queryWithTimeout(
      `SELECT change_percent AS daily_change_percent
       FROM market_metrics
       WHERE UPPER(symbol) = $1
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1`,
      [symbol],
      { timeoutMs: 3000, label: 'prep_inputs.metrics_direct', maxRetries: 0 }
    ),
  ]);

  const newsResult = settled[0].status === 'fulfilled' ? settled[0].value : { rows: [] };
  const earningsResult = settled[1].status === 'fulfilled' ? settled[1].value : { rows: [] };
  const metricsResult = settled[2].status === 'fulfilled' ? settled[2].value : { rows: [] };
  const metricsDirectResult = settled[3].status === 'fulfilled' ? settled[3].value : { rows: [] };

  const newsRows = Array.isArray(newsResult.rows) ? newsResult.rows : [];
  const earningsRow = earningsResult.rows?.[0] || null;
  const changeValueCandidate = Number(metricsResult.rows?.[0]?.daily_change_percent);
  const changeValueDirect = Number(metricsDirectResult.rows?.[0]?.daily_change_percent);
  const changeValue = Number.isFinite(changeValueCandidate)
    ? changeValueCandidate
    : (Number.isFinite(changeValueDirect) ? changeValueDirect : null);

  return {
    news: newsRows,
    earnings: earningsRow
      ? {
          isUpcoming: true,
          report_date: earningsRow.report_date,
          report_time: earningsRow.report_time || null,
          expected_move_percent: Number.isFinite(Number(earningsRow.expected_move_percent))
            ? Number(earningsRow.expected_move_percent)
            : null,
          score: Number.isFinite(Number(earningsRow.score)) ? Number(earningsRow.score) : null,
        }
      : null,
    daily_change_percent: Number.isFinite(changeValue) ? changeValue : null,
  };
}

function isMarketClosed() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date());

  const weekday = parts.find((p) => p.type === 'weekday')?.value || 'Sun';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  const minutes = (hour * 60) + minute;
  const open = (9 * 60) + 30;
  const close = 16 * 60;
  const weekend = weekday === 'Sat' || weekday === 'Sun';

  return weekend || minutes < open || minutes >= close;
}

function normalizeBiasForExecution(bias) {
  const value = String(bias || '').trim().toUpperCase();
  if (value === 'BULLISH') return 'LONG';
  if (value === 'LONG') return 'LONG';
  if (value === 'BREAKOUT') return 'BREAKOUT';
  return value;
}

async function buildDecision(symbolInput) {
  const decision = await buildCoreDecision(symbolInput);
  const sessionContext = getSessionContext();

  decision.session = sessionContext.session;
  decision.mode = sessionContext.mode;
  decision.reason_block = null;

  try {
    const prepInputs = await fetchPrepInputs(String(decision.symbol || symbolInput || '').trim().toUpperCase());
    decision.news = prepInputs.news;
    decision.earnings = prepInputs.earnings;

    if (prepInputs.daily_change_percent != null) {
      decision.daily_change_percent = prepInputs.daily_change_percent;
      decision.price_change_percent = prepInputs.daily_change_percent;
    }
  } catch {
    if (!Array.isArray(decision.news)) decision.news = [];
    if (decision.earnings == null) decision.earnings = null;
  }

  const catalyst = detectCatalyst({
    news: decision.news,
    earnings: decision.earnings,
    priceChangePercent: decision.price_change_percent,
    rvol: decision.rvol,
  });

  decision.catalystType = catalyst?.type || null;
  decision.catalyst_strength = catalyst?.strength || 0;

  if (catalyst) {
    console.log('CATALYST DETECTED', {
      symbol: decision.symbol,
      type: catalyst.type,
    });
  }

  const truth = evaluateTradeTruth({
    catalystType: decision.catalystType,
    rvol: decision.rvol,
    structureScore: decision.structureScore,
  });
  decision.truth_valid = truth.valid;
  decision.truth_reason = truth.reason || null;

  const expectedMove = calculateExpectedMove({
    atr: decision.atr,
    price: decision.price,
  });

  decision.expected_move = expectedMove?.value || null;
  decision.expected_move_percent = expectedMove?.percent || null;

  if (decision.expected_move == null) {
    console.warn('MISSING EXPECTED MOVE', {
      symbol: decision.symbol,
      atr: decision.atr,
      price: decision.price,
    });
  }

  const setup = deriveSetup({
    bias: normalizeBiasForExecution(decision.bias),
    structureScore: decision.structureScore,
    vwapPosition: decision.vwap_position,
    rvol: decision.rvol,
  });

  decision.setup = setup;

  if (setup === 'NO_SETUP') {
    decision.setup = 'WATCHLIST_ONLY';
    decision.setup_quality = 'LOW';
    decision.tradeable = false;
  } else {
    decision.setup_quality = 'HIGH';
  }

  if (!decision.price || !decision.atr) {
    decision.execution_plan = null;
    decision.execution_valid = false;
    decision.execution_reason = 'INSUFFICIENT_DATA';
    decision.trade_summary = 'NO VALID TRADE PLAN';
    console.warn('EXECUTION INVALID', {
      symbol: decision.symbol,
      setup: decision.setup,
      reason: decision.execution_reason,
    });
  } else {
    const executionPlan = buildExecutionPlan({
      price: decision.price,
      atr: decision.atr,
      setup: decision.setup,
    });

    decision.execution_plan = executionPlan;

    if (decision.setup === 'WATCHLIST_ONLY' || executionPlan === null) {
      decision.tradeable = false;
      decision.execution_valid = false;
      decision.execution_reason = 'NO_VALID_PLAN';
      console.warn('EXECUTION INVALID', {
        symbol: decision.symbol,
        setup: decision.setup,
        reason: decision.execution_reason,
      });
    } else {
      decision.execution_valid = true;
      decision.execution_reason = null;
    }

    decision.trade_summary = executionPlan
      ? `${decision.setup}: Entry ${executionPlan.entry}, Stop ${executionPlan.stop}, Target ${executionPlan.target}`
      : 'NO VALID TRADE PLAN';
  }

  decision.trade_class = classifyTrade({
    truth_valid: decision.truth_valid,
    execution_valid: decision.execution_valid,
    trade_quality_score: decision.trade_quality_score,
    setup_quality: decision.setup_quality,
  });

  if (decision.execution_plan) {
    const position = calculatePositionSize({
      entry: decision.execution_plan.entry,
      stop: decision.execution_plan.stop,
    });

    decision.position_size = position?.position_size || null;
    decision.risk_per_share = position?.risk_per_share || null;
    decision.max_risk = position?.max_risk || 10;
  } else {
    decision.position_size = null;
    decision.risk_per_share = null;
    decision.max_risk = 10;
  }

  if (decision.trade_class === 'A') {
    decision.action = 'TAKE';
  } else if (decision.trade_class === 'B') {
    decision.action = 'WATCH';
  } else {
    decision.action = 'AVOID';
  }

  if (isMarketClosed()) {
    decision.mode = 'PREP';

    const dailyChangePercent = Number.isFinite(Number(decision.daily_change_percent))
      ? Number(decision.daily_change_percent)
      : (Number.isFinite(Number(decision.price_change_percent)) ? Number(decision.price_change_percent) : 0);

    const watch = evaluateWatchlistCandidate({
      news: decision.news,
      earnings: decision.earnings,
      dailyChangePercent,
      atr: decision.atr,
      price: decision.price,
    });

    decision.watchlist_candidate = watch !== null;
    decision.watch_reason = watch?.watch_reason || null;
    decision.watch_priority = watch?.priority || 0;
  } else {
    decision.mode = 'LIVE';
    decision.watchlist_candidate = false;
    decision.watch_reason = null;
    decision.watch_priority = 0;
  }

  const weightedTradeQuality = applySessionWeighting(decision.trade_quality_score, sessionContext);
  if (Number.isFinite(weightedTradeQuality)) {
    decision.trade_quality_score_weighted = weightedTradeQuality;
  }

  const weightedDecisionScore = applySessionWeighting(decision.decision_score, sessionContext);
  if (Number.isFinite(weightedDecisionScore)) {
    decision.decision_score_weighted = weightedDecisionScore;
  }

  const gated = applySessionGating(decision, sessionContext);
  decision.session = gated.session;
  decision.mode = gated.mode;
  decision.tradeable = gated.tradeable;
  decision.reason_block = gated.reason_block;
  decision.session_weight = gated.session_weight;
  decision.action = gated.action;
  decision.trade_class = gated.trade_class;

  return decision;
}

module.exports = {
  buildDecision,
};
