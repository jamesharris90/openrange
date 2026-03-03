import { pool } from '../../db/pg';
import { calculateReactionQuality } from './layer2/reactionQualityEngine';
import { calculateContextReinforcement } from './layer2/contextReinforcementEngine';
import { calculateContinuationProbability } from './layer2/continuationModel';

type GuidanceDirection = 'raised' | 'reaffirmed' | 'lowered' | string | null;

export interface EarningsEventLike {
  symbol: string;
  report_date: string;
  eps_surprise_pct: number | null;
  rev_surprise_pct: number | null;
  guidance_direction: GuidanceDirection;
}

export interface EarningsReactionLike {
  actual_move_pct: number | null;
  implied_move_pct: number | null;
  move_vs_implied_ratio: number | null;
}

export interface EarningsScoreResult {
  baseScore?: number;
  layer2Score?: number;
  totalScore: number;
  tier: string;
  continuationProbability?: number;
  continuationBias?: 'LOW' | 'MEDIUM' | 'HIGH';
  reactionQuality?: {
    reactionQualityScore: number;
    breakdown: Record<string, number>;
  };
  contextReinforcement?: {
    contextScore: number;
    breakdown: Record<string, number>;
  };
  moduleScores: {
    eps: number;
    revenue: number;
    guidance: number;
    reaction: number;
  };
}

function scoreSurprise(value: number | null): number {
  if (value == null) return 0;
  if (value > 20) return 20;
  if (value > 10) return 15;
  if (value > 5) return 10;
  if (value < 0) return -15;
  return 0;
}

function scoreGuidance(value: GuidanceDirection): number {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'raised') return 25;
  if (normalized === 'reaffirmed') return 5;
  if (normalized === 'lowered') return -25;
  return 0;
}

function scoreReaction(moveVsImplied: number | null): number {
  if (moveVsImplied == null) return 0;
  if (moveVsImplied > 1.5) return 20;
  if (moveVsImplied < 0.5) return -10;
  return 0;
}

function scoreTier(total: number): string {
  if (total >= 80) return 'A+ Continuation';
  if (total >= 60) return 'A Setup';
  if (total >= 40) return 'B';
  if (total >= 20) return 'C';
  return 'Avoid';
}

export function calculateEarningsScore(event: EarningsEventLike, reaction: EarningsReactionLike): EarningsScoreResult {
  const eps = scoreSurprise(event.eps_surprise_pct);
  const revenue = scoreSurprise(event.rev_surprise_pct);
  const guidance = scoreGuidance(event.guidance_direction);
  const reactionScore = scoreReaction(reaction.move_vs_implied_ratio);

  const rawTotal = eps + revenue + guidance + reactionScore;
  const totalScore = Math.min(rawTotal, 100);
  const tier = scoreTier(totalScore);

  return {
    totalScore,
    tier,
    moduleScores: {
      eps,
      revenue,
      guidance,
      reaction: reactionScore,
    },
  };
}

export async function calculateEarningsIntelligenceScore(
  event: EarningsEventLike,
  reaction: EarningsReactionLike & Record<string, any>,
  contextInput?: {
    newsScore?: number | null;
    sectorStrength?: number | null;
    spyBias?: unknown;
  } | null,
): Promise<EarningsScoreResult> {
  const base = calculateEarningsScore(event, reaction);
  const reactionQuality = calculateReactionQuality(reaction);
  const contextReinforcement = calculateContextReinforcement(
    event.symbol,
    contextInput?.newsScore ?? null,
    contextInput?.sectorStrength ?? null,
    contextInput?.spyBias ?? null,
  );
  const continuation = await calculateContinuationProbability(event.symbol);

  const baseScore = base.totalScore;
  const layer2Score = reactionQuality.reactionQualityScore + contextReinforcement.contextScore;
  const totalScore = Math.min(baseScore + layer2Score, 100);
  const tier = scoreTier(totalScore);

  return {
    ...base,
    baseScore,
    layer2Score,
    totalScore,
    tier,
    continuationProbability: continuation.continuationProbability,
    continuationBias: continuation.bias,
    reactionQuality,
    contextReinforcement,
  };
}

let scoreTableColumnsPromise: Promise<Set<string>> | null = null;

async function getEarningsScoreColumns(): Promise<Set<string>> {
  if (!scoreTableColumnsPromise) {
    scoreTableColumnsPromise = pool
      .query(
        `
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'earnings_scores'
        `,
      )
      .then((result) => new Set(result.rows.map((row) => row.column_name)));
  }
  return scoreTableColumnsPromise;
}

export async function persistEarningsScore(
  event: EarningsEventLike,
  reaction: EarningsReactionLike,
  optionsData?: { expectedMovePct?: number | null; expectedMoveDollar?: number | null; atmIV?: number | null } | null,
) {
  const score = await calculateEarningsIntelligenceScore(event, reaction as EarningsReactionLike & Record<string, any>, null);
  const columns = await getEarningsScoreColumns();

  const payload: Record<string, any> = {
    symbol: event.symbol,
    report_date: event.report_date,
    base_score: score.baseScore ?? null,
    layer2_score: score.layer2Score ?? null,
    total_score: score.totalScore,
    tier: score.tier,
    continuation_probability: score.continuationProbability ?? null,
    continuation_bias: score.continuationBias ?? null,
    eps_surprise_pct: event.eps_surprise_pct,
    rev_surprise_pct: event.rev_surprise_pct,
    guidance_direction: event.guidance_direction,
    actual_move_pct: reaction.actual_move_pct,
    implied_move_pct: reaction.implied_move_pct,
    move_vs_implied_ratio: reaction.move_vs_implied_ratio,
    earnings_expected_move_pct: optionsData?.expectedMovePct ?? null,
    earnings_expected_move_dollar: optionsData?.expectedMoveDollar ?? null,
    earnings_iv: optionsData?.atmIV ?? null,
  };

  const allowedEntries = Object.entries(payload).filter(([key]) => columns.has(key));
  if (allowedEntries.length === 0) {
    throw new Error('earnings_scores table exists but has no compatible columns');
  }

  const sqlColumns = allowedEntries.map(([key]) => key);
  const sqlValues = allowedEntries.map(([, value]) => value);
  const placeholders = sqlColumns.map((_, index) => `$${index + 1}`);

  const sql = `
    INSERT INTO earnings_scores (${sqlColumns.join(', ')})
    VALUES (${placeholders.join(', ')})
    RETURNING *
  `;

  const result = await pool.query(sql, sqlValues);
  console.log('Earnings Intelligence Calculated:', event.symbol, score.totalScore, score.tier);
  return {
    row: result.rows[0] || null,
    score,
  };
}