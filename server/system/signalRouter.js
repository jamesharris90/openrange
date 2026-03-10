const { queryWithTimeout } = require('../db/pg');
const { computeHierarchyRank } = require('../engines/signalHierarchyEngine');
const { writeSignalOutcome } = require('../engines/signalOutcomeWriter');

let routerSchemaReady = false;

async function ensureSignalRouterTables() {
  if (routerSchemaReady) return;

  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS dynamic_watchlist (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT NOT NULL UNIQUE,
      strategy TEXT,
      score NUMERIC NOT NULL,
      confidence TEXT,
      catalyst_type TEXT,
      sector TEXT,
      float_rotation NUMERIC,
      liquidity_surge NUMERIC,
      hierarchy_rank NUMERIC,
      narrative TEXT,
      score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'signal_router.ensure_watchlist_table', maxRetries: 0 }
  );

  await queryWithTimeout("ALTER TABLE dynamic_watchlist ADD COLUMN IF NOT EXISTS strategy TEXT", [], { timeoutMs: 7000, label: 'signal_router.ensure_watchlist_strategy', maxRetries: 0 });
  await queryWithTimeout("ALTER TABLE dynamic_watchlist ADD COLUMN IF NOT EXISTS score NUMERIC NOT NULL DEFAULT 0", [], { timeoutMs: 7000, label: 'signal_router.ensure_watchlist_score', maxRetries: 0 });
  await queryWithTimeout("ALTER TABLE dynamic_watchlist ADD COLUMN IF NOT EXISTS confidence TEXT", [], { timeoutMs: 7000, label: 'signal_router.ensure_watchlist_confidence', maxRetries: 0 });
  await queryWithTimeout("ALTER TABLE dynamic_watchlist ADD COLUMN IF NOT EXISTS catalyst_type TEXT", [], { timeoutMs: 7000, label: 'signal_router.ensure_watchlist_catalyst_type', maxRetries: 0 });
  await queryWithTimeout("ALTER TABLE dynamic_watchlist ADD COLUMN IF NOT EXISTS sector TEXT", [], { timeoutMs: 7000, label: 'signal_router.ensure_watchlist_sector', maxRetries: 0 });
  await queryWithTimeout("ALTER TABLE dynamic_watchlist ADD COLUMN IF NOT EXISTS float_rotation NUMERIC", [], { timeoutMs: 7000, label: 'signal_router.ensure_watchlist_float_rotation', maxRetries: 0 });
  await queryWithTimeout("ALTER TABLE dynamic_watchlist ADD COLUMN IF NOT EXISTS liquidity_surge NUMERIC", [], { timeoutMs: 7000, label: 'signal_router.ensure_watchlist_liquidity_surge', maxRetries: 0 });
  await queryWithTimeout("ALTER TABLE dynamic_watchlist ADD COLUMN IF NOT EXISTS hierarchy_rank NUMERIC", [], { timeoutMs: 7000, label: 'signal_router.ensure_watchlist_hierarchy_rank', maxRetries: 0 });
  await queryWithTimeout("ALTER TABLE dynamic_watchlist ADD COLUMN IF NOT EXISTS narrative TEXT", [], { timeoutMs: 7000, label: 'signal_router.ensure_watchlist_narrative', maxRetries: 0 });
  await queryWithTimeout("ALTER TABLE dynamic_watchlist ADD COLUMN IF NOT EXISTS score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb", [], { timeoutMs: 7000, label: 'signal_router.ensure_watchlist_breakdown', maxRetries: 0 });
  await queryWithTimeout("ALTER TABLE dynamic_watchlist ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()", [], { timeoutMs: 7000, label: 'signal_router.ensure_watchlist_updated_at', maxRetries: 0 });
  await queryWithTimeout(`CREATE UNIQUE INDEX IF NOT EXISTS dynamic_watchlist_symbol_idx ON dynamic_watchlist (symbol)`, [], { timeoutMs: 7000, label: 'signal_router.ensure_watchlist_symbol_idx', maxRetries: 0 });

  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS signal_alerts (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      strategy TEXT,
      score NUMERIC NOT NULL,
      confidence TEXT,
      alert_type TEXT,
      message TEXT,
      acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'signal_router.ensure_alerts_table', maxRetries: 0 }
  );

  await queryWithTimeout("ALTER TABLE signal_alerts ADD COLUMN IF NOT EXISTS strategy TEXT", [], { timeoutMs: 7000, label: 'signal_router.ensure_alerts_strategy', maxRetries: 0 });
  await queryWithTimeout("ALTER TABLE signal_alerts ADD COLUMN IF NOT EXISTS score NUMERIC NOT NULL DEFAULT 0", [], { timeoutMs: 7000, label: 'signal_router.ensure_alerts_score', maxRetries: 0 });
  await queryWithTimeout("ALTER TABLE signal_alerts ADD COLUMN IF NOT EXISTS confidence TEXT", [], { timeoutMs: 7000, label: 'signal_router.ensure_alerts_confidence', maxRetries: 0 });
  await queryWithTimeout("ALTER TABLE signal_alerts ADD COLUMN IF NOT EXISTS alert_type TEXT", [], { timeoutMs: 7000, label: 'signal_router.ensure_alerts_alert_type', maxRetries: 0 });
  await queryWithTimeout("ALTER TABLE signal_alerts ADD COLUMN IF NOT EXISTS acknowledged BOOLEAN NOT NULL DEFAULT FALSE", [], { timeoutMs: 7000, label: 'signal_router.ensure_alerts_acknowledged', maxRetries: 0 });
  await queryWithTimeout("ALTER TABLE signal_alerts ADD COLUMN IF NOT EXISTS message TEXT", [], { timeoutMs: 7000, label: 'signal_router.ensure_alerts_message', maxRetries: 0 });

  await queryWithTimeout(
    `ALTER TABLE trade_signals
     ADD COLUMN IF NOT EXISTS include_in_briefing BOOLEAN NOT NULL DEFAULT FALSE`,
    [],
    { timeoutMs: 7000, label: 'signal_router.ensure_briefing_flag', maxRetries: 0 }
  );

  routerSchemaReady = true;
}

async function insertWatchlistSignal(signal) {
  await queryWithTimeout(
    `INSERT INTO dynamic_watchlist (
       symbol,
       strategy,
       score,
       confidence,
       catalyst_type,
       sector,
       float_rotation,
       liquidity_surge,
       hierarchy_rank,
       narrative,
       score_breakdown,
       updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NOW())
     ON CONFLICT (symbol)
     DO UPDATE SET
       strategy = EXCLUDED.strategy,
       score = EXCLUDED.score,
       confidence = EXCLUDED.confidence,
       catalyst_type = EXCLUDED.catalyst_type,
       sector = EXCLUDED.sector,
       float_rotation = EXCLUDED.float_rotation,
       liquidity_surge = EXCLUDED.liquidity_surge,
      hierarchy_rank = EXCLUDED.hierarchy_rank,
       narrative = EXCLUDED.narrative,
       score_breakdown = EXCLUDED.score_breakdown,
       updated_at = NOW()`,
    [
      signal.symbol,
      signal.strategy,
      signal.score,
      signal.confidence || null,
      signal.catalyst_type || null,
      signal.sector || null,
      Number(signal.float_rotation || 0) || null,
      Number(signal.liquidity_surge || 0) || null,
      Number(signal.hierarchy_rank || 0) || null,
      signal.narrative || null,
      JSON.stringify(signal.score_breakdown || {}),
    ],
    { timeoutMs: 7000, label: 'signal_router.upsert_watchlist', maxRetries: 0 }
  );
}

async function hasBriefingGeneratedToday() {
  const { rows } = await queryWithTimeout(
    `SELECT created_at
     FROM morning_briefings
     WHERE created_at::date = CURRENT_DATE
     ORDER BY created_at DESC
     LIMIT 1`,
    [],
    { timeoutMs: 7000, label: 'signal_router.latest_briefing_today', maxRetries: 0 }
  );
  return Boolean(rows[0]);
}

async function createSignalAlert(signal) {
  await queryWithTimeout(
    `INSERT INTO signal_alerts (
       symbol,
       strategy,
       score,
       confidence,
       alert_type,
       message,
       acknowledged,
       created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, FALSE, NOW())`,
    [
      signal.symbol,
      signal.strategy,
      signal.score,
      signal.confidence || null,
      signal.score >= 90 ? 'high_priority' : 'standard',
      `${signal.symbol} scored ${Number(signal.score).toFixed(1)} (${signal.confidence || 'N/A'})`,
    ],
    { timeoutMs: 7000, label: 'signal_router.insert_alert', maxRetries: 0 }
  );
}

async function recordStrategyTrade(signal) {
  const { rows } = await queryWithTimeout(
    `SELECT price FROM market_quotes WHERE symbol = $1 LIMIT 1`,
    [signal.symbol],
    { timeoutMs: 7000, label: 'signal_router.entry_price', maxRetries: 0 }
  );
  const entryPrice = Number(rows[0]?.price || 0) || null;

  await queryWithTimeout(
    `INSERT INTO strategy_trades (
       symbol,
       strategy,
       entry_price,
       entry_time,
       created_at
     )
     SELECT $1, $2, $3, NOW(), NOW()
     WHERE NOT EXISTS (
       SELECT 1
       FROM strategy_trades
       WHERE symbol = $1
         AND strategy = $2
         AND entry_time > NOW() - interval '4 hours'
     )`,
    [signal.symbol, signal.strategy, entryPrice],
    { timeoutMs: 7000, label: 'signal_router.record_strategy_trade', maxRetries: 0 }
  );
}

async function upsertWatchlistBatch(signals) {
  if (!signals.length) return;

  const symbols = [];
  const strategies = [];
  const scores = [];
  const confidences = [];
  const catalystTypes = [];
  const sectors = [];
  const floatRotations = [];
  const liquiditySurges = [];
  const hierarchyRanks = [];
  const narratives = [];
  const scoreBreakdowns = [];

  for (const signal of signals) {
    symbols.push(signal.symbol);
    strategies.push(signal.strategy || null);
    scores.push(Number(signal.score || 0));
    confidences.push(signal.confidence || null);
    catalystTypes.push(signal.catalyst_type || null);
    sectors.push(signal.sector || null);
    floatRotations.push(Number(signal.float_rotation || 0) || null);
    liquiditySurges.push(Number(signal.liquidity_surge || 0) || null);
    hierarchyRanks.push(Number(signal.hierarchy_rank || 0) || null);
    narratives.push(signal.narrative || null);
    scoreBreakdowns.push(JSON.stringify(signal.score_breakdown || {}));
  }

  await queryWithTimeout(
    `INSERT INTO dynamic_watchlist (
       symbol,
       strategy,
       score,
       confidence,
       catalyst_type,
       sector,
       float_rotation,
       liquidity_surge,
       hierarchy_rank,
       narrative,
       score_breakdown,
       updated_at
     )
     SELECT *
     FROM (
       SELECT
         unnest($1::text[]) AS symbol,
         unnest($2::text[]) AS strategy,
         unnest($3::numeric[]) AS score,
         unnest($4::text[]) AS confidence,
         unnest($5::text[]) AS catalyst_type,
         unnest($6::text[]) AS sector,
         unnest($7::numeric[]) AS float_rotation,
         unnest($8::numeric[]) AS liquidity_surge,
         unnest($9::numeric[]) AS hierarchy_rank,
         unnest($10::text[]) AS narrative,
         unnest($11::jsonb[]) AS score_breakdown,
         NOW() AS updated_at
     ) incoming
     ON CONFLICT (symbol)
     DO UPDATE SET
       strategy = EXCLUDED.strategy,
       score = EXCLUDED.score,
       confidence = EXCLUDED.confidence,
       catalyst_type = EXCLUDED.catalyst_type,
       sector = EXCLUDED.sector,
       float_rotation = EXCLUDED.float_rotation,
       liquidity_surge = EXCLUDED.liquidity_surge,
       hierarchy_rank = EXCLUDED.hierarchy_rank,
       narrative = EXCLUDED.narrative,
       score_breakdown = EXCLUDED.score_breakdown,
       updated_at = NOW()`,
    [
      symbols,
      strategies,
      scores,
      confidences,
      catalystTypes,
      sectors,
      floatRotations,
      liquiditySurges,
      hierarchyRanks,
      narratives,
      scoreBreakdowns,
    ],
    { timeoutMs: 10000, label: 'signal_router.upsert_watchlist_batch', maxRetries: 0 }
  );
}

async function insertAlertsBatch(signals) {
  if (!signals.length) return;

  const symbols = [];
  const strategies = [];
  const scores = [];
  const confidences = [];
  const alertTypes = [];
  const messages = [];

  for (const signal of signals) {
    symbols.push(signal.symbol);
    strategies.push(signal.strategy || null);
    scores.push(Number(signal.score || 0));
    confidences.push(signal.confidence || null);
    alertTypes.push(Number(signal.score || 0) >= 90 ? 'high_priority' : 'standard');
    messages.push(`${signal.symbol} scored ${Number(signal.score || 0).toFixed(1)} (${signal.confidence || 'N/A'})`);
  }

  await queryWithTimeout(
    `INSERT INTO signal_alerts (
       symbol,
       strategy,
       score,
       confidence,
       alert_type,
       message,
       acknowledged,
       created_at
     )
     SELECT
       unnest($1::text[]) AS symbol,
       unnest($2::text[]) AS strategy,
       unnest($3::numeric[]) AS score,
       unnest($4::text[]) AS confidence,
       unnest($5::text[]) AS alert_type,
       unnest($6::text[]) AS message,
       FALSE AS acknowledged,
       NOW() AS created_at`,
    [symbols, strategies, scores, confidences, alertTypes, messages],
    { timeoutMs: 9000, label: 'signal_router.insert_alerts_batch', maxRetries: 0 }
  );
}

async function recordStrategyTradesBatch(signals) {
  if (!signals.length) return;

  const symbols = [];
  const strategies = [];

  for (const signal of signals) {
    symbols.push(signal.symbol);
    strategies.push(signal.strategy || null);
  }

  await queryWithTimeout(
    `INSERT INTO strategy_trades (
       symbol,
       strategy,
       entry_price,
       entry_time,
       created_at
     )
     SELECT
       candidate.symbol,
       candidate.strategy,
       q.price AS entry_price,
       NOW() AS entry_time,
       NOW() AS created_at
     FROM (
       SELECT
         unnest($1::text[]) AS symbol,
         unnest($2::text[]) AS strategy
     ) candidate
     LEFT JOIN market_quotes q ON q.symbol = candidate.symbol
     WHERE NOT EXISTS (
       SELECT 1
       FROM strategy_trades st
       WHERE st.symbol = candidate.symbol
         AND st.strategy = candidate.strategy
         AND st.entry_time > NOW() - interval '4 hours'
     )`,
    [symbols, strategies],
    { timeoutMs: 10000, label: 'signal_router.record_strategy_trades_batch', maxRetries: 0 }
  );
}

async function routeSignalsBatch(signals = []) {
  try {
    await ensureSignalRouterTables();

    const normalized = signals
      .map((signal) => {
        const score = Number(signal?.score || 0);
        if (!signal?.symbol || !Number.isFinite(score)) return null;

        const hierarchyRank = Number(signal?.hierarchy_rank || computeHierarchyRank({
          score,
          float_rotation: signal?.float_rotation,
          liquidity_surge: signal?.liquidity_surge,
          catalyst_score: signal?.score_breakdown?.catalyst_score,
        }) || 0);

        return {
          ...signal,
          score,
          symbol: String(signal.symbol).toUpperCase(),
          hierarchy_rank: hierarchyRank,
        };
      })
      .filter(Boolean);

    if (!normalized.length) return;

    const briefingSymbols = normalized.filter((s) => s.score >= 90).map((s) => s.symbol);
    if (briefingSymbols.length) {
      await queryWithTimeout(
        `UPDATE trade_signals
         SET include_in_briefing = TRUE
         WHERE symbol = ANY($1::text[])`,
        [briefingSymbols],
        { timeoutMs: 7000, label: 'signal_router.flag_briefing_batch', maxRetries: 0 }
      );
    }

    const watchlistSignals = normalized.filter((s) => s.score >= 80 || s.hierarchy_rank >= 90);
    await upsertWatchlistBatch(watchlistSignals);

    const alertSignals = normalized.filter((s) => s.score >= 85);
    if (alertSignals.length) {
      const briefingGenerated = await hasBriefingGeneratedToday();
      if (briefingGenerated) {
        await insertAlertsBatch(alertSignals);
      }
    }

    await recordStrategyTradesBatch(normalized);

    const outcomeWrites = await Promise.allSettled(
      normalized.map((signal) => writeSignalOutcome(signal))
    );
    const logged = outcomeWrites.filter((result) => result.status === 'fulfilled' && result.value).length;
    const failed = outcomeWrites.filter((result) => result.status === 'rejected').length;

    if (failed > 0) {
      console.warn('[OUTCOME_WRITER] errors during signal logging', { failed });
    }
    console.log('[OUTCOME_WRITER] signals logged', { logged, attempted: normalized.length });
  } catch (error) {
    console.error('[SIGNAL_ROUTER] routeSignalsBatch failed', { error: error.message });
  }
}

async function routeSignal(signal) {
  await routeSignalsBatch([signal]);
}

module.exports = {
  ensureSignalRouterTables,
  routeSignal,
  routeSignalsBatch,
  insertWatchlistSignal,
  createSignalAlert,
  recordStrategyTrade,
};
