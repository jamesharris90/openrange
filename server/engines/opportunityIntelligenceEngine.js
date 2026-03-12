const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildMovementReason(opportunity) {
  const reasons = [];
  if (toNumber(opportunity.gap_percent) > 5) {
    reasons.push('Stock gapping significantly in premarket');
  }
  if (toNumber(opportunity.relative_volume) > 3) {
    reasons.push('Unusual volume surge indicating strong participation');
  }
  if (opportunity.catalyst) {
    reasons.push('News catalyst detected');
  }
  return reasons.length ? reasons.join('; ') : 'No dominant movement driver detected';
}

function buildTradeReason(opportunity) {
  const reasons = [];
  if (toNumber(opportunity.relative_volume) > 2) reasons.push('High liquidity confirms tradability');
  if (toNumber(opportunity.price) > 2) reasons.push('Price level supports clean execution');
  if (toNumber(opportunity.score) > 80) reasons.push('Strong signal alignment across engines');
  return reasons.length ? reasons.join('; ') : 'Tradeability is moderate and requires tighter confirmation';
}

function buildTradePlan(opportunity) {
  const gap = toNumber(opportunity.gap_percent);
  const rvol = toNumber(opportunity.relative_volume);

  let strategy = 'VWAP Reclaim';
  if (gap > 5) strategy = 'Gap and Go';
  if (rvol > 3) strategy = 'Momentum Continuation';

  return `${strategy}: Watch first pullback; Enter above VWAP; Risk below intraday low`;
}

function computeConfidence(opportunity) {
  const score = toNumber(opportunity.score);
  const rvol = toNumber(opportunity.relative_volume);
  const gap = toNumber(opportunity.gap_percent);

  const raw = ((score / 100) + (rvol / 5) + (gap / 10)) * 100;
  return Number(clamp(raw, 0, 100).toFixed(2));
}

async function runQuery(db, sql, params = [], label = 'intelligence.query') {
  if (db && typeof db.query === 'function') {
    return db.query(sql, params);
  }
  return queryWithTimeout(sql, params, { timeoutMs: 8000, label, maxRetries: 0 });
}

async function generateOpportunityIntelligence(db) {
  const startedAt = Date.now();
  let processed = 0;
  let errors = 0;

  try {
    await runQuery(
      db,
      `CREATE TABLE IF NOT EXISTS opportunity_intelligence (
         id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         symbol text NOT NULL,
         score numeric,
         price numeric,
         gap_percent numeric,
         relative_volume numeric,
         catalyst text,
         movement_reason text,
         trade_reason text,
         trade_plan text,
         confidence numeric,
         created_at timestamp DEFAULT now()
       )`,
      [],
      'intelligence.ensure_table'
    );

    await runQuery(
      db,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_intelligence_symbol_day
       ON opportunity_intelligence(symbol, (created_at::date))`,
      [],
      'intelligence.ensure_unique_index'
    );

    const source = await runQuery(
      db,
      `SELECT *
       FROM trade_opportunities
       ORDER BY score DESC
       LIMIT 50`,
      [],
      'intelligence.select_opportunities'
    );

    const rows = source.rows || [];

    for (const opportunity of rows) {
      try {
        const movementReason = buildMovementReason(opportunity);
        const tradeReason = buildTradeReason(opportunity);
        const tradePlan = buildTradePlan(opportunity);
        const confidence = computeConfidence(opportunity);

        await runQuery(
          db,
          `INSERT INTO opportunity_intelligence (
             symbol,
             score,
             price,
             gap_percent,
             relative_volume,
             catalyst,
             movement_reason,
             trade_reason,
             trade_plan,
             confidence,
             created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
           ON CONFLICT (symbol, (created_at::date))
           DO UPDATE SET
             score = EXCLUDED.score,
             price = EXCLUDED.price,
             gap_percent = EXCLUDED.gap_percent,
             relative_volume = EXCLUDED.relative_volume,
             catalyst = EXCLUDED.catalyst,
             movement_reason = EXCLUDED.movement_reason,
             trade_reason = EXCLUDED.trade_reason,
             trade_plan = EXCLUDED.trade_plan,
             confidence = EXCLUDED.confidence,
             created_at = NOW()`,
          [
            opportunity.symbol,
            toNumber(opportunity.score),
            toNumber(opportunity.price),
            toNumber(opportunity.gap_percent),
            toNumber(opportunity.relative_volume),
            opportunity.catalyst || null,
            movementReason,
            tradeReason,
            tradePlan,
            confidence,
          ],
          'intelligence.upsert'
        );

        processed += 1;
      } catch (error) {
        errors += 1;
        logger.error('[INTELLIGENCE ENGINE] failed to process opportunity', {
          symbol: opportunity?.symbol || null,
          error: error.message,
        });
      }
    }

    const runtimeMs = Date.now() - startedAt;
    logger.info('[INTELLIGENCE ENGINE] run complete', { processed, errors, runtimeMs });
    return { ok: true, processed, errors, runtimeMs };
  } catch (error) {
    const runtimeMs = Date.now() - startedAt;
    logger.error('[INTELLIGENCE ENGINE] run failed', { error: error.message, runtimeMs });
    return { ok: false, processed, errors: errors + 1, runtimeMs, error: error.message };
  }
}

async function runOpportunityIntelligenceEngine() {
  return generateOpportunityIntelligence();
}

module.exports = {
  generateOpportunityIntelligence,
  runOpportunityIntelligenceEngine,
};
