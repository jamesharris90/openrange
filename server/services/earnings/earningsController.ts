import { pool } from '../../db/pg';
import { ingestEarningsEvent } from './earningsIngestionService';
import { calculateMarketReaction } from './earningsReactionService';
import { persistEarningsScore, calculateEarningsIntelligenceScore } from './earningsScoreEngine';
import { getExpectedMove } from '../expectedMoveService';

const optionsService = require('../options/optionsService');

function normalizeSymbol(symbol: unknown): string {
  return String(symbol || '').trim().toUpperCase();
}

async function getLatestEvent(symbol: string) {
  const result = await pool.query(
    `
      SELECT *
      FROM earnings_events
      WHERE symbol = $1
      ORDER BY report_date DESC, created_at DESC
      LIMIT 1
    `,
    [symbol],
  );
  return result.rows[0] || null;
}

async function getLatestReaction(symbol: string, reportDate: string) {
  const result = await pool.query(
    `
      SELECT *
      FROM earnings_market_reaction
      WHERE symbol = $1 AND report_date = $2
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [symbol, reportDate],
  );
  return result.rows[0] || null;
}

async function getLatestScore(symbol: string, reportDate: string) {
  const result = await pool.query(
    `
      SELECT *
      FROM earnings_scores
      WHERE symbol = $1 AND report_date = $2
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [symbol, reportDate],
  );
  return result.rows[0] || null;
}

export async function getEarningsIntelligence(symbolInput: string) {
  const symbol = normalizeSymbol(symbolInput);
  if (!symbol) {
    return { status: 400, body: { error: 'Invalid symbol' } };
  }

  let event = await getLatestEvent(symbol);
  if (!event) {
    event = await ingestEarningsEvent(symbol);
  }

  if (!event) {
    return { status: 404, body: { error: 'No earnings event found for symbol', symbol } };
  }

  let reaction = await getLatestReaction(symbol, event.report_date);
  if (!reaction) {
    reaction = await calculateMarketReaction(symbol, new Date(event.report_date));
  }

  if (!reaction) {
    return {
      status: 404,
      body: {
        error: 'No market reaction data found for earnings event',
        symbol,
        report_date: event.report_date,
      },
    };
  }

  let score = await getLatestScore(symbol, event.report_date);
  if (!score) {
    const optionsResult = await getExpectedMove(symbol, event.report_date, 'earnings');
    const optionsData = optionsResult?.data
      ? {
          expectedMovePct: optionsResult.data.impliedMovePct != null ? optionsResult.data.impliedMovePct * 100 : null,
          expectedMoveDollar: optionsResult.data.impliedMoveDollar,
          atmIV: optionsResult.data.iv,
        }
      : null;

    const saved = await persistEarningsScore(event, reaction, optionsData);
    score = saved.row || {
      base_score: saved.score.baseScore,
      layer2_score: saved.score.layer2Score,
      total_score: saved.score.totalScore,
      tier: saved.score.tier,
      continuation_probability: saved.score.continuationProbability,
      continuation_bias: saved.score.continuationBias,
    };
  }

  const hasLayer2Fields =
    score?.base_score != null ||
    score?.layer2_score != null ||
    score?.continuation_probability != null ||
    score?.continuation_bias != null;

  if (!hasLayer2Fields) {
    const liveScore = await calculateEarningsIntelligenceScore(event, reaction as any, null);
    score = {
      ...score,
      base_score: liveScore.baseScore,
      layer2_score: liveScore.layer2Score,
      total_score: score?.total_score ?? liveScore.totalScore,
      tier: score?.tier ?? liveScore.tier,
      continuation_probability: liveScore.continuationProbability,
      continuation_bias: liveScore.continuationBias,
    };
  }

  return {
    status: 200,
    body: {
      symbol,
      report_date: event.report_date,
      eps_surprise_pct: event.eps_surprise_pct,
      rev_surprise_pct: event.rev_surprise_pct,
      guidance_direction: event.guidance_direction,
      actual_move_pct: reaction.actual_move_pct,
      implied_move_pct: reaction.implied_move_pct,
      move_vs_implied_ratio: reaction.move_vs_implied_ratio,
      base_score: score.base_score ?? null,
      layer2_score: score.layer2_score ?? null,
      total_score: score.total_score,
      tier: score.tier,
      continuation_probability: score.continuation_probability ?? null,
      continuation_bias: score.continuation_bias ?? null,
    },
  };
}

export async function processEarningsIntelligenceBatch(symbols: string[]) {
  const normalized = (Array.isArray(symbols) ? symbols : [])
    .map((sym) => normalizeSymbol(sym))
    .filter(Boolean);

  return optionsService.processSymbolsInBatches(normalized, async (symbol: string) => {
    try {
      const result = await getEarningsIntelligence(symbol);
      return { symbol, ok: result.status === 200, status: result.status, body: result.body };
    } catch (error: any) {
      return { symbol, ok: false, status: 500, error: error?.message || 'unknown' };
    }
  });
}
