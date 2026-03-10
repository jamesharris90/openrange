const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { scoreSignal, ensureTradeSignalsScoringColumns } = require('./signalScoringEngine');
const { routeSignalsBatch } = require('../system/signalRouter');
const { ensureOrderFlowSignalsTable } = require('./orderFlowImbalanceEngine');
const { ensureSectorMomentumTable } = require('./sectorMomentumEngine');

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function classifyStrategy(row) {
  const gapPercent = toNumber(row.gap_percent);
  const rvol = toNumber(row.relative_volume);
  const rsi = toNumber(row.rsi);

  if (gapPercent > 6) return 'Gap and Go';
  if (rvol > 4) return 'Momentum Continuation';
  if (gapPercent > 3 && rsi < 70) return 'VWAP Reclaim candidate';
  return 'Breakout Watch';
}

async function ensureTradeSignalsTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS trade_signals (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT NOT NULL UNIQUE,
      strategy TEXT NOT NULL,
      score NUMERIC NOT NULL,
      gap_percent NUMERIC,
      rvol NUMERIC,
      atr_percent NUMERIC,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'engines.stocks_in_play.ensure_table', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS signal_explanation TEXT',
    [],
    { timeoutMs: 7000, label: 'engines.stocks_in_play.ensure_signal_explanation', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS rationale TEXT',
    [],
    { timeoutMs: 7000, label: 'engines.stocks_in_play.ensure_rationale', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS catalyst_type TEXT',
    [],
    { timeoutMs: 7000, label: 'engines.stocks_in_play.ensure_catalyst_type', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS sector TEXT',
    [],
    { timeoutMs: 7000, label: 'engines.stocks_in_play.ensure_sector', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS float_rotation NUMERIC',
    [],
    { timeoutMs: 7000, label: 'engines.stocks_in_play.ensure_float_rotation', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS liquidity_surge NUMERIC',
    [],
    { timeoutMs: 7000, label: 'engines.stocks_in_play.ensure_liquidity_surge', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS catalyst_score NUMERIC',
    [],
    { timeoutMs: 7000, label: 'engines.stocks_in_play.ensure_catalyst_score', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS sector_score NUMERIC',
    [],
    { timeoutMs: 7000, label: 'engines.stocks_in_play.ensure_sector_score', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE trade_signals ADD COLUMN IF NOT EXISTS confirmation_score NUMERIC',
    [],
    { timeoutMs: 7000, label: 'engines.stocks_in_play.ensure_confirmation_score', maxRetries: 0 }
  );
}

async function selectStocksInPlayCandidates({ minRvol, minGap, minAtrPercent, label }) {
  const { rows } = await queryWithTimeout(
    `WITH catalyst_latest AS (
       SELECT DISTINCT ON (symbol)
         symbol,
         headline,
         catalyst_type
       FROM news_catalysts
       ORDER BY symbol, published_at DESC NULLS LAST
     ),
     catalyst_impact AS (
       SELECT
         symbol,
         MAX(impact_score) AS catalyst_impact_8h
       FROM news_catalysts
       WHERE published_at > NOW() - interval '8 hours'
       GROUP BY symbol
     ),
     order_flow_latest AS (
       SELECT DISTINCT ON (symbol)
         symbol,
         pressure_level,
         pressure_score
       FROM order_flow_signals
       ORDER BY symbol, detected_at DESC NULLS LAST
     ),
     ranked AS (
       SELECT
         m.symbol,
         COALESCE(m.relative_volume, 0) AS relative_volume,
         COALESCE(m.gap_percent, 0) AS gap_percent,
         COALESCE(m.atr_percent, 0) AS atr_percent,
         COALESCE(m.float_shares, 0) AS float_shares,
         COALESCE(m.volume, 0) AS volume,
         COALESCE(m.avg_volume_30d, 0) AS avg_volume_30d,
         COALESCE(m.price, 0) AS price,
         COALESCE(m.vwap, 0) AS vwap,
         COALESCE(m.rsi, 0) AS rsi,
         cl.headline AS catalyst_headline,
         cl.catalyst_type,
         COALESCE(q.sector, 'Unknown') AS sector,
         COALESCE(m.change_percent, 0) AS sector_strength,
         COALESCE(ci.catalyst_impact_8h, 0) AS catalyst_impact_8h,
         COALESCE(sm.momentum_score, 0) AS sector_momentum_score,
         ofl.pressure_level AS order_flow_level,
         COALESCE(ofl.pressure_score, 0) AS order_flow_pressure,
         ((COALESCE(m.relative_volume, 0) * 100)
           + (COALESCE(m.gap_percent, 0) * 50)
           + (COALESCE(m.atr_percent, 0) * 25)
           - (COALESCE(m.float_shares, 0) / 10000000.0)
           + (COALESCE(ci.catalyst_impact_8h, 0) * 20)) AS rank_score
       FROM market_metrics m
       LEFT JOIN market_quotes q ON q.symbol = m.symbol
       LEFT JOIN catalyst_latest cl ON cl.symbol = m.symbol
       LEFT JOIN catalyst_impact ci ON ci.symbol = m.symbol
      LEFT JOIN sector_momentum sm ON sm.sector = COALESCE(q.sector, 'Unknown')
      LEFT JOIN order_flow_latest ofl ON ofl.symbol = m.symbol
       WHERE m.symbol IS NOT NULL
         AND m.symbol <> ''
         AND COALESCE(m.relative_volume, 0) >= $1
         AND COALESCE(m.gap_percent, 0) >= $2
         AND COALESCE(m.atr_percent, 0) >= $3
       ORDER BY rank_score DESC
      LIMIT 120
     )
     SELECT *
     FROM ranked
     ORDER BY rank_score DESC
    LIMIT 20`,
    [minRvol, minGap, minAtrPercent],
    { timeoutMs: 6000, label, maxRetries: 0 }
  );

  return rows;
}

async function upsertTradeSignalsBatch(scoredRows) {
  if (!scoredRows.length) return 0;

  const symbols = [];
  const strategies = [];
  const scores = [];
  const gapPercents = [];
  const rvols = [];
  const atrPercents = [];
  const confidences = [];
  const scoreBreakdowns = [];
  const floatRotations = [];
  const liquiditySurges = [];
  const catalystScores = [];
  const sectorScores = [];
  const confirmationScores = [];
  const narratives = [];
  const catalystTypes = [];
  const sectors = [];
  const signalExplanations = [];
  const rationales = [];

  for (const row of scoredRows) {
    symbols.push(row.symbol);
    strategies.push(row.strategy);
    scores.push(row.score);
    gapPercents.push(row.gap_percent);
    rvols.push(row.rvol);
    atrPercents.push(row.atr_percent);
    confidences.push(row.confidence);
    scoreBreakdowns.push(JSON.stringify(row.score_breakdown || {}));
    floatRotations.push(row.float_rotation);
    liquiditySurges.push(row.liquidity_surge);
    catalystScores.push(row.catalyst_score);
    sectorScores.push(row.sector_score);
    confirmationScores.push(row.confirmation_score);
    narratives.push(row.narrative);
    catalystTypes.push(row.catalyst_type);
    sectors.push(row.sector);
    signalExplanations.push(row.signal_explanation);
    rationales.push(row.rationale);
  }

  const result = await queryWithTimeout(
    `INSERT INTO trade_signals (
       symbol,
       strategy,
       score,
       gap_percent,
       rvol,
       atr_percent,
       confidence,
       score_breakdown,
       float_rotation,
       liquidity_surge,
       catalyst_score,
       sector_score,
       confirmation_score,
       narrative,
       catalyst_type,
       sector,
       signal_explanation,
       rationale,
       created_at,
       updated_at
     )
     SELECT *
     FROM (
       SELECT
         unnest($1::text[]) AS symbol,
         unnest($2::text[]) AS strategy,
         unnest($3::numeric[]) AS score,
         unnest($4::numeric[]) AS gap_percent,
         unnest($5::numeric[]) AS rvol,
         unnest($6::numeric[]) AS atr_percent,
         unnest($7::text[]) AS confidence,
         unnest($8::jsonb[]) AS score_breakdown,
         unnest($9::numeric[]) AS float_rotation,
         unnest($10::numeric[]) AS liquidity_surge,
         unnest($11::numeric[]) AS catalyst_score,
         unnest($12::numeric[]) AS sector_score,
         unnest($13::numeric[]) AS confirmation_score,
         unnest($14::text[]) AS narrative,
         unnest($15::text[]) AS catalyst_type,
         unnest($16::text[]) AS sector,
         unnest($17::text[]) AS signal_explanation,
         unnest($18::text[]) AS rationale,
         NOW() AS created_at,
         NOW() AS updated_at
     ) incoming
     ON CONFLICT (symbol)
     DO UPDATE SET
       strategy = EXCLUDED.strategy,
       score = EXCLUDED.score,
       gap_percent = EXCLUDED.gap_percent,
       rvol = EXCLUDED.rvol,
       atr_percent = EXCLUDED.atr_percent,
       confidence = EXCLUDED.confidence,
       score_breakdown = EXCLUDED.score_breakdown,
       float_rotation = EXCLUDED.float_rotation,
       liquidity_surge = EXCLUDED.liquidity_surge,
       catalyst_score = EXCLUDED.catalyst_score,
       sector_score = EXCLUDED.sector_score,
       confirmation_score = EXCLUDED.confirmation_score,
       narrative = EXCLUDED.narrative,
       catalyst_type = EXCLUDED.catalyst_type,
       sector = EXCLUDED.sector,
       signal_explanation = EXCLUDED.signal_explanation,
       rationale = EXCLUDED.rationale,
       updated_at = NOW()`,
    [
      symbols,
      strategies,
      scores,
      gapPercents,
      rvols,
      atrPercents,
      confidences,
      scoreBreakdowns,
      floatRotations,
      liquiditySurges,
      catalystScores,
      sectorScores,
      confirmationScores,
      narratives,
      catalystTypes,
      sectors,
      signalExplanations,
      rationales,
    ],
    { timeoutMs: 12000, label: 'engines.stocks_in_play.upsert_trade_signal_batch', maxRetries: 0 }
  );

  return result.rowCount || 0;
}

async function runStocksInPlayEngine() {
  const startedAt = Date.now();
  try {
    await ensureTradeSignalsTable();
    await ensureTradeSignalsScoringColumns();
    await ensureOrderFlowSignalsTable();
    await ensureSectorMomentumTable();

    let rows = await selectStocksInPlayCandidates({
      minRvol: 2,
      minGap: 3,
      minAtrPercent: 1,
      label: 'engines.stocks_in_play.select_market_metrics',
    });

    if (!rows.length) {
      logger.warn('[STOCKS_IN_PLAY] strict filter returned no rows; using fallback thresholds');
      rows = await selectStocksInPlayCandidates({
        minRvol: 1,
        minGap: 1,
        minAtrPercent: 0.5,
        label: 'engines.stocks_in_play.select_market_metrics_fallback',
      });
    }

    if (!rows.length) {
      logger.warn('[STOCKS_IN_PLAY] fallback thresholds returned no rows; using broad ranking set');
      rows = await selectStocksInPlayCandidates({
        minRvol: 0,
        minGap: -100,
        minAtrPercent: 0,
        label: 'engines.stocks_in_play.select_market_metrics_broad',
      });
    }

    const scoredRowsMaybe = await Promise.all(rows.map(async (row) => {
    const strategy = classifyStrategy(row);
    const scored = await scoreSignal(row, { strategy, fastMode: true, skipEnsure: true, skipMcp: true });
    if (!scored) {
      return null;
    }
    const score = toNumber(scored.total_score);
    const symbol = String(row.symbol || '').toUpperCase();

    return {
      symbol,
      strategy,
      score,
      gap_percent: toNumber(row.gap_percent),
      rvol: toNumber(row.relative_volume),
      atr_percent: toNumber(row.atr_percent),
      confidence: scored.confidence,
      score_breakdown: scored.score_breakdown || {},
      float_rotation: toNumber(scored?.score_breakdown?.float_rotation_score),
      liquidity_surge: toNumber(scored?.score_breakdown?.liquidity_surge_score),
      catalyst_score: toNumber(scored?.score_breakdown?.catalyst_score),
      sector_score: toNumber(scored?.score_breakdown?.sector_score),
      confirmation_score: toNumber(scored?.score_breakdown?.confirmation_score),
      narrative: scored.narrative || `Score blends multi-engine confirmations for ${symbol}.`,
      catalyst_type: row.catalyst_type || null,
      sector: row.sector || null,
      signal_explanation: scored?.signal_explanation || `${symbol} ${strategy}`,
      rationale: scored?.narrative || `Score blends multi-engine confirmations for ${symbol}.`,
      catalyst_impact_8h: toNumber(row.catalyst_impact_8h),
    };
  }));

    const scoredRows = scoredRowsMaybe.filter(Boolean);

    if (!scoredRows.length) {
      logger.warn('[STOCKS_IN_PLAY] no candidates passed liquidity quality filter');
      return { selected: rows.length, upserted: 0, boosted: 0, runtimeMs: Date.now() - startedAt };
    }

    const boosted = scoredRows.filter((r) => r.catalyst_impact_8h > 0).length;
    const inserted = await upsertTradeSignalsBatch(scoredRows);

    await routeSignalsBatch(scoredRows.map((row) => ({
      symbol: row.symbol,
      strategy: row.strategy,
      score: row.score,
      confidence: row.confidence,
      score_breakdown: row.score_breakdown,
      narrative: row.narrative,
      catalyst_type: row.catalyst_type,
      sector: row.sector,
      float_rotation: row.float_rotation,
      liquidity_surge: row.liquidity_surge,
    })));

    const runtimeMs = Date.now() - startedAt;
    logger.info('[STOCKS_IN_PLAY] run complete', {
      selected: rows.length,
      upserted: inserted,
      boosted,
      runtime_ms: runtimeMs,
    });
    logger.info('[STOCKS_IN_PLAY_RUNTIME_MS]', { runtime_ms: runtimeMs });
    return { selected: rows.length, upserted: inserted, boosted, runtimeMs };
  } catch (error) {
    const runtimeMs = Date.now() - startedAt;
    logger.error('[STOCKS_IN_PLAY] run failed', { error: error.message, runtime_ms: runtimeMs });
    return { selected: 0, upserted: 0, boosted: 0, runtimeMs, error: error.message };
  }
}

module.exports = {
  runStocksInPlayEngine,
};
