const { queryWithTimeout } = require('../db/pg');
const logger = require('../logger');
const { evaluateTradeTruth, calculateTradeQualityScore } = require('../services/truthEngine');

const TABLES = [
  'news_articles',
  'trade_catalysts',
  'market_metrics',
  'trade_setups',
  'signal_outcomes',
  'trade_outcomes',
  'opportunity_stream',
];

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function normalizeSentiment(value) {
  const sentiment = asNumber(value);
  if (sentiment == null) return null;
  if (sentiment >= 0 && sentiment <= 100) return sentiment;
  if (sentiment >= -1 && sentiment <= 1) return (sentiment + 1) * 50;
  return clamp(sentiment, 0, 100);
}

function recencyConfidence(ts) {
  if (!ts) return null;
  const publishedAt = new Date(ts);
  if (Number.isNaN(publishedAt.getTime())) return null;

  const ageMs = Date.now() - publishedAt.getTime();
  if (ageMs <= 2 * 60 * 60 * 1000) return 95;
  if (ageMs <= 6 * 60 * 60 * 1000) return 85;
  if (ageMs <= 24 * 60 * 60 * 1000) return 75;
  if (ageMs <= 72 * 60 * 60 * 1000) return 60;
  return 40;
}

function average(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function logDataGap(symbol, stage, fields) {
  logger.warn('[INTELLIGENCE_DECISION] missing data gaps', {
    symbol,
    stage,
    missing_fields: fields,
  });
}

async function getTableColumns(tableName) {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1`,
      [tableName],
      { timeoutMs: 6000, label: `decision.columns.${tableName}`, maxRetries: 0 }
    );

    return new Set((rows || []).map((row) => row.column_name));
  } catch (error) {
    logger.warn('[INTELLIGENCE_DECISION] schema probe timeout', {
      table: tableName,
      error: error.message,
    });
    return new Set();
  }
}

async function getColumnMap() {
  const entries = await Promise.all(TABLES.map(async (table) => [table, await getTableColumns(table)]));
  return Object.fromEntries(entries);
}

function bestSetupStrategy(setups) {
  const top = setups?.[0] || null;
  if (!top) return null;
  return top.setup_type || top.setup || null;
}

function inferEntryType(strategy) {
  const value = String(strategy || '').toLowerCase();
  if (!value) return null;
  if (value.includes('orb')) return 'Opening range breakout';
  if (value.includes('vwap')) return 'VWAP reclaim';
  if (value.includes('momentum')) return 'Momentum continuation';
  if (value.includes('pullback')) return 'Pullback entry';
  return 'Discretionary setup trigger';
}

function inferRiskLevel(winProbability, tradeabilityScore) {
  if (!Number.isFinite(winProbability) || !Number.isFinite(tradeabilityScore)) return null;
  const edge = (winProbability * 0.6) + (tradeabilityScore * 0.4);
  if (edge >= 75) return 'LOW';
  if (edge >= 55) return 'MED';
  return 'HIGH';
}

async function buildWhyMoving(symbol) {
  const [newsResult, catalystResult, outcomeResult] = await Promise.all([
    queryWithTimeout(
      `SELECT
         headline,
         catalyst_type,
         sentiment,
         COALESCE(published_at, created_at) AS published_at
       FROM news_articles
       WHERE UPPER(COALESCE(symbol, '')) = $1
         OR EXISTS (
           SELECT 1
           FROM unnest(COALESCE(symbols, ARRAY[]::text[])) AS s(sym)
           WHERE UPPER(sym) = $1
         )
       ORDER BY COALESCE(published_at, created_at) DESC NULLS LAST
       LIMIT 1`,
      [symbol],
      { timeoutMs: 3000, label: 'decision.why_moving.news', maxRetries: 0 }
    ),
    queryWithTimeout(
      `SELECT
         headline,
         catalyst_type,
         sentiment,
         published_at,
         score
       FROM trade_catalysts
       WHERE UPPER(symbol) = $1
       ORDER BY published_at DESC NULLS LAST
       LIMIT 1`,
      [symbol],
      { timeoutMs: 3000, label: 'decision.why_moving.catalyst', maxRetries: 0 }
    ),
    queryWithTimeout(
      `SELECT expected_move_percent
       FROM trade_outcomes
       WHERE UPPER(symbol) = $1
         AND expected_move_percent IS NOT NULL
       ORDER BY COALESCE(evaluated_at, created_at, entry_time) DESC NULLS LAST
       LIMIT 1`,
      [symbol],
      { timeoutMs: 3000, label: 'decision.why_moving.expected_move', maxRetries: 0 }
    ),
  ]);

  const news = newsResult.rows?.[0] || null;
  const catalyst = catalystResult.rows?.[0] || null;
  const expectedMove = asNumber(outcomeResult.rows?.[0]?.expected_move_percent);

  let catalystHeadline = catalyst?.headline || news?.headline || null;
  let catalystType = catalyst?.catalyst_type || news?.catalyst_type || null;
  const sentimentScore = normalizeSentiment(catalyst?.sentiment ?? news?.sentiment);
  const recencyScore = recencyConfidence(catalyst?.published_at || news?.published_at);
  const expectedMoveScore = expectedMove == null ? null : clamp(Math.abs(expectedMove) * 8, 0, 100);
  let confidence = average([sentimentScore, recencyScore, expectedMoveScore]);

  // Technical fallback: if no catalyst found, derive from market_quotes
  if (!catalystHeadline) {
    try {
      const techResult = await queryWithTimeout(
        `SELECT change_percent, relative_volume, price
         FROM market_quotes
         WHERE UPPER(symbol) = $1
         LIMIT 1`,
        [symbol],
        { timeoutMs: 2000, label: 'decision.why_moving.technical_fallback', maxRetries: 0 }
      );
      const tech = techResult.rows?.[0];
      if (tech) {
        const chg = asNumber(tech.change_percent);
        const rvol = asNumber(tech.relative_volume);
        const direction = chg != null && chg >= 0 ? 'up' : 'down';
        const chgStr = chg != null ? `${Math.abs(chg).toFixed(1)}%` : 'moving';
        const rvolStr = rvol != null && rvol > 1.5 ? ` on ${rvol.toFixed(1)}x relative volume` : '';
        catalystHeadline = `${symbol} ${direction} ${chgStr}${rvolStr}`;
        catalystType = 'technical';
        confidence = confidence ?? (rvol != null && rvol > 1.5 ? 40 : 25);
      }
    } catch (_e) {
      // ignore technical fallback errors
    }
  }

  // Last resort: generic narrative
  if (!catalystHeadline) {
    catalystHeadline = `${symbol} showing price action`;
    catalystType = catalystType || 'technical';
    confidence = confidence ?? 20;
  }

  const missing = [];
  if (!catalystType) missing.push('catalyst_type');
  if (missing.length) logDataGap(symbol, 'why_moving', missing);

  return {
    value: {
      catalyst: catalystHeadline,
      catalyst_type: catalystType,
      narrative: `${symbol} is moving on ${catalystType}: ${catalystHeadline}`,
      confidence: confidence == null ? null : Math.round(confidence),
    },
    expectedMove,
    catalystConfidence: confidence == null ? null : Math.round(confidence),
  };
}

async function buildTradeability(symbol) {
  const [metricsResult, streamResult] = await Promise.all([
    queryWithTimeout(
      `SELECT
         relative_volume,
         price,
         atr,
         vwap,
         atr_percent,
         volume,
         avg_volume_30d,
         liquidity_surge,
         float_shares
       FROM market_metrics
       WHERE UPPER(symbol) = $1
       ORDER BY COALESCE(updated_at, last_updated) DESC NULLS LAST
       LIMIT 1`,
      [symbol],
      { timeoutMs: 3000, label: 'decision.tradeability.metrics', maxRetries: 0 }
    ),
    queryWithTimeout(
      `-- Direct symbol equality uses idx_opportunity_stream_symbol_updated
       -- Previously used UPPER(symbol) which forced Parallel Seq Scan
       -- Fixed Phase 33b 2026-04-24 - symbols are already normalized uppercase
       SELECT score, event_type, headline
       FROM opportunity_stream
       WHERE symbol = $1
       ORDER BY created_at DESC NULLS LAST
       LIMIT 1`,
      [symbol],
      { timeoutMs: 3000, label: 'decision.tradeability.stream', maxRetries: 0 }
    ),
  ]);

  const metrics = metricsResult.rows?.[0] || null;
  const stream = streamResult.rows?.[0] || null;

  const rvol = asNumber(metrics?.relative_volume);
  const price = asNumber(metrics?.price);
  const atr = asNumber(metrics?.atr);
  const vwap = asNumber(metrics?.vwap);
  const rangePct = asNumber(metrics?.atr_percent);
  const volume = asNumber(metrics?.volume);
  const avgVolume = asNumber(metrics?.avg_volume_30d);
  const streamScore = asNumber(stream?.score);
  const vwapPosition = Number.isFinite(price) && Number.isFinite(vwap)
    ? (price >= vwap ? 'reclaim' : 'below')
    : null;

  const volumeStrength = (volume != null && avgVolume != null && avgVolume > 0)
    ? volume / avgVolume
    : null;

  let liquidityScore = asNumber(metrics?.liquidity_surge);
  if (liquidityScore == null && volumeStrength != null) {
    liquidityScore = clamp(volumeStrength * 45, 0, 100);
  }
  if (liquidityScore != null && streamScore != null) {
    liquidityScore = average([liquidityScore, streamScore]);
  }

  const volumeStrong = volumeStrength != null ? volumeStrength >= 1.5 : null;
  const isHigh = rvol != null && rangePct != null && volumeStrong != null
    ? (rvol > 2 && rangePct > 3 && volumeStrong)
    : null;

  const scoreCandidates = [
    rvol == null ? null : clamp((rvol / 3) * 100, 0, 100),
    rangePct == null ? null : clamp((rangePct / 6) * 100, 0, 100),
    liquidityScore,
    isHigh == null ? null : (isHigh ? 90 : 45),
  ];
  const tradeabilityScore = average(scoreCandidates);

  const missing = [];
  if (rvol == null) missing.push('rvol');
  if (rangePct == null) missing.push('range_pct');
  if (liquidityScore == null) missing.push('liquidity_score');
  if (tradeabilityScore == null) missing.push('tradeability_score');
  if (missing.length) logDataGap(symbol, 'tradeability', missing);

  return {
    rvol,
    price,
    atr,
    vwap,
    vwap_position: vwapPosition,
    range_pct: rangePct,
    liquidity_score: liquidityScore == null ? null : Math.round(liquidityScore),
    tradeability_score: tradeabilityScore == null ? null : Math.round(tradeabilityScore),
    float: asNumber(metrics?.float_shares),
  };
}

async function buildExecutionPlan(symbol, tradeabilityScore, expectedMove) {
  const setupsResult = await queryWithTimeout(
    `SELECT
       setup,
       setup_type,
       score,
       atr,
       relative_volume,
       gap_percent,
       updated_at
     FROM trade_setups
     WHERE UPPER(symbol) = $1
     ORDER BY score DESC NULLS LAST, updated_at DESC NULLS LAST
     LIMIT 3`,
    [symbol],
    { timeoutMs: 3500, label: 'decision.execution.setups', maxRetries: 0 }
  );

  const setups = setupsResult.rows || [];
  const strategy = bestSetupStrategy(setups);

  const probabilityResult = await queryWithTimeout(
    `SELECT
       COUNT(*)::int AS samples,
       ROUND(
         AVG(
           CASE
             WHEN COALESCE(pnl_pct, return_percent, 0) > 0 OR outcome = 'win' THEN 1
             ELSE 0
           END
         ) * 100,
         2
       ) AS win_probability
     FROM signal_outcomes
     WHERE UPPER(symbol) = $1
       AND ($2::text IS NULL OR strategy = $2)`,
    [symbol, strategy],
    { timeoutMs: 3500, label: 'decision.execution.signal_outcomes', maxRetries: 0 }
  );

  const performanceResult = await queryWithTimeout(
    `SELECT
       COUNT(*)::int AS samples,
       ROUND(
         AVG(
           CASE
             WHEN COALESCE(pnl_pct, result_pct, 0) > 0 OR outcome = 'win' THEN 1
             ELSE 0
           END
         ) * 100,
         2
       ) AS win_rate,
       ROUND(AVG(COALESCE(pnl_pct, result_pct, 0))::numeric, 4) AS avg_pnl_pct,
       ROUND(AVG(COALESCE(max_drawdown_pct, max_drawdown, 0))::numeric, 4) AS avg_drawdown_pct
     FROM trade_outcomes
     WHERE UPPER(symbol) = $1
       AND ($2::text IS NULL OR strategy = $2)`,
    [symbol, strategy],
    { timeoutMs: 3500, label: 'decision.execution.trade_outcomes', maxRetries: 0 }
  );

  const signalWinProbability = asNumber(probabilityResult.rows?.[0]?.win_probability);
  const sampleCount = Number(probabilityResult.rows?.[0]?.samples || 0);
  const historicalWinRate = asNumber(performanceResult.rows?.[0]?.win_rate);
  const historicalSampleCount = Number(performanceResult.rows?.[0]?.samples || 0);
  const averagePnlPct = asNumber(performanceResult.rows?.[0]?.avg_pnl_pct);
  const averageDrawdownPct = asNumber(performanceResult.rows?.[0]?.avg_drawdown_pct);
  const winProbability = average([signalWinProbability, historicalWinRate]);
  const topSetup = setups[0] || null;

  const missing = [];
  if (!strategy) missing.push('strategy');
  if (winProbability == null) missing.push('win_probability');
  if (expectedMove == null) missing.push('expected_move');
  if (missing.length) logDataGap(symbol, 'execution_plan', missing);

  let recentEarningsSignal = null;
  try {
    const earningsSignalResult = await queryWithTimeout(
      `SELECT id, score, confidence, created_at
       FROM signals
       WHERE UPPER(symbol) = $1
         AND signal_type = 'earnings'
         AND created_at >= NOW() - INTERVAL '48 hours'
       ORDER BY created_at DESC
       LIMIT 1`,
      [symbol],
      { timeoutMs: 2500, label: 'decision.execution.earnings_signal', maxRetries: 0 }
    );
    recentEarningsSignal = earningsSignalResult.rows?.[0] || null;
  } catch (error) {
    logger.warn('[INTELLIGENCE_DECISION] earnings signal lookup failed', {
      symbol,
      error: error.message,
    });
  }

  if (setups.length === 0 || (sampleCount === 0 && historicalSampleCount === 0)) {
    if (recentEarningsSignal) {
      return {
        value: {
          strategy: 'POST_EARNINGS_MOMENTUM',
          entry_type: 'breakout_or_pullback',
          risk_level: 'medium',
          expected_move: expectedMove,
          win_probability: winProbability,
          historical_win_rate: historicalWinRate,
          avg_pnl_pct: averagePnlPct,
          avg_drawdown_pct: averageDrawdownPct,
          setup_candidates: setups,
          expected_move_alignment: null,
          source_signal_id: recentEarningsSignal.id,
        },
        win_probability: winProbability,
        historical_win_rate: historicalWinRate,
        avg_pnl_pct: averagePnlPct,
        avg_drawdown_pct: averageDrawdownPct,
        data_quality: 'derived',
      };
    }

    return {
      value: null,
      win_probability: null,
      historical_win_rate: null,
      avg_pnl_pct: null,
      avg_drawdown_pct: null,
      data_quality: 'insufficient',
    };
  }

  return {
    value: {
      strategy,
      entry_type: inferEntryType(strategy),
      risk_level: inferRiskLevel(winProbability, tradeabilityScore),
      expected_move: expectedMove,
      win_probability: winProbability,
      historical_win_rate: historicalWinRate,
      avg_pnl_pct: averagePnlPct,
      avg_drawdown_pct: averageDrawdownPct,
      setup_candidates: setups,
      expected_move_alignment: (expectedMove != null && topSetup?.atr != null)
        ? Math.round(clamp((expectedMove / topSetup.atr) * 100, 0, 100))
        : null,
    },
    win_probability: winProbability,
    historical_win_rate: historicalWinRate,
    avg_pnl_pct: averagePnlPct,
    avg_drawdown_pct: averageDrawdownPct,
    data_quality: 'sufficient',
  };
}

async function buildDecision(symbolInput) {
  const symbol = normalizeSymbol(symbolInput);
  if (!symbol) {
    throw new Error('Symbol is required');
  }

  const columnMap = await getColumnMap();
  const emptyTables = Object.entries(columnMap)
    .filter(([, cols]) => !cols || cols.size === 0)
    .map(([table]) => table);
  if (emptyTables.length) {
    logDataGap(symbol, 'schema', emptyTables.map((table) => `${table}.*`));
  }

  let why = { value: { catalyst: null, catalyst_type: null, narrative: null, confidence: null }, expectedMove: null, catalystConfidence: null };
  let tradeability = { rvol: null, range_pct: null, liquidity_score: null, tradeability_score: null, float: null };
  let executionPlan = {
    value: null,
    win_probability: null,
    historical_win_rate: null,
    avg_pnl_pct: null,
    avg_drawdown_pct: null,
    data_quality: 'insufficient',
  };

  try {
    why = await buildWhyMoving(symbol);
  } catch (error) {
    logger.error('[INTELLIGENCE_DECISION] why_moving failure', { symbol, error: error.message });
  }

  try {
    tradeability = await buildTradeability(symbol);
  } catch (error) {
    logger.error('[INTELLIGENCE_DECISION] tradeability failure', { symbol, error: error.message });
  }

  try {
    executionPlan = await buildExecutionPlan(symbol, tradeability.tradeability_score, why.expectedMove);
  } catch (error) {
    logger.error('[INTELLIGENCE_DECISION] execution_plan failure', { symbol, error: error.message });
  }

  const pnlScore = executionPlan.avg_pnl_pct == null
    ? null
    : clamp((executionPlan.avg_pnl_pct + 5) * 10, 0, 100);
  const drawdownScore = executionPlan.avg_drawdown_pct == null
    ? null
    : clamp(100 - Math.abs(executionPlan.avg_drawdown_pct * 8), 0, 100);

  const tradeabilityComponent = Number.isFinite(tradeability.tradeability_score)
    ? tradeability.tradeability_score
    : (Number.isFinite(tradeability.rvol) ? clamp(tradeability.rvol * 25, 20, 70) : 45);
  const winProbabilityComponent = Number.isFinite(executionPlan.win_probability)
    ? executionPlan.win_probability
    : 50;
  const catalystComponent = Number.isFinite(why.catalystConfidence)
    ? why.catalystConfidence
    : 40;
  const pnlComponent = Number.isFinite(pnlScore) ? pnlScore : 50;
  const drawdownComponent = Number.isFinite(drawdownScore) ? drawdownScore : 50;

  const decisionScore = Number((tradeabilityComponent * 0.3
    + winProbabilityComponent * 0.3
    + catalystComponent * 0.15
    + pnlComponent * 0.15
    + drawdownComponent * 0.1).toFixed(2));

  const expectedMovePercent = Number.isFinite(Number(executionPlan.value?.expected_move))
    ? Number(executionPlan.value.expected_move)
    : (Number.isFinite(Number(why.expectedMove)) ? Number(why.expectedMove) : null);
  const expectedMoveLabel = expectedMovePercent == null
    ? null
    : `+/- ${Math.abs(expectedMovePercent).toFixed(2)}%`;
  const bias = Number.isFinite(Number(executionPlan.win_probability))
    ? (Number(executionPlan.win_probability) >= 55 ? 'Bullish' : (Number(executionPlan.win_probability) <= 45 ? 'Bearish' : 'Neutral'))
    : null;
  const catalystType = why.value?.catalyst_type
    ? String(why.value.catalyst_type)
    : null;

  const rvol = Number.isFinite(Number(tradeability.rvol)) ? Number(tradeability.rvol) : 0;
  const structureScore = Array.isArray(executionPlan.value?.setup_candidates)
    ? executionPlan.value.setup_candidates.length
    : 0;
  const catalystStrength = Number.isFinite(Number(why.catalystConfidence))
    ? Number(why.catalystConfidence)
    : 0;
  const winRate = Number.isFinite(Number(executionPlan.historical_win_rate))
    ? Number(executionPlan.historical_win_rate)
    : 0;

  const truth = evaluateTradeTruth({
    catalystType,
    rvol,
    structureScore,
  });

  const tradeQualityScore = calculateTradeQualityScore({
    catalystStrength,
    rvol,
    structureScore,
    winRate,
  });

  if (truth.valid === false) {
    console.warn('TRUTH FILTER REJECTED', {
      symbol,
      reason: truth.reason,
    });
  }

  return {
    symbol,
    why_moving: why.value,
    tradeability,
    execution_plan: executionPlan.value,
    data_quality: executionPlan.data_quality,
    decision_score: decisionScore,
    price: Number.isFinite(Number(tradeability.price)) ? Number(tradeability.price) : null,
    atr: Number.isFinite(Number(tradeability.atr)) ? Number(tradeability.atr) : null,
    vwap_position: tradeability.vwap_position || null,
    bias,
    expectedMoveLabel,
    catalystType,
    rvol,
    structureScore,
    catalyst_strength: catalystStrength,
    win_rate: winRate,
    truth_valid: truth.valid,
    truth_reason: truth.reason || null,
    trade_quality_score: tradeQualityScore,
    tradeable: truth.valid !== false,
  };
}

module.exports = {
  buildDecision,
};