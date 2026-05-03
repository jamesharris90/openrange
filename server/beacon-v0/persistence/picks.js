/**
 * Beacon v0 persistence layer.
 * Writes picks from the orchestrator to beacon_v0_picks table.
 */

const crypto = require('crypto');
const { queryWithTimeout } = require('../../db/pg');
const { computeDueTimes } = require('../outcomes/dueTimeCalculator');

function generateRunId() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `v0-${timestamp}-${crypto.randomBytes(4).toString('hex')}`;
}

function toFiniteNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizePickForStorage(pick) {
  const createdAt = pick.created_at ? new Date(pick.created_at) : new Date();
  const discoveredInWindow = pick.discovered_in_window || 'nightly';
  let dueTimeFields = {
    outcomeT1DueAt: null,
    outcomeT2DueAt: null,
    outcomeT3DueAt: null,
    outcomeT4DueAt: null,
    outcomeT1SessionMinutes: null,
    outcomeT2SessionMinutes: null,
    outcomeT3SessionMinutes: null,
    outcomeT4SessionMinutes: null,
  };

  try {
    const dueTimes = computeDueTimes(createdAt, discoveredInWindow);
    dueTimeFields = {
      outcomeT1DueAt: dueTimes.t1_due_at,
      outcomeT2DueAt: dueTimes.t2_due_at,
      outcomeT3DueAt: dueTimes.t3_due_at,
      outcomeT4DueAt: dueTimes.t4_due_at,
      outcomeT1SessionMinutes: dueTimes.t1_session_minutes,
      outcomeT2SessionMinutes: dueTimes.t2_session_minutes,
      outcomeT3SessionMinutes: dueTimes.t3_session_minutes,
      outcomeT4SessionMinutes: dueTimes.t4_session_minutes,
    };
  } catch (error) {
    console.warn(JSON.stringify({
      log: 'beacon_v0.persistence.due_times_failed',
      symbol: pick.symbol,
      discovered_in_window: discoveredInWindow,
      error: error.message,
    }));
  }

  return {
    symbol: String(pick.symbol || '').trim().toUpperCase(),
    pattern: pick.pattern || pick.patternCategory || 'Uncategorized Signal Alignment',
    confidence: pick.confidence || pick.confidenceQualification || 'unqualified',
    reasoning: pick.reasoning || pick.patternDescription || '',
    signalsAligned: pick.signals_aligned || (pick.signals || []).map((signal) => signal.signal),
    pickPrice: toFiniteNumberOrNull(pick.pick_price),
    pickVolumeBaseline: toFiniteNumberOrNull(pick.pick_volume_baseline),
    metadata: pick.metadata || {
      direction: pick.direction || 'neutral',
      alignment: pick.alignment || null,
      signals: pick.signals || [],
      disqualifiedReasons: pick.disqualifiedReasons || [],
    },
    narrativeThesis: pick.narrative_thesis || null,
    narrativeWatchFor: pick.narrative_watch_for || null,
    narrativeGeneratedAt: pick.narrative_generated_at || null,
    narrativeModel: pick.narrative_model || null,
    narrativeInputTokens: Number.isFinite(Number(pick.narrative_input_tokens)) ? Number(pick.narrative_input_tokens) : null,
    narrativeOutputTokens: Number.isFinite(Number(pick.narrative_output_tokens)) ? Number(pick.narrative_output_tokens) : null,
    narrativeError: pick.narrative_error || null,
    topCatalystTier: Number.isFinite(Number(pick.top_catalyst_tier)) ? Number(pick.top_catalyst_tier) : null,
    topCatalystRank: Number.isFinite(Number(pick.top_catalyst_rank)) ? Number(pick.top_catalyst_rank) : null,
    topCatalystReasons: Array.isArray(pick.top_catalyst_reasons) ? pick.top_catalyst_reasons : null,
    createdAt,
    discoveredInWindow,
    outcomeStatus: 'pending',
    outcomeComplete: false,
    ...dueTimeFields,
  };
}

async function persistPicks(picks, runId = generateRunId(), options = {}) {
  if (!Array.isArray(picks) || picks.length === 0) {
    return { inserted: 0, runId };
  }

  const normalized = picks.map(normalizePickForStorage).filter((pick) => pick.symbol);
  if (normalized.length === 0) {
    return { inserted: 0, runId };
  }

  const missingPrice = normalized.find((pick) => pick.pickPrice == null);
  if (missingPrice) {
    throw new Error(`beacon_v0 pick_price missing for ${missingPrice.symbol}; refusing to persist unevaluable pick`);
  }

  const values = [];
  const placeholders = [];

  normalized.forEach((pick, index) => {
    const base = index * 32;
    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::jsonb, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16}, $${base + 17}::text[], $${base + 18}, $${base + 19}, $${base + 20}, $${base + 21}, $${base + 22}, $${base + 23}, $${base + 24}, $${base + 25}, $${base + 26}, $${base + 27}, $${base + 28}, $${base + 29}, $${base + 30}, $${base + 31}, $${base + 32})`);
    values.push(
      pick.symbol,
      pick.pattern,
      pick.confidence,
      pick.reasoning,
      pick.signalsAligned,
      JSON.stringify(pick.metadata || {}),
      runId,
      pick.narrativeThesis,
      pick.narrativeWatchFor,
      pick.narrativeGeneratedAt,
      pick.narrativeModel,
      pick.narrativeInputTokens,
      pick.narrativeOutputTokens,
      pick.narrativeError,
      pick.topCatalystTier,
      pick.topCatalystRank,
      pick.topCatalystReasons,
      pick.createdAt,
      pick.pickPrice,
      pick.pickVolumeBaseline,
      'generation',
      pick.discoveredInWindow,
      pick.outcomeT1DueAt,
      pick.outcomeT2DueAt,
      pick.outcomeT3DueAt,
      pick.outcomeT4DueAt,
      pick.outcomeStatus,
      pick.outcomeComplete,
      pick.outcomeT1SessionMinutes,
      pick.outcomeT2SessionMinutes,
      pick.outcomeT3SessionMinutes,
      pick.outcomeT4SessionMinutes,
    );
  });

  await queryWithTimeout(
    `
      INSERT INTO beacon_v0_picks
        (symbol, pattern, confidence, reasoning, signals_aligned, metadata, run_id,
         narrative_thesis, narrative_watch_for, narrative_generated_at, narrative_model,
         narrative_input_tokens, narrative_output_tokens, narrative_error,
        top_catalyst_tier, top_catalyst_rank, top_catalyst_reasons, top_catalyst_computed_at,
        pick_price, pick_volume_baseline, baseline_source, discovered_in_window,
        outcome_t1_due_at, outcome_t2_due_at, outcome_t3_due_at, outcome_t4_due_at,
        outcome_status, outcome_complete,
        outcome_t1_session_minutes, outcome_t2_session_minutes,
        outcome_t3_session_minutes, outcome_t4_session_minutes)
      VALUES ${placeholders.join(', ')}
    `,
    values,
    {
      label: 'beacon_v0.persistence.insert',
      timeoutMs: 10000,
      slowQueryMs: 1000,
      poolType: 'write',
      maxRetries: 1,
    },
  );

  return { inserted: normalized.length, runId };
}

async function getLatestPicks(limit = 20) {
  const boundedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const result = await queryWithTimeout(
    `
      WITH latest_run AS (
        SELECT run_id
        FROM beacon_v0_picks
        ORDER BY created_at DESC
        LIMIT 1
      )
      SELECT
        symbol,
        pattern,
        confidence,
        reasoning,
        signals_aligned,
        metadata,
        narrative_thesis,
        narrative_watch_for,
        narrative_generated_at,
        narrative_model,
        narrative_input_tokens,
        narrative_output_tokens,
        narrative_error,
        run_id,
        created_at
      FROM beacon_v0_picks
      WHERE run_id = (SELECT run_id FROM latest_run)
      ORDER BY symbol ASC
      LIMIT $1
    `,
    [boundedLimit],
    {
      label: 'beacon_v0.persistence.latest',
      timeoutMs: 8000,
      slowQueryMs: 1000,
      poolType: 'read',
      maxRetries: 1,
    },
  );

  return result.rows;
}

module.exports = {
  generateRunId,
  getLatestPicks,
  normalizePickForStorage,
  persistPicks,
};